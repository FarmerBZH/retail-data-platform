import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadQueries } from "./read-queries";
import { Session } from "./session";
import { storeSummary } from "./api-validation";
import type { Query } from "./read-api";

const origin = "https://api.example.test";
const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const row = {
  id,
  name: "Synthetic shop",
  retailer_name: null,
  city: null,
  is_active: true,
};
const freshness = {
  state: "current",
  last_completed_at: "2026-09-01T00:00:00Z",
  last_attempt_status: "succeeded",
};
const body = (value: unknown, status = 200, retryAfter?: string) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      ...(retryAfter !== undefined ? { "Retry-After": retryAfter } : {}),
    },
  });
const page = (cursor: string | null = null) =>
  body({ items: [row], next_cursor: cursor });
const all: { queries: ReadQueries; session: Session }[] = [];
function login(session: Session) {
  session.accept(session.begin(), {
    accessToken: "synthetic-token",
    expiresAt: Date.now() + 3600_000,
  });
}
function setup(request = vi.fn<typeof fetch>()) {
  const session = new Session();
  login(session);
  const queries = new ReadQueries(origin, session, request);
  all.push({ queries, session });
  return { queries, session, request };
}
async function finish<T>(pending: Promise<T>, elapsed = 30_000): Promise<T> {
  const result = pending.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.advanceTimersByTimeAsync(elapsed);
  const settled = await result;
  if ("error" in settled) throw settled.error;
  return settled.value;
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  all.forEach(({ queries, session }) => {
    queries.dispose();
    session.end();
  });
  all.length = 0;
  vi.useRealTimers();
});

describe("bounded reads", () => {
  it("does not cache oversized projections and evicts within the cache character budget", async () => {
    const { queries, request } = setup();
    request.mockImplementation(async () => page());
    const oversized = (value: unknown) => ({
      ...storeSummary(value),
      note: "x".repeat(100_001),
    });
    await queries.page("stores", {}, oversized);
    await finish(queries.page("stores", {}, oversized), 1000);
    expect(request).toHaveBeenCalledTimes(2);
    const large = (value: unknown) => ({
      ...storeSummary(value),
      note: "x".repeat(90_000),
    });
    for (let i = 0; i < 12; i++)
      await finish(
        queries.page("stores", { after: `opaque-${i}` }, large),
        1000,
      );
    await finish(queries.page("stores", { after: "opaque-0" }, large), 1000);
    expect(request).toHaveBeenCalledTimes(15);
  });
  it("bounds distinct pending jobs and cancels them on disposal", async () => {
    const { queries, request } = setup();
    request.mockImplementation(() => new Promise(() => undefined));
    const pending = Array.from({ length: 32 }, (_, i) =>
      queries
        .page("stores", { after: `opaque-${i}` }, storeSummary)
        .catch((error: unknown) => error),
    );
    await expect(
      queries.page("stores", { after: "one-more" }, storeSummary),
    ).rejects.toMatchObject({ code: "unavailable" });
    queries.dispose();
    expect(
      (await Promise.all(pending)).every(
        (error) => (error as { code: string }).code === "cancelled",
      ),
    ).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not deliver a cache hit cancelled by logout before continuation", async () => {
    const { queries, request, session } = setup();
    request.mockImplementation(async () => page());
    await queries.page("stores", {}, storeSummary);
    const cached = queries.page("stores", {}, storeSummary);
    session.end();
    await expect(cached).rejects.toMatchObject({ code: "cancelled" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("deduplicates canonical query order and isolates consumer/cache mutations", async () => {
    const { queries, request } = setup();
    request.mockImplementation(async () => page());
    const a = queries.page("stores", { store_id: id, limit: 50 }, storeSummary);
    const b = queries.page("stores", { limit: 50, store_id: id }, storeSummary);
    const [first, second] = await Promise.all([a, b]);
    expect(request).toHaveBeenCalledTimes(1);
    first.items[0]!.name = "Changed only by consumer";
    expect(second.items[0]!.name).toBe("Synthetic shop");
    expect(
      (await queries.page("stores", { store_id: id }, storeSummary)).items[0]!
        .name,
    ).toBe("Synthetic shop");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("keeps decoder identity, filters and cursors separate", async () => {
    const { queries, request } = setup();
    request.mockImplementation(async () => page());
    const alternate = (value: unknown) => ({
      selectedId: storeSummary(value).id,
    });
    await queries.page("stores", { store_id: id }, storeSummary);
    await finish(
      queries.page("stores", { store_id: other }, storeSummary),
      1000,
    );
    await finish(
      queries.page("stores", { store_id: id, after: "opaque" }, storeSummary),
      1000,
    );
    expect(
      (await finish(queries.page("stores", { store_id: id }, alternate), 1000))
        .items,
    ).toEqual([{ selectedId: id }]);
    expect(request).toHaveBeenCalledTimes(4);
  });
  it("expires its cache and permits explicit refresh", async () => {
    const { queries, request } = setup();
    request.mockImplementation(async () => page());
    await queries.page("stores", {}, storeSummary);
    await finish(
      queries.page("stores", {}, storeSummary, { refresh: true }),
      1000,
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await queries.page("stores", {}, storeSummary);
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("does not share cached values with a replacement session", async () => {
    const { queries, request, session } = setup();
    request.mockImplementation(async () => page());
    await queries.page("stores", {}, storeSummary);
    login(session);
    await finish(queries.page("stores", {}, storeSummary), 1000);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("cancels one subscriber without cancelling the other", async () => {
    let deliver!: (response: Response) => void;
    const { queries, request } = setup();
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const cancellation = new AbortController();
    const a = queries.page("stores", {}, storeSummary, {
      signal: cancellation.signal,
    });
    const b = queries.page("stores", {}, storeSummary);
    cancellation.abort();
    await expect(a).rejects.toMatchObject({ code: "cancelled" });
    expect(request.mock.calls[0]![1]!.signal!.aborted).toBe(false);
    deliver(page());
    expect((await b).items).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("aborts when the last subscriber leaves and prevents late cache writes", async () => {
    let deliver!: (response: Response) => void;
    const { queries, request } = setup();
    request
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            deliver = resolve;
          }),
      )
      .mockImplementation(async () => page());
    const cancellation = new AbortController();
    const pending = queries.page("stores", {}, storeSummary, {
      signal: cancellation.signal,
    });
    cancellation.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(request.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    deliver(page());
    await finish(queries.page("stores", {}, storeSummary), 1000);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each(["logout", "expiry", "dispose"])(
    "cancels pending work on %s",
    async (reason) => {
      const { queries, request, session } = setup();
      request.mockImplementation(() => new Promise(() => undefined));
      const pending = queries.page("stores", {}, storeSummary);
      const rejected = expect(pending).rejects.toMatchObject({
        code: "cancelled",
      });
      if (reason === "logout") session.end();
      else if (reason === "dispose") queries.dispose();
      else {
        vi.setSystemTime(session.credentials!.expiresAt);
        session.checkExpiry();
      }
      await rejected;
      expect(request.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    },
  );
  it("handles out-of-order filtered responses separately", async () => {
    const deliveries: ((response: Response) => void)[] = [];
    const { queries, request } = setup();
    request.mockImplementation(
      () => new Promise((resolve) => deliveries.push(resolve)),
    );
    const a = queries.page("stores", { store_id: id }, storeSummary);
    const b = queries.page("stores", { store_id: other }, storeSummary);
    await vi.advanceTimersByTimeAsync(1000);
    deliveries[1]!(body({ items: [{ ...row, id: other }], next_cursor: null }));
    expect((await b).items[0]!.id).toBe(other);
    deliveries[0]!(page());
    expect((await a).items[0]!.id).toBe(id);
    expect(
      (await queries.page("stores", { store_id: other }, storeSummary))
        .items[0]!.id,
    ).toBe(other);
  });
  it.each([429, 503])(
    "stops after three transient attempts for HTTP %i",
    async (status) => {
      const { queries, request } = setup();
      request.mockImplementation(async () => body({}, status));
      await expect(
        finish(queries.page("stores", {}, storeSummary)),
      ).rejects.toHaveProperty("status", status);
      expect(request).toHaveBeenCalledTimes(3);
    },
  );
  it.each([401, 403, 422, 500])("does not retry HTTP %i", async (status) => {
    const { queries, request, session } = setup();
    request.mockImplementation(async () => body({}, status));
    await expect(
      queries.page("stores", {}, storeSummary),
    ).rejects.toBeDefined();
    expect(request).toHaveBeenCalledTimes(1);
    expect(Boolean(session.credentials)).toBe(status !== 401);
  });
  it("respects readable Retry-After seconds and uses bounded fallback if hidden", async () => {
    const { queries, request } = setup();
    request
      .mockResolvedValueOnce(body({}, 429, "5"))
      .mockResolvedValueOnce(body({}, 503))
      .mockImplementation(async () => page());
    const pending = queries.page("stores", {}, storeSummary);
    await vi.advanceTimersByTimeAsync(4999);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("handles HTTP-date Retry-After and refuses waits exceeding ten seconds", async () => {
    const { queries, request } = setup();
    request
      .mockResolvedValueOnce(
        body({}, 503, new Date(Date.now() + 4000).toUTCString()),
      )
      .mockImplementation(async () => page());
    await finish(queries.page("stores", {}, storeSummary), 4000);
    expect(request).toHaveBeenCalledTimes(2);
    request.mockImplementation(async () => body({}, 429, "11"));
    await expect(
      finish(queries.page("stores", {}, storeSummary, { refresh: true }), 1000),
    ).rejects.toHaveProperty("status", 429);
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("stops backoff and queued work after logout", async () => {
    const { queries, request, session } = setup();
    request.mockImplementation(async () => body({}, 503));
    const pending = queries.page("stores", {}, storeSummary);
    const rejected = expect(pending).rejects.toMatchObject({
      code: "cancelled",
    });
    await vi.advanceTimersByTimeAsync(100);
    session.end();
    await rejected;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("halves 413 limits down to one, preserving filters and cursor", async () => {
    const { queries, request } = setup();
    request.mockImplementation(async (destination) => {
      const url = new URL(String(destination));
      return url.searchParams.get("limit") === "1" ? page() : body({}, 413);
    });
    const result = await finish(
      queries.page(
        "stores",
        { limit: 200, store_id: id, after: "opaque" },
        storeSummary,
      ),
    );
    expect(result.limit).toBe(1);
    expect(
      request.mock.calls.map(([url]) =>
        new URL(String(url)).searchParams.get("limit"),
      ),
    ).toEqual(["200", "100", "50", "25", "12", "6", "3", "1"]);
    expect(
      request.mock.calls.every(([url]) => {
        const query = new URL(String(url)).searchParams;
        return query.get("store_id") === id && query.get("after") === "opaque";
      }),
    ).toBe(true);
  });
  it("fails explicitly on persistent 413 without retrying limit one", async () => {
    const { queries, request } = setup();
    request.mockImplementation(async () => body({}, 413));
    await expect(
      finish(queries.page("stores", { limit: 200 }, storeSummary)),
    ).rejects.toMatchObject({ code: "too-large" });
    expect(request).toHaveBeenCalledTimes(8);
  });
  it("shares one transient counter across reduced limits", async () => {
    const { queries, request } = setup();
    request
      .mockResolvedValueOnce(body({}, 503))
      .mockResolvedValueOnce(body({}, 413))
      .mockResolvedValueOnce(body({}, 429))
      .mockImplementation(async () => body({}, 503));
    await expect(
      finish(queries.page("stores", {}, storeSummary)),
    ).rejects.toHaveProperty("status", 503);
    expect(request).toHaveBeenCalledTimes(4);
  });
  it("rejects invalid queries before starting work", async () => {
    const { queries, request } = setup();
    await expect(
      queries.page("stores", { url: origin } as Query, storeSummary),
    ).rejects.toThrow("API invalid-request");
    expect(request).not.toHaveBeenCalled();
  });
});

describe("bounded collections", () => {
  it("reads two pages with opaque cursors and freshness checks, deduplicating the batch", async () => {
    const { queries, request } = setup();
    request.mockImplementation(async (destination) => {
      const url = new URL(String(destination));
      if (url.pathname.endsWith("status")) return body(freshness);
      return page(url.searchParams.has("after") ? null : "opaque+/=");
    });
    const a = queries.collect(
      "stores",
      { store_id: id, limit: 1 },
      storeSummary,
    );
    const b = queries.collect(
      "stores",
      { limit: 1, store_id: id },
      storeSummary,
    );
    const result = await finish(a);
    expect(await b).toEqual(result);
    expect(result).toMatchObject({
      complete: true,
      reason: null,
      nextCursor: null,
      attempts: 4,
    });
    expect(result.items).toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(4);
    const pages = request.mock.calls.filter(([url]) =>
      String(url).includes("/data/"),
    );
    expect(
      pages.every(
        ([url]) => new URL(String(url)).searchParams.get("store_id") === id,
      ),
    ).toBe(true);
    expect(new URL(String(pages[1]![0])).searchParams.get("after")).toBe(
      "opaque+/=",
    );
  });
  it.each(["page-limit", "item-limit"])(
    "identifies incomplete data at %s",
    async (reason) => {
      const { queries, request } = setup();
      let cursor = 0;
      request.mockImplementation(async (url) =>
        String(url).endsWith("status")
          ? body(freshness)
          : page(`opaque-${++cursor}`),
      );
      const result = await finish(
        queries.collect(
          "stores",
          {},
          storeSummary,
          reason === "page-limit" ? { maxPages: 1 } : { maxItems: 1 },
        ),
      );
      expect(result).toMatchObject({
        complete: false,
        reason,
        nextCursor: "opaque-1",
        attempts: 3,
      });
      expect(result.items).toHaveLength(1);
    },
  );
  it.each(["repeated", "empty", "empty-page"])(
    "rejects %s cursors without a loop",
    async (kind) => {
      const { queries, request } = setup();
      request.mockImplementation(async (url) =>
        String(url).endsWith("status")
          ? body(freshness)
          : body({
              items: kind === "empty-page" ? [] : [row],
              next_cursor: kind === "empty" ? "" : "opaque",
            }),
      );
      await expect(
        finish(queries.collect("stores", { limit: 1 }, storeSummary)),
      ).rejects.toMatchObject({ code: "invalid-response" });
      expect(request.mock.calls.length).toBeLessThanOrEqual(3);
    },
  );
  it("rejects an invalid server cursor without retry", async () => {
    const { queries, request } = setup();
    request.mockImplementation(async (url) =>
      String(url).endsWith("status") ? body(freshness) : body({}, 422),
    );
    await expect(
      finish(
        queries.collect("stores", { after: "opaque-invalid" }, storeSummary),
      ),
    ).rejects.toHaveProperty("status", 422);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("carries a reduced limit into the next page", async () => {
    const { queries, request } = setup();
    request.mockImplementation(async (destination) => {
      const url = new URL(String(destination));
      if (url.pathname.endsWith("status")) return body(freshness);
      if (url.searchParams.get("limit") !== "1") return body({}, 413);
      return page(url.searchParams.has("after") ? null : "opaque");
    });
    expect(
      (await finish(queries.collect("stores", { limit: 4 }, storeSummary)))
        .complete,
    ).toBe(true);
    expect(
      request.mock.calls
        .filter(([url]) => String(url).includes("/data/"))
        .map(([url]) => new URL(String(url)).searchParams.get("limit")),
    ).toEqual(["4", "2", "1", "1"]);
  });
  it("drops the batch and cache when freshness changes", async () => {
    const { queries, request } = setup();
    let statuses = 0;
    request.mockImplementation(async (url) =>
      String(url).endsWith("status")
        ? body({ ...freshness, state: ++statuses > 1 ? "stale" : "current" })
        : page(),
    );
    await queries.page("stores", {}, storeSummary);
    const result = await finish(queries.collect("stores", {}, storeSummary));
    expect(result).toMatchObject({
      complete: false,
      reason: "freshness-changed",
      items: [],
    });
    await queries.page("stores", {}, storeSummary);
    expect(request).toHaveBeenCalledTimes(5);
  });
  it("never exceeds 24 total attempts including freshness and reductions", async () => {
    const { queries, request } = setup();
    let statuses = 0;
    const pageAttempts = new Map<string, number>();
    let cursor = 0;
    request.mockImplementation(async (destination) => {
      const url = new URL(String(destination));
      if (url.pathname.endsWith("status"))
        return ++statuses < 3 ? body({}, 503) : body(freshness);
      const key = url.searchParams.get("after") ?? "first";
      const attempt = (pageAttempts.get(key) ?? 0) + 1;
      pageAttempts.set(key, attempt);
      if (attempt <= 2) return body({}, 503);
      if (attempt <= 4 && url.searchParams.get("limit") !== "1")
        return body({}, 413);
      return page(`opaque-${++cursor}`);
    });
    const result = await finish(
      queries.collect("stores", { limit: 200 }, storeSummary),
      60_000,
    );
    expect(request).toHaveBeenCalledTimes(24);
    expect(result.complete).toBe(false);
    expect(result.reason).toBe("attempt-limit");
    expect(result.items).toHaveLength(4);
  });
});
