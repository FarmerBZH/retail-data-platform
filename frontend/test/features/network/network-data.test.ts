import { expect, it, vi } from "vitest";
import { loadNetwork } from "../../../src/features/network/network-data";
import type { NetworkReads } from "../../../src/features/network/network-data";
import { syntheticResource } from "../../fixtures/published-fixture";
import { syntheticNetwork } from "../../fixtures/network-fixture";
import { resourceNames } from "../../../src/api/read-api";
const freshness = {
  state: "current" as const,
  lastCompletedAt: "2026-01-01T00:00:00Z",
  lastAttemptStatus: "succeeded" as const,
};
function services() {
  return {
    status: vi.fn(async () => freshness),
    resources: vi.fn(async () => resourceNames.map(syntheticResource)),
    collect: vi.fn<NetworkReads["collect"]>(async (name, _query, decode) => ({
      items: [decode(syntheticNetwork(name))],
      complete: true,
      nextCursor: null,
      reason: null,
      attempts: 3,
    })),
  };
}
const signal = () => new AbortController().signal;
const period = { from: "2026-01", to: "2026-03", months: 3 };
it("uses server overview without period or store filters and preserves exact/null/zero values", async () => {
  const reads = services();
  const result = await loadNetwork(
    reads,
    { mode: "overview", period },
    signal(),
  );
  expect(result.rows[0]).toMatchObject({
    revenue: null,
    revenue_partial: "0.3",
    units: "0",
    calls_partial: null,
  });
  expect(reads.collect).toHaveBeenCalledWith(
    "analytics_network_overview",
    { scope: "network", limit: 50 },
    expect.any(Function),
    expect.objectContaining({ maxItems: 120, maxPages: 5 }),
  );
});
it("selects annual January keys without trimming annual totals to the month interval", async () => {
  const reads = services();
  await loadNetwork(
    reads,
    { mode: "year", period: { from: "2026-04", to: "2026-05", months: 2 } },
    signal(),
  );
  expect(reads.collect.mock.calls[0]?.[1]).toEqual({
    period_from: "2026-01-01",
    period_to: "2026-01-01",
    limit: 50,
  });
});
it("keeps monthly comparison history on the server and isolates a comparison failure", async () => {
  const reads = services();
  reads.collect.mockImplementation(async (name, _q, decode) => {
    if (name.endsWith("changes")) throw new Error("private upstream detail");
    return {
      items: [decode(syntheticNetwork(name))],
      complete: true,
      nextCursor: null,
      reason: null,
      attempts: 3,
    };
  });
  const result = await loadNetwork(reads, { mode: "month", period }, signal());
  expect(result.rows).toHaveLength(1);
  expect(result.comparisonError).toMatch(/indisponibles/);
  expect(result.comparisonError).not.toContain("private");
  expect(reads.collect.mock.calls[1]?.[1]).toEqual({
    period_from: "2026-01-01",
    period_to: "2026-03-01",
    limit: 50,
  });
});
it("does not request analytical collections before initialization or without catalogue capability", async () => {
  const reads = services();
  reads.resources.mockResolvedValue([]);
  await expect(
    loadNetwork(reads, { mode: "overview" }, signal()),
  ).rejects.toThrow(/catalogue/);
  expect(reads.collect).not.toHaveBeenCalled();
  const uninitialized = {
    ...reads,
    status: vi.fn(async () => ({
      ...freshness,
      state: "uninitialized" as const,
    })),
  };
  await expect(
    loadNetwork(uninitialized, { mode: "overview" }, signal()),
  ).rejects.toThrow(/initialisée/);
});
it("rejects incomplete pagination and changed publications", async () => {
  const reads = services();
  reads.collect.mockResolvedValueOnce({
    items: [],
    complete: false,
    nextCursor: "next",
    reason: "page-limit",
    attempts: 5,
  });
  await expect(
    loadNetwork(reads, { mode: "overview" }, signal()),
  ).rejects.toThrow(/incomplète/);
  reads.status.mockResolvedValueOnce(freshness).mockResolvedValueOnce({
    ...freshness,
    lastCompletedAt: "2026-02-01T00:00:00Z",
  });
  await expect(
    loadNetwork(reads, { mode: "overview" }, signal()),
  ).rejects.toThrow(/changé/);
});
it.each([
  { revenue_covered_cell_count: 3 },
  { revenue: "1" },
  { expected_cell_count: -1 },
  { scope: "other" },
  { revenue_partial: 0.3 },
  { period: "2027-01-01" },
])("rejects malformed or out-of-scope responses %j", async (overrides) => {
  const reads = services();
  reads.collect.mockImplementation(async (name, _q, decode) => ({
    items: [decode(syntheticNetwork(name, overrides))],
    complete: true,
    nextCursor: null,
    reason: null,
    attempts: 3,
  }));
  await expect(
    loadNetwork(
      reads,
      { mode: "scope" in overrides ? "overview" : "month", period },
      signal(),
    ),
  ).rejects.toThrow();
});
