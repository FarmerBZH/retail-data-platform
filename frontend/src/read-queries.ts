import { ApiError, ReadApi, pageQueryKey } from "./read-api";
import type {
  Freshness,
  Page,
  Query,
  Resource,
  ResourceName,
} from "./read-api";
import type { Decoder } from "./api-validation";
import { SessionUnavailableError } from "./session";
import type { Session } from "./session";

export type ReadOptions = Readonly<{ signal?: AbortSignal; refresh?: boolean }>;
export type ReadPage<T> = Page<T> & Readonly<{ limit: number }>;
export type Collection<T> = Readonly<{
  items: readonly T[];
  complete: boolean;
  reason:
    null | "page-limit" | "item-limit" | "attempt-limit" | "freshness-changed";
  nextCursor: string | null;
  attempts: number;
}>;
type Budget = { attempts: number; maximum: number };
type Cached = { value: unknown; expiresAt: number; size: number };
type Pending = {
  controller: AbortController;
  promise: Promise<unknown>;
  consumers: number;
};
class AttemptLimit extends Error {}

function pause(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new ApiError("cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delay);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

// One service per document. No storage, automatic startup reads or background refresh.
export class ReadQueries {
  #api: ReadApi;
  #sessions: Session;
  #generation: number;
  #cache = new Map<string, Cached>();
  #cacheVersion = 0;
  #pending = new Map<string, Pending>();
  #decoderIds = new WeakMap<Decoder<unknown>, number>();
  #nextDecoder = 0;
  #unsubscribe: () => void;
  #disposed = false;

  constructor(origin: string, sessions: Session, request?: typeof fetch) {
    this.#api = new ReadApi(origin, sessions, request);
    this.#sessions = sessions;
    this.#generation = sessions.getSnapshot().generation;
    this.#unsubscribe = sessions.subscribe(() => {
      const generation = sessions.getSnapshot().generation;
      if (generation !== this.#generation) {
        this.#generation = generation;
        this.#clear();
      }
    });
  }
  #clear() {
    this.#cache.clear();
    this.#cacheVersion++;
    const jobs = [...this.#pending.values()];
    this.#pending.clear();
    for (const job of jobs) job.controller.abort();
  }
  dispose(): void {
    this.#disposed = true;
    this.#unsubscribe();
    this.#clear();
  }
  #current(generation: number): boolean {
    this.#sessions.checkExpiry();
    const snapshot = this.#sessions.getSnapshot();
    return (
      !this.#disposed &&
      snapshot.phase === "authenticated" &&
      snapshot.generation === generation
    );
  }
  #remember(key: string, value: unknown): void {
    const size = JSON.stringify(value).length;
    if (size > 100_000) return;
    this.#cache.delete(key);
    this.#cache.set(key, { value, size, expiresAt: Date.now() + 30_000 });
    while (
      this.#cache.size > 32 ||
      [...this.#cache.values()].reduce((sum, item) => sum + item.size, 0) >
        1_000_000
    ) {
      this.#cache.delete(this.#cache.keys().next().value!);
    }
  }

  async #shared<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    options: ReadOptions,
    remember = true,
  ): Promise<T> {
    options = { ...options };
    if (!this.#sessions.credentials || this.#disposed)
      throw new ApiError("unauthenticated");
    const generation = this.#sessions.getSnapshot().generation;
    if (options.signal?.aborted) throw new ApiError("cancelled");
    const cached = this.#cache.get(key);
    if (cached && !options.refresh && cached.expiresAt > Date.now()) {
      this.#cache.delete(key);
      this.#cache.set(key, cached);
      const copy = structuredClone(cached.value) as T;
      await Promise.resolve();
      if (!this.#current(generation) || options.signal?.aborted)
        throw new ApiError("cancelled");
      return copy;
    }
    this.#cache.delete(key);
    let job = this.#pending.get(key);
    if (!job) {
      if (this.#pending.size >= 32) throw new ApiError("unavailable");
      const controller = new AbortController();
      const cacheVersion = this.#cacheVersion;
      const entry: Pending = {
        controller,
        consumers: 0,
        promise: Promise.resolve(),
      };
      this.#pending.set(key, entry);
      entry.promise = this.#sessions
        .run(async (_credentials, signal) =>
          load(AbortSignal.any([signal, controller.signal])),
        )
        .then((value) => {
          if (
            !this.#current(generation) ||
            controller.signal.aborted ||
            !entry.consumers
          )
            throw new ApiError("cancelled");
          const copy: unknown = structuredClone(value);
          if (remember && cacheVersion === this.#cacheVersion)
            this.#remember(key, copy);
          return copy;
        })
        .catch((error: unknown) => {
          if (
            error instanceof SessionUnavailableError ||
            !this.#current(generation)
          )
            throw new ApiError("cancelled");
          if (error instanceof ApiError || error instanceof AttemptLimit)
            throw error;
          throw new ApiError("invalid-response");
        })
        .finally(() => {
          if (this.#pending.get(key) === entry) this.#pending.delete(key);
        });
      job = entry;
    }
    const shared = job;
    if (shared.consumers >= 64) throw new ApiError("unavailable");
    shared.consumers++;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const leave = () => {
        if (finished) return false;
        finished = true;
        options.signal?.removeEventListener("abort", abort);
        shared.controller.signal.removeEventListener("abort", abort);
        shared.consumers--;
        if (!shared.consumers && this.#pending.get(key) === shared) {
          this.#pending.delete(key);
          shared.controller.abort();
        }
        return true;
      };
      const abort = () => {
        if (leave()) reject(new ApiError("cancelled"));
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      shared.controller.signal.addEventListener("abort", abort, { once: true });
      shared.promise.then(
        (value) => {
          if (!leave()) return;
          if (!this.#current(generation) || options.signal?.aborted) {
            reject(new ApiError("cancelled"));
            return;
          }
          resolve(structuredClone(value) as T);
        },
        (error: unknown) => {
          if (leave()) reject(error);
        },
      );
    });
  }

  async #attempt<T>(
    read: () => Promise<T>,
    signal: AbortSignal,
    budget: Budget,
    reduce?: (error: ApiError) => boolean,
  ): Promise<T> {
    let failures = 0;
    let attempts = 0;
    while (true) {
      if (signal.aborted) throw new ApiError("cancelled");
      if (budget.attempts >= budget.maximum || attempts >= 10)
        throw new AttemptLimit();
      attempts++;
      budget.attempts++;
      try {
        return await read();
      } catch (error) {
        if (error instanceof ApiError && reduce?.(error)) continue;
        if (
          !(error instanceof ApiError) ||
          (error.status !== 429 && error.status !== 503)
        )
          throw error;
        failures++;
        if (failures >= 3 || budget.attempts >= budget.maximum) throw error;
        const delay = error.retryAfterMs ?? 1000 * failures;
        if (delay > 10_000) throw error;
        await pause(delay, signal);
      }
    }
  }

  resources(options: ReadOptions = {}): Promise<readonly Resource[]> {
    return this.#shared(
      "catalog",
      (signal) =>
        this.#attempt(() => this.#api.resources(signal), signal, {
          attempts: 0,
          maximum: 3,
        }),
      options,
    );
  }
  status(options: ReadOptions = {}): Promise<Freshness> {
    return this.#shared(
      "freshness",
      (signal) =>
        this.#attempt(() => this.#api.status(signal), signal, {
          attempts: 0,
          maximum: 3,
        }),
      options,
    );
  }

  #decoderKey(decode: Decoder<unknown>): number {
    let id = this.#decoderIds.get(decode);
    if (id === undefined) {
      id = this.#nextDecoder++;
      this.#decoderIds.set(decode, id);
    }
    return id;
  }
  async page<T>(
    name: ResourceName,
    query: Query,
    decode: Decoder<T>,
    options: ReadOptions = {},
  ): Promise<ReadPage<T>> {
    const snapshot = { ...query, limit: query.limit ?? 50 };
    const key = `page:${this.#decoderKey(decode)}:${pageQueryKey(name, snapshot)}`;
    return this.#shared(
      key,
      (signal) =>
        this.#page(name, snapshot, decode, signal, {
          attempts: 0,
          maximum: 10,
        }),
      options,
    );
  }
  async #page<T>(
    name: ResourceName,
    query: Query,
    decode: Decoder<T>,
    signal: AbortSignal,
    budget: Budget,
  ): Promise<ReadPage<T>> {
    let limit = query.limit ?? 50;
    // One transient retry counter spans every reduced limit in this page.
    const result = await this.#attempt(
      () => this.#api.page(name, { ...query, limit }, decode, signal),
      signal,
      budget,
      (error) => {
        if (error.code === "too-large" && limit > 1) {
          limit = Math.max(1, Math.floor(limit / 2));
          return true;
        }
        return false;
      },
    );
    return { ...result, limit };
  }

  async collect<T>(
    name: ResourceName,
    query: Query,
    decode: Decoder<T>,
    options: ReadOptions & { maxPages?: number; maxItems?: number } = {},
  ): Promise<Collection<T>> {
    const snapshot = { ...query, limit: query.limit ?? 50 };
    pageQueryKey(name, snapshot);
    const maxPages = options.maxPages ?? 5;
    const maxItems = options.maxItems ?? 1000;
    if (
      !Number.isInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 5 ||
      !Number.isInteger(maxItems) ||
      maxItems < 1 ||
      maxItems > 1000
    )
      throw new ApiError("invalid-request");
    const key = `collection:${this.#decoderKey(decode)}:${pageQueryKey(name, snapshot)}:${maxPages}:${maxItems}`;
    const generation = this.#sessions.getSnapshot().generation;
    return this.#shared(
      key,
      async (signal): Promise<Collection<T>> => {
        const budget: Budget = { attempts: 0, maximum: 24 };
        const before = await this.#attempt(
          () => this.#api.status(signal),
          signal,
          budget,
        );
        const items: T[] = [];
        const seen = new Set<string>();
        let cursor = snapshot.after ?? null;
        let limit = snapshot.limit;
        if (cursor !== null) seen.add(cursor);
        let reason: Collection<T>["reason"] = null;
        for (let page = 0; page < maxPages; page++) {
          if (budget.attempts >= budget.maximum) {
            reason = "attempt-limit";
            break;
          }
          const pageQuery: Query = {
            ...snapshot,
            limit: Math.min(limit, maxItems - items.length),
            ...(cursor !== null ? { after: cursor } : {}),
          };
          let result: ReadPage<T>;
          try {
            result = await this.#page(name, pageQuery, decode, signal, budget);
          } catch (error) {
            if (
              error instanceof AttemptLimit ||
              (budget.attempts >= budget.maximum &&
                error instanceof ApiError &&
                (error.status === 429 ||
                  error.status === 503 ||
                  error.code === "too-large"))
            ) {
              reason = "attempt-limit";
              break;
            }
            throw error;
          }
          if (
            result.nextCursor !== null &&
            (!result.nextCursor ||
              seen.has(result.nextCursor) ||
              !result.items.length)
          )
            throw new ApiError("invalid-response");
          items.push(...result.items);
          limit = result.limit;
          cursor = result.nextCursor;
          if (cursor === null) break;
          seen.add(cursor);
          if (items.length >= maxItems) {
            reason = "item-limit";
            break;
          }
          if (page + 1 === maxPages) reason = "page-limit";
        }
        if (budget.attempts >= budget.maximum) reason = "attempt-limit";
        else {
          const after = await this.#attempt(
            () => this.#api.status(signal),
            signal,
            budget,
          );
          if (!this.#current(generation) || signal.aborted)
            throw new ApiError("cancelled");
          if (JSON.stringify(before) !== JSON.stringify(after)) {
            this.#cache.clear();
            this.#cacheVersion++;
            return {
              items: [],
              complete: false,
              reason: "freshness-changed",
              nextCursor: null,
              attempts: budget.attempts,
            };
          }
        }
        return {
          items,
          complete: reason === null && cursor === null,
          reason,
          nextCursor: cursor,
          attempts: budget.attempts,
        };
      },
      options,
      false,
    );
  }
}
