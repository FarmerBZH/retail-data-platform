import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { LineChart } from "@mui/x-charts/LineChart";
import { MonthlySales } from "./MonthlySales";
import { monthlySale } from "./monthly-sales";
import { syntheticMonth } from "../test/monthly-fixture";
import { ApiError } from "./read-api";
import type { Collection } from "./read-queries";
import type { MonthlySale } from "./monthly-sales";
vi.mock("@mui/x-charts/LineChart", () => ({
  LineChart: vi.fn(() => (
    <div role="img" aria-label="Courbe testée dans Chromium" />
  )),
}));
const freshness = {
  state: "current" as const,
  lastCompletedAt: "2026-01-01T00:00:00Z",
  lastAttemptStatus: "succeeded" as const,
};
const result: Collection<MonthlySale> = {
  items: [monthlySale(syntheticMonth())],
  complete: true,
  reason: null,
  nextCursor: null,
  attempts: 3,
};
const id = syntheticMonth().store_id;
const period = { from: "2026-01", to: "2026-02", months: 2 };
function services() {
  return {
    status: vi.fn(async () => freshness),
    collect: vi.fn(async () => result),
  };
}
it("reads the applied store and bounded months, displaying partial coverage", async () => {
  const reads = services();
  render(<MonthlySales storeId={id} period={period} reads={reads} />);
  expect(await screen.findByRole("table")).toHaveTextContent(
    "février 2026 — mois absent",
  );
  expect(screen.getByText("CA observé — partiel")).toBeVisible();
  expect(screen.getAllByText(/Couverture : 1\/2/).length).toBeGreaterThan(0);
  expect(reads.collect).toHaveBeenCalledWith(
    "analytics_store_month",
    {
      store_id: id,
      period_from: "2026-01-01",
      period_to: "2026-02-01",
      limit: 50,
    },
    monthlySale,
    expect.objectContaining({ maxItems: 120, maxPages: 5 }),
  );
});
it("does not read analytical rows before initialization", async () => {
  const reads = {
    ...services(),
    status: vi.fn(async () => ({
      ...freshness,
      state: "uninitialized" as const,
    })),
  };
  render(<MonthlySales storeId={id} period={period} reads={reads} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Aucune publication analytique initialisée",
  );
  expect(reads.collect).not.toHaveBeenCalled();
  expect(screen.queryByRole("table")).toBeNull();
});
it.each(["page-limit", "freshness-changed"] as const)(
  "displays no totals for %s and permits an explicit retry",
  async (reason) => {
    const reads = services();
    reads.collect.mockResolvedValueOnce({ ...result, complete: false, reason });
    render(<MonthlySales storeId={id} period={period} reads={reads} />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("CA observé — partiel")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Relire la période" }),
    );
    expect(await screen.findByRole("table")).toBeVisible();
  },
);
it("discards a completed batch if the surrounding status checks differ", async () => {
  const reads = services();
  reads.status.mockResolvedValueOnce(freshness).mockResolvedValueOnce({
    ...freshness,
    lastCompletedAt: "2026-01-02T00:00:00Z",
  });
  render(<MonthlySales storeId={id} period={period} reads={reads} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "publication a changé",
  );
  expect(screen.queryByRole("table")).toBeNull();
});
it("aborts pending reads on departure and ignores late rows", async () => {
  let finish: (v: Collection<MonthlySale>) => void = () => {};
  const reads = services();
  reads.collect.mockImplementation(
    async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { unmount } = render(
    <MonthlySales storeId={id} period={period} reads={reads} />,
  );
  await waitFor(() => expect(reads.collect).toHaveBeenCalledOnce());
  const signal = (
    reads.collect.mock.calls[0] as unknown as [
      unknown,
      unknown,
      unknown,
      { signal: AbortSignal },
    ]
  )[3].signal;
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => finish(result));
  expect(screen.queryByRole("table")).toBeNull();
});

it("keeps excessive combined arithmetic in a local retryable error", async () => {
  const reads = services();
  reads.collect.mockResolvedValueOnce({
    ...result,
    items: [
      monthlySale(syntheticMonth({ revenue: "1e512" })),
      monthlySale(syntheticMonth({ period: "2026-02-01", revenue: "1e-512" })),
    ],
  });
  render(<MonthlySales storeId={id} period={period} reads={reads} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "n’a pas pu être chargée",
  );
  expect(screen.queryByRole("table")).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Relire la période" }),
  );
  expect(await screen.findByRole("table")).toBeVisible();
});
it("uses exact source labels and coverage independently of chart geometry", async () => {
  render(<MonthlySales storeId={id} period={period} reads={services()} />);
  await screen.findByRole("table");
  const props = vi.mocked(LineChart).mock.calls.at(-1)![0];
  const series = props.series[0]!;
  expect(series.curve).toBe("linear");
  expect(series.label).toBe("CA observé — série partielle");
  expect(series.valueFormatter?.(999, { dataIndex: 0 })).toBe(
    "0,1 · unité monétaire à confirmer · couverture 1/1 mois",
  );
});

it("reports forbidden reads explicitly without showing totals or retrying automatically", async () => {
  const reads = services();
  reads.collect.mockRejectedValueOnce(new ApiError("forbidden", 403));
  render(<MonthlySales storeId={id} period={period} reads={reads} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Accès refusé");
  expect(screen.queryByRole("table")).toBeNull();
  expect(reads.collect).toHaveBeenCalledOnce();
});
