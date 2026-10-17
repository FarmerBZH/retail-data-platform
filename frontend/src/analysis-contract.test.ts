import { execFileSync } from "node:child_process";
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  analysisDecoders,
  analysisParameters,
  decodeAnalysis,
} from "./analysis-contract";
import type { AnalysisQuery, AnalysisRoute } from "./analysis-contract";
import {
  analysisFixture,
  fixedWindow,
  publication,
  syntheticId,
} from "../test/analysis-fixture";
import { ReadApi } from "./read-api";
import { ReadQueries } from "./read-queries";
import { Session } from "./session";
const pair: AnalysisQuery = {
  ...fixedWindow,
  scope: "selection",
  store_ids: [syntheticId(1), syntheticId(2)],
  publication_id: publication,
};
const sessions: Session[] = [];
afterEach(() => {
  sessions.forEach((s) => s.end());
  sessions.length = 0;
});
function setup(request: typeof fetch) {
  const session = new Session();
  sessions.push(session);
  session.accept(session.begin(), {
    accessToken: "synthetic-token",
    expiresAt: Date.now() + 60000,
  });
  return {
    session,
    api: new ReadApi("https://api.example.test", session, request),
    reads: new ReadQueries("https://api.example.test", session, request),
  };
}
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "content-type": "application/json" },
  });
describe("dedicated analytic contracts", () => {
  it("retains the independently specified A/B oracle and all routes", () => {
    const result = decodeAnalysis(
      "summary",
      analysisFixture("summary", pair),
      pair,
    );
    expect(result.metrics.revenue.current).toEqual({
      value: null,
      partial: "120",
      covered_cell_count: 1,
      expected_cell_count: 2,
    });
    expect(result.metrics.revenue.cohort).toMatchObject({
      store_count: 1,
      excluded_store_count: 1,
      current: "120",
      reference: "100",
      change: { difference: "20", ratio: "0.2" },
    });
    expect(result.revenue_contribution_sum).toBe("20");
    for (const route of Object.keys(analysisDecoders) as AnalysisRoute[]) {
      const q: AnalysisQuery =
        route === "stores"
          ? { publication_id: publication }
          : route === "dimensions"
            ? { publication_id: publication, dimension: "region_code" }
            : pair;
      expect(() =>
        decodeAnalysis(route, analysisFixture(route, q), q),
      ).not.toThrow();
    }
  });
  it.each([
    { scope: "selection" },
    { scope: "all", store_ids: [syntheticId(1)] },
    { scope: "selection", store_ids: [syntheticId(1), syntheticId(1)] },
    {
      scope: "selection",
      store_ids: Array.from({ length: 101 }, (_, i) => syntheticId(i)),
    },
    { publication_id: "private-value" },
    { limit: 0 },
    { limit: 201 },
    { after: "cursor" },
    { q: "x" },
    { sql: "DROP" },
    { period_from: "2025-02-02", period_to: "2025-03-01" },
    { period_from: "2025-03-01", period_to: "2025-02-01" },
    { period_from: "2025-01-01", period_to: "2035-01-01" },
    { period_from: "0001-01-01", period_to: "0001-01-01" },
  ])("rejects invalid summary query without a network call", (q) =>
    expect(() => analysisParameters("summary", q as AnalysisQuery)).toThrow(),
  );
  it("normalizes ID order and preserves literal filters and the publication", () => {
    const params = analysisParameters("ranking", {
      ...pair,
      store_ids: [syntheticId(2), syntheticId(1)],
      retailer_name: "%_ ' literal",
      after: "opaque",
      limit: 1,
    });
    expect(params.getAll("store_ids")).toEqual([
      syntheticId(1),
      syntheticId(2),
    ]);
    expect(params.get("retailer_name")).toBe("%_ ' literal");
    expect(params.get("publication_id")).toBe(publication);
    expect(() =>
      analysisParameters("store-series", { ...pair, limit: 7 }),
    ).toThrow();
    expect(() =>
      analysisParameters("dimensions", { dimension: "name" as "region_code" }),
    ).toThrow();
  });
  it.each([
    "extra",
    "missing",
    "number",
    "scope",
    "publication",
    "date",
    "reference",
  ])("refuses %s mismatch", (kind) => {
    const value = structuredClone(
      decodeAnalysis("summary", analysisFixture("summary", pair), pair),
    );
    if (kind === "extra") Reflect.set(value, "private", 123);
    if (kind === "missing")
      Reflect.deleteProperty(value.metrics.revenue.current, "partial");
    if (kind === "number")
      Reflect.set(value.metrics.revenue.current, "partial", 120);
    if (kind === "scope") value.context.scope.scope_store_count = 99;
    if (kind === "publication") value.context.publication_id = syntheticId(99);
    if (kind === "date") value.context.window!.start = "2025-02-02";
    if (kind === "reference") value.context.reference!.start = "2024-02-01";
    expect(() => decodeAnalysis("summary", value, pair)).toThrow();
  });
  it("sends fixed paths with bearer, no cookies/storage/redirects and rejects 409", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      json(analysisFixture("summary", pair)),
    );
    const { api } = setup(request);
    const result = await api.analysis("summary", pair);
    expect(result.metrics.revenue.current.partial).toBe("120");
    const [url, options] = request.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe(
      "/v1/analytics/analysis/summary",
    );
    expect(options).toMatchObject({
      method: "GET",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    request.mockImplementation(async () =>
      json({ error: "publication_changed" }, 409),
    );
    await expect(api.analysis("summary", pair)).rejects.toMatchObject({
      code: "publication-changed",
      status: 409,
    });
  });
  it("evicts pinned cached analysis on 409 and on a new login", async () => {
    let conflict = false;
    const request = vi.fn<typeof fetch>(async () =>
      conflict
        ? json({ error: "publication_changed" }, 409)
        : json(analysisFixture("summary", pair)),
    );
    const { reads, session } = setup(request);
    await reads.analysis("summary", pair);
    await reads.analysis("summary", pair);
    expect(request).toHaveBeenCalledTimes(1);
    conflict = true;
    await expect(
      reads.analysis("summary", pair, { refresh: true }),
    ).rejects.toMatchObject({ code: "publication-changed" });
    conflict = false;
    await reads.analysis("summary", pair);
    expect(request).toHaveBeenCalledTimes(3);
    session.end();
    session.accept(session.begin(), {
      accessToken: "replacement",
      expiresAt: Date.now() + 60000,
    });
    await reads.analysis("summary", pair);
    expect(request).toHaveBeenCalledTimes(4);
    reads.dispose();
  });
  it("does not retain an unpinned discovery identity in the cache", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      json(analysisFixture("availability", {})),
    );
    const { reads } = setup(request);
    await reads.analysis("availability", {});
    await reads.analysis("availability", {});
    expect(request).toHaveBeenCalledTimes(2);
    reads.dispose();
  });
});

it("keeps every decoded projection aligned with the Python serialization models", () => {
  const fixtures = Object.fromEntries(
    (Object.keys(analysisDecoders) as AnalysisRoute[]).map((route) => {
      const q: AnalysisQuery =
        route === "stores"
          ? { publication_id: publication }
          : route === "dimensions"
            ? { publication_id: publication, dimension: "region_code" }
            : pair;
      return [route, { query: q, value: analysisFixture(route, q) }];
    }),
  );
  const models = JSON.parse(
    execFileSync(
      "../.venv/bin/python",
      [
        "-I",
        "-c",
        `
import json,sys
from retail_data_platform.api import analysis_models as m
models={'stores':m.Page[m.StoreItem],'dimensions':m.DimensionPage,'summary':m.Summary,'series':m.Series,'ranking':m.Page[m.RankingItem],'store-series':m.Page[m.StoreSeries],'availability':m.Availability}
values=json.load(sys.stdin)
print(json.dumps({name:models[name].model_validate(item['value']).model_dump(mode='json') for name,item in values.items()}))
`,
      ],
      {
        input: JSON.stringify(fixtures),
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 2000000,
      },
    ),
  ) as Record<AnalysisRoute, unknown>;
  for (const route of Object.keys(fixtures) as AnalysisRoute[]) {
    expect(
      decodeAnalysis(route, fixtures[route]!.value, fixtures[route]!.query),
    ).toEqual(models[route]);
  }
});

it("rejects truncated calendars and duplicate rows instead of reporting a complete result", () => {
  const series = decodeAnalysis(
    "series",
    analysisFixture("series", pair),
    pair,
  );
  series.items = [];
  expect(() => decodeAnalysis("series", series, pair)).toThrow();
  const stores = decodeAnalysis("stores", analysisFixture("stores", {}), {});
  stores.items = [stores.items[0]!, stores.items[0]!];
  expect(() => decodeAnalysis("stores", stores, {})).toThrow();
  const available = decodeAnalysis(
    "availability",
    analysisFixture("availability", pair),
    pair,
  );
  available.items[0]!.months = [];
  expect(() => decodeAnalysis("availability", available, pair)).toThrow();
});
