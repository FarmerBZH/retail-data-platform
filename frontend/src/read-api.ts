import { readConfiguration } from "./config";
import { Session, SessionUnavailableError } from "./session";
import {
  date,
  object,
  text,
  timestamp,
  nullable,
  uuid,
} from "./api-validation";
import type { Decoder } from "./api-validation";

// Fixed public routes, never paths or destinations supplied by a response.
export const resourceNames = [
  "analytics_activity_month",
  "analytics_assortment_candidates",
  "analytics_distribution_product_month",
  "analytics_monthly_link_quality",
  "analytics_refresh_runs",
  "analytics_register_product_month",
  "analytics_retailer_assortment_month",
  "analytics_shelf_category_month",
  "analytics_store_category_month",
  "analytics_store_month",
  "analytics_store_month_changes",
  "analytics_typology_month",
  "assortments",
  "import_runs",
  "numeric_distribution_observations",
  "products",
  "register_observations",
  "shelf_share_observations",
  "store_activity_metrics",
  "store_typology_values",
  "stores",
  "typology_mapping_rules",
  "typology_rank_rules",
  "typology_snapshots",
] as const;
export type ResourceName = (typeof resourceNames)[number];
export type Resource = Readonly<{
  name: ResourceName;
  columns: readonly string[];
  keys: readonly string[];
  filters: readonly string[];
  path: string;
}>;
export type Page<T> = Readonly<{
  items: readonly T[];
  nextCursor: string | null;
}>;
export type Query = Readonly<{
  limit?: number;
  after?: string;
  id?: string;
  store_id?: string;
  product_id?: string;
  assortment_id?: string;
  typology_value_id?: string;
  activity_type?: string;
  category_code?: string;
  product_key?: string;
  source_gtin?: string;
  dataset?: string;
  store_match_status?: string;
  period_from?: string;
  period_to?: string;
}>;
export type ApiErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid-request"
  | "too-large"
  | "rate-limited"
  | "unavailable"
  | "network"
  | "invalid-response"
  | "cancelled";
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  constructor(code: ApiErrorCode) {
    super(`API ${code}`);
    this.name = "ApiError";
    this.code = code;
  }
}

function resourceName(value: unknown): ResourceName {
  if (!resourceNames.includes(value as ResourceName))
    throw new Error("Invalid resource");
  return value as ResourceName;
}
function identifiers(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 128)
    throw new Error("Invalid response");
  const result = value.map((v: unknown) => {
    const name = text(v, 128);
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error("Invalid response");
    return name;
  });
  if (new Set(result).size !== result.length)
    throw new Error("Invalid response");
  return result;
}
function catalog(value: unknown): readonly Resource[] {
  if (!Array.isArray(value) || value.length > resourceNames.length)
    throw new Error("Invalid response");
  const result = value.map((entry: unknown): Resource => {
    const row = object(entry);
    const name = resourceName(row.name);
    const columns = identifiers(row.columns);
    const keys = identifiers(row.keys);
    const filters = identifiers(row.filters);
    if (
      row.path !== `/v1/data/${name}` ||
      keys.some((key) => !columns.includes(key))
    )
      throw new Error("Invalid response");
    return { name, columns, keys, filters, path: row.path };
  });
  if (new Set(result.map((row) => row.name)).size !== result.length)
    throw new Error("Invalid response");
  return result;
}
function freshness(value: unknown) {
  const row = object(value);
  const state = row.state;
  const lastAttemptStatus = row.last_attempt_status;
  if (state !== "uninitialized" && state !== "current" && state !== "stale")
    throw new Error("Invalid response");
  if (
    lastAttemptStatus !== null &&
    lastAttemptStatus !== "running" &&
    lastAttemptStatus !== "succeeded" &&
    lastAttemptStatus !== "failed"
  )
    throw new Error("Invalid response");
  return {
    state,
    lastCompletedAt: nullable(timestamp)(row.last_completed_at),
    lastAttemptStatus,
  };
}
export type Freshness = ReturnType<typeof freshness>;

function queryParameters(query: Query): URLSearchParams {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "limit") {
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 200
      )
        throw new Error("Invalid query");
    } else if (
      [
        "id",
        "store_id",
        "product_id",
        "assortment_id",
        "typology_value_id",
      ].includes(key)
    ) {
      uuid(value);
    } else if (key === "period_from" || key === "period_to") {
      if (!date(value).endsWith("-01")) throw new Error("Invalid query");
    } else {
      const maxima: Record<string, number> = {
        after: 8192,
        activity_type: 32,
        category_code: 32,
        product_key: 1024,
        source_gtin: 14,
        dataset: 1024,
        store_match_status: 16,
      };
      const maximum = Object.hasOwn(maxima, key) ? maxima[key] : undefined;
      if (maximum === undefined) throw new Error("Invalid query");
      text(value, maximum);
    }
    parameters.set(key, String(value));
  }
  if (
    query.period_from &&
    query.period_to &&
    query.period_from > query.period_to
  )
    throw new Error("Invalid query");
  return parameters;
}

const maximumBytes = 2_000_000;
async function json(response: Response): Promise<unknown> {
  if (
    response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() !== "application/json" ||
    !response.body
  )
    throw new ApiError("invalid-response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let content = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) throw new ApiError("too-large");
      content += decoder.decode(chunk.value, { stream: true });
    }
    content += decoder.decode();
    return JSON.parse(content) as unknown;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("invalid-response");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export class ReadApi {
  readonly #origin: string;
  readonly #sessions: Session;
  readonly #fetch: typeof fetch;
  constructor(
    origin: string,
    sessions: Session,
    request: typeof fetch = globalThis.fetch,
  ) {
    const configuration = readConfiguration(origin);
    if (configuration.status !== "configured")
      throw new ApiError("invalid-request");
    this.#origin = configuration.apiOrigin;
    this.#sessions = sessions;
    this.#fetch = request;
  }

  resources(signal?: AbortSignal): Promise<readonly Resource[]> {
    return this.#read("/v1/resources", new URLSearchParams(), catalog, signal);
  }
  status(signal?: AbortSignal): Promise<Freshness> {
    return this.#read(
      "/v1/analytics/status",
      new URLSearchParams(),
      freshness,
      signal,
    );
  }
  async page<T>(
    name: ResourceName,
    query: Query,
    decode: Decoder<T>,
    signal?: AbortSignal,
  ): Promise<Page<T>> {
    const limit = query.limit ?? 50;
    let parameters: URLSearchParams;
    try {
      resourceName(name);
      parameters = queryParameters(query);
    } catch {
      throw new ApiError("invalid-request");
    }
    return this.#read(
      `/v1/data/${name}`,
      parameters,
      (value) => {
        const row = object(value);
        if (!Array.isArray(row.items) || row.items.length > limit)
          throw new Error("Invalid response");
        return {
          items: row.items.map((item: unknown) => decode(item)),
          nextCursor: nullable((v) => text(v, 8192))(row.next_cursor),
        };
      },
      signal,
    );
  }

  async #read<T>(
    path: string,
    parameters: URLSearchParams,
    decode: Decoder<T>,
    cancellation?: AbortSignal,
  ): Promise<T> {
    if (!this.#sessions.credentials) throw new ApiError("unauthenticated");
    const destination = new URL(path, this.#origin);
    destination.search = parameters.toString();
    let refused = false;
    try {
      return await this.#sessions.run(
        async (credentials, sessionSignal, operation) => {
          const signals = [sessionSignal, AbortSignal.timeout(10_000)];
          if (cancellation) signals.push(cancellation);
          const signal = AbortSignal.any(signals);
          let response: Response;
          try {
            signal.throwIfAborted();
            response = await this.#fetch(destination, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${credentials.accessToken}`,
                Accept: "application/json",
              },
              signal,
              redirect: "error",
              credentials: "omit",
              cache: "no-store",
              referrerPolicy: "no-referrer",
            });
          } catch {
            throw new ApiError(signal.aborted ? "cancelled" : "network");
          }
          if (!operation.isCurrent() || signal.aborted) {
            await response.body?.cancel().catch(() => undefined);
            throw new ApiError("cancelled");
          }
          if (
            response.redirected ||
            (response.url && response.url !== destination.href)
          ) {
            await response.body?.cancel().catch(() => undefined);
            throw new ApiError("invalid-response");
          }
          if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            if (response.status === 401) {
              // Recheck after asynchronous cancellation; old refusals cannot end a new login.
              if (operation.isCurrent()) {
                refused = true;
                this.#sessions.end();
              }
              throw new ApiError("unauthenticated");
            }
            const codes: Record<number, ApiErrorCode> = {
              403: "forbidden",
              413: "too-large",
              422: "invalid-request",
              429: "rate-limited",
              503: "unavailable",
            };
            throw new ApiError(codes[response.status] ?? "unavailable");
          }
          try {
            const value = await json(response);
            if (!operation.isCurrent() || signal.aborted)
              throw new ApiError("cancelled");
            return decode(value);
          } catch (error) {
            if (signal.aborted) throw new ApiError("cancelled");
            if (error instanceof ApiError) throw error;
            throw new ApiError("invalid-response");
          }
        },
      );
    } catch (error) {
      if (error instanceof SessionUnavailableError)
        throw new ApiError(refused ? "unauthenticated" : "cancelled");
      if (error instanceof ApiError) throw error;
      throw new ApiError("invalid-response");
    }
  }
}
