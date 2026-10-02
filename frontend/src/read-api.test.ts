import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadApi, resourceNames } from "./read-api";
import type { Query, ResourceName } from "./read-api";
import { Session } from "./session";
import {
  decimal,
  date,
  timestamp,
  nullable,
  object,
  storeSummary,
} from "./api-validation";

const origin = "https://api.example.test";
const id = "00000000-0000-4000-8000-000000000001";
const store = {
  id,
  name: "Synthetic shop",
  retailer_name: null,
  city: null,
  is_active: true,
};
const body = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
const sessions: Session[] = [];
function login(session: Session, token = "synthetic-token") {
  session.accept(session.begin(), {
    accessToken: token,
    expiresAt: Date.now() + 60_000,
  });
}
function setup(request = vi.fn<typeof fetch>()) {
  const session = new Session();
  sessions.push(session);
  login(session);
  return { session, request, api: new ReadApi(origin, session, request) };
}
afterEach(() => {
  sessions.forEach((session) => session.end());
  sessions.length = 0;
});

describe("read transport", () => {
  it("preserves the native fetch receiver for the default browser transport", async () => {
    const session = new Session();
    sessions.push(session);
    login(session);
    const native = vi.spyOn(globalThis, "fetch").mockImplementation(function (
      this: unknown,
    ) {
      expect(this).toBe(globalThis);
      return Promise.resolve(body({ items: [store], next_cursor: null }));
    });
    const api = new ReadApi(origin, session);
    expect(
      (await api.page("stores", { limit: 1 }, storeSummary)).items,
    ).toHaveLength(1);
    expect(native).toHaveBeenCalledOnce();
  });
  it("keeps its fixed resource list aligned with the public backend registry", () => {
    const registry = JSON.parse(
      readFileSync("../src/retail_data_platform/api/resources.json", "utf8"),
    ) as Record<string, unknown>;
    expect([...resourceNames].sort()).toEqual(Object.keys(registry).sort());
  });
  it("sends a single protected GET and returns only validated store fields", async () => {
    const { api, request } = setup();
    request.mockResolvedValue(
      body({
        items: [{ ...store, unused_private_field: "synthetic-only" }],
        next_cursor: "opaque+/=",
      }),
    );
    expect(
      await api.page(
        "stores",
        { store_id: id, limit: 1, after: "opaque+/=" },
        storeSummary,
      ),
    ).toEqual({
      items: [
        {
          id,
          name: "Synthetic shop",
          retailerName: null,
          city: null,
          isActive: true,
        },
      ],
      nextCursor: "opaque+/=",
    });
    const [url, options] = request.mock.calls[0]!;
    expect(String(url)).toBe(
      `${origin}/v1/data/stores?store_id=${id}&limit=1&after=opaque%2B%2F%3D`,
    );
    expect(String(url)).not.toContain("synthetic-token");
    expect(options).toMatchObject({
      method: "GET",
      headers: { Authorization: "Bearer synthetic-token" },
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("validates the catalog but never follows a catalog destination", async () => {
    const { api, request } = setup();
    const entry = {
      name: "stores",
      columns: ["id"],
      keys: ["id"],
      filters: ["store_id"],
      path: "/v1/data/stores",
    };
    request
      .mockResolvedValueOnce(body([entry]))
      .mockResolvedValueOnce(
        body([{ ...entry, path: "https://outside.example.test/" }]),
      );
    expect(await api.resources()).toEqual([entry]);
    await expect(api.resources()).rejects.toMatchObject({
      code: "invalid-response",
    });
    expect(
      request.mock.calls.every(
        ([url]) => String(url) === `${origin}/v1/resources`,
      ),
    ).toBe(true);
  });
  it.each([
    [],
    { items: [], next_cursor: 5 },
    { items: [store] },
    { items: [store, store], next_cursor: null },
    { items: [{ ...store, id: "bad" }], next_cursor: null },
    { items: [{ ...store, name: 7 }], next_cursor: null },
    { items: [{ ...store, is_active: null }], next_cursor: null },
  ])("rejects a malformed envelope or used field", async (value) => {
    const { api, request } = setup();
    request.mockResolvedValue(body(value));
    await expect(
      api.page("stores", { limit: 1 }, storeSummary),
    ).rejects.toMatchObject({ code: "invalid-response" });
  });
  it("preserves exact decimal strings and distinguishes null from zero", async () => {
    const { api, request } = setup();
    request.mockResolvedValue(
      body({
        items: [
          {
            period: "2026-09-01",
            revenue: "9007199254740993.01",
            units: "0",
            calls: null,
          },
        ],
        next_cursor: null,
      }),
    );
    const result = await api.page("analytics_store_month", {}, (value) => {
      const row = object(value);
      return {
        period: date(row.period),
        revenue: nullable(decimal)(row.revenue),
        units: nullable(decimal)(row.units),
        calls: nullable(decimal)(row.calls),
      };
    });
    expect(result.items[0]).toEqual({
      period: "2026-09-01",
      revenue: "9007199254740993.01",
      units: "0",
      calls: null,
    });
  });
  it("validates freshness without converting its timestamp", async () => {
    const { api, request } = setup();
    request
      .mockResolvedValueOnce(
        body({
          state: "stale",
          last_completed_at: "2026-09-01T10:30:00.123456+00:00",
          last_attempt_status: "failed",
        }),
      )
      .mockResolvedValueOnce(
        body({
          state: "uninitialized",
          last_completed_at: null,
          last_attempt_status: null,
        }),
      )
      .mockResolvedValueOnce(
        body({
          state: "unknown",
          last_completed_at: null,
          last_attempt_status: null,
        }),
      );
    expect(await api.status()).toEqual({
      state: "stale",
      lastCompletedAt: "2026-09-01T10:30:00.123456+00:00",
      lastAttemptStatus: "failed",
    });
    expect(await api.status()).toMatchObject({ lastCompletedAt: null });
    await expect(api.status()).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
  it.each([403, 413, 422, 429, 503, 500])(
    "reports HTTP %i without retrying or exposing its body",
    async (status) => {
      const { api, request, session } = setup();
      request.mockResolvedValue(
        body({ error: "synthetic-sensitive-sentinel" }, status),
      );
      const error: unknown = await api
        .resources()
        .catch((error: unknown) => error);
      expect(String(error)).not.toContain("synthetic-sensitive-sentinel");
      expect(error).toHaveProperty(
        "code",
        {
          403: "forbidden",
          413: "too-large",
          422: "invalid-request",
          429: "rate-limited",
          503: "unavailable",
          500: "unavailable",
        }[status],
      );
      expect(request).toHaveBeenCalledTimes(1);
      expect(session.credentials).toBeDefined();
    },
  );
  it("ends the session on a current 401 and aborts sibling work", async () => {
    const { api, request, session } = setup();
    let siblingSignal: AbortSignal | null | undefined;
    request
      .mockImplementationOnce((_url, options) => {
        siblingSignal = options?.signal;
        return new Promise(() => undefined);
      })
      .mockResolvedValueOnce(body({}, 401));
    const sibling = api.resources();
    const cancelled = expect(sibling).rejects.toMatchObject({
      code: "cancelled",
    });
    await expect(api.status()).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(session.credentials).toBeUndefined();
    expect(siblingSignal?.aborted).toBe(true);
    await cancelled;
  });
  it.each([200, 401, 403])(
    "discards late HTTP %i after a new login even when fetch ignores abort",
    async (status) => {
      let deliver!: (response: Response) => void;
      const { api, request, session } = setup();
      request.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            deliver = resolve;
          }),
      );
      const pending = api.resources();
      login(session, "new-synthetic-token");
      deliver(body([], status));
      await expect(pending).rejects.toMatchObject({ code: "cancelled" });
      expect(session.credentials?.accessToken).toBe("new-synthetic-token");
    },
  );
  it("rejects a late network error after logout", async () => {
    let reject!: (reason: unknown) => void;
    const { api, request, session } = setup();
    request.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const pending = api.resources();
    session.end();
    reject(new Error("synthetic-sensitive-sentinel"));
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });
  it("discards a body completed after expiry even when the stream ignores abort", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const { api, request, session } = setup();
    request.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const pending = api.resources();
    await Promise.resolve();
    const deadline = session.credentials!.expiresAt;
    vi.spyOn(Date, "now").mockReturnValue(deadline);
    controller.enqueue(new TextEncoder().encode("[]"));
    controller.close();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(session.getSnapshot().phase).toBe("expired");
  });
  it("applies the ten-second deadline to the request signal", async () => {
    const { api, request } = setup();
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((delay) => {
      expect(delay).toBe(10_000);
      return timeout.signal;
    });
    request.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener(
            "abort",
            () => reject(new Error("timeout")),
            { once: true },
          );
        }),
    );
    const pending = api.resources();
    timeout.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });
  it("makes network failure explicit without retaining its cause", async () => {
    const { api, request } = setup();
    request.mockRejectedValue(new Error("synthetic-sensitive-sentinel"));
    await expect(api.resources()).rejects.toMatchObject({
      code: "network",
      message: "API network",
    });
  });
  it("rejects unauthenticated and cancelled calls without fetching", async () => {
    const { api, request, session } = setup();
    await expect(api.resources(AbortSignal.abort())).rejects.toMatchObject({
      code: "cancelled",
    });
    session.end();
    await expect(api.resources()).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    "https://outside.example.test/path",
    "//outside.example.test",
    "../stores",
    "stores?token=bad",
  ])("rejects arbitrary resource destinations", async (name) => {
    const { api, request } = setup();
    await expect(
      api.page(name as ResourceName, {}, storeSummary),
    ).rejects.toMatchObject({ code: "invalid-request" });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    { limit: 0 },
    { limit: 201 },
    { after: "x".repeat(8193) },
    { url: origin },
    { store_id: "bad" },
    { period_from: "2026-02-30" },
    { period_from: "2026-09-02" },
    { period_from: "2026-09-01", period_to: "2026-08-01" },
  ])("refuses invalid queries before fetching", async (query) => {
    const { api, request } = setup();
    await expect(
      api.page("stores", query as Query, storeSummary),
    ).rejects.toMatchObject({ code: "invalid-request" });
    expect(request).not.toHaveBeenCalled();
  });
  it("refuses redirected responses", async () => {
    const { api, request } = setup();
    const response = body([]);
    Object.defineProperty(response, "redirected", { value: true });
    request.mockResolvedValue(response);
    await expect(api.resources()).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
  it.each([
    new Response("not json", {
      headers: { "content-type": "application/json" },
    }),
    new Response("[]", { headers: { "content-type": "text/html" } }),
    new Response(new Uint8Array([0xff]), {
      headers: { "content-type": "application/json" },
    }),
  ])("rejects malformed JSON, media type and encoding", async (response) => {
    const { api, request } = setup();
    request.mockResolvedValue(response);
    await expect(api.resources()).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
  it("bounds streamed responses even without Content-Length", async () => {
    const { api, request } = setup();
    request.mockResolvedValue(
      new Response(" ".repeat(2_000_001), {
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(api.resources()).rejects.toMatchObject({ code: "too-large" });
  });
  it.each([
    "http://outside.example.test",
    "https://api.example.test/path",
    "https://user:password@api.example.test",
  ])("refuses invalid configured origins", (value) => {
    expect(() => new ReadApi(value, new Session())).toThrow(
      "API invalid-request",
    );
  });
});

describe("value decoders", () => {
  it("preserves scientific decimal notation emitted by Decimal serializers", () => {
    expect(decimal("0E-10")).toBe("0E-10");
    expect(decimal("1E-20")).toBe("1E-20");
  });
  it.each([0, null, "NaN", " 1", "Infinity"])(
    "rejects non-contract decimals",
    (value) => {
      expect(() => decimal(value)).toThrow("Invalid response");
    },
  );
  it.each(["2026-02-30", "2026-13-01", "2026-09-01T00:00:00Z"])(
    "rejects invalid date strings",
    (value) => {
      expect(() => date(value)).toThrow();
    },
  );
  it.each([
    "2026-02-30T00:00:00Z",
    "2026-09-01T24:00:00Z",
    "2026-09-01T00:00:00",
  ])("rejects invalid timestamps", (value) => {
    expect(() => timestamp(value)).toThrow();
  });
});
