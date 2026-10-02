import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { SalesComparisons } from "./SalesComparisons";
import { ApiError } from "./read-api";
import type { ResourceName, Query } from "./read-api";
import type { Decoder } from "./api-validation";
import type { Collection, ReadQueries } from "./read-queries";
import { syntheticChange } from "../test/comparison-fixture";
import { syntheticMonth } from "../test/monthly-fixture";
import { monthlyChange } from "./sales-comparisons";
import { monthlySale } from "./monthly-sales";

const id = syntheticChange().store_id;
const period = { from: "2026-01", to: "2026-01", months: 1 };
const freshness = {
  state: "current" as const,
  lastCompletedAt: "2026-01-01T00:00:00Z",
  lastAttemptStatus: "succeeded" as const,
};
function services() {
  const collect = vi.fn<ReadQueries["collect"]>(
    async <T,>(
      name: ResourceName,
      _query: Query,
      decode: Decoder<T>,
    ): Promise<Collection<T>> => ({
      items: (name === "analytics_store_month_changes"
        ? [syntheticChange()]
        : [syntheticMonth({ period: "2025-12-01", revenue: "1" })]
      ).map(decode),
      complete: true,
      nextCursor: null,
      reason: null,
      attempts: 3,
    }),
  );
  // Vitest erases the generic call signature; the implementation applies the supplied decoder.
  return {
    status: vi.fn(async () => freshness),
    collect: collect as ReadQueries["collect"] & typeof collect,
  };
}
async function load() {
  await userEvent.click(
    screen.getByRole("button", { name: "Charger les comparaisons" }),
  );
}
it("reads only on demand and shows calendar references and exact window differences", async () => {
  const reads = services();
  render(<SalesComparisons storeId={id} period={period} reads={reads} />);
  expect(reads.status).not.toHaveBeenCalled();
  expect(reads.collect).not.toHaveBeenCalled();
  await load();
  expect(await screen.findByRole("table")).toHaveTextContent("décembre 2025");
  expect(screen.getByText(/Variation absolue de la fenêtre/)).toHaveTextContent(
    "+109",
  );
  expect(reads.collect.mock.calls.map((call) => [call[0], call[1]])).toEqual([
    [
      "analytics_store_month_changes",
      {
        store_id: id,
        period_from: "2026-01-01",
        period_to: "2026-01-01",
        limit: 50,
      },
    ],
    [
      "analytics_store_month",
      {
        store_id: id,
        period_from: "2025-12-01",
        period_to: "2025-12-01",
        limit: 50,
      },
    ],
  ]);
  expect(
    reads.collect.mock.calls.every(
      (call) => call[3]?.maxPages === 5 && call[3]?.maxItems === 120,
    ),
  ).toBe(true);
  await userEvent.selectOptions(
    screen.getByLabelText("Référence de la fenêtre"),
    "year",
  );
  expect(screen.queryByRole("table")).toBeNull();
  expect(reads.collect).toHaveBeenCalledTimes(2);
  expect(screen.getByText(/Fenêtre courante/)).toHaveTextContent(
    "janvier 2025",
  );
});
it("blocks analytical reads before initialization", async () => {
  const reads = {
    ...services(),
    status: vi.fn(async () => ({
      ...freshness,
      state: "uninitialized" as const,
    })),
  };
  render(<SalesComparisons storeId={id} period={period} reads={reads} />);
  await load();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Aucune publication analytique initialisée",
  );
  expect(reads.collect).not.toHaveBeenCalled();
});
it.each(["changes", "reference"])(
  "displays no comparison for an incomplete %s collection and permits retry",
  async (which) => {
    const reads = services();
    const partial = {
      items: [],
      complete: false,
      reason: "page-limit" as const,
      nextCursor: "synthetic-next",
      attempts: 3,
    };
    if (which === "changes") reads.collect.mockResolvedValueOnce(partial);
    else
      reads.collect
        .mockResolvedValueOnce({
          ...partial,
          complete: true,
          reason: null,
          nextCursor: null,
        })
        .mockResolvedValueOnce(partial);
    render(<SalesComparisons storeId={id} period={period} reads={reads} />);
    await load();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Lecture incomplète",
    );
    expect(screen.queryByRole("table")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Relire les comparaisons" }),
    );
    expect(await screen.findByRole("table")).toBeVisible();
  },
);
it("discards both collections if publication changes across them", async () => {
  const reads = services();
  reads.status.mockResolvedValueOnce(freshness).mockResolvedValueOnce({
    ...freshness,
    lastCompletedAt: "2026-01-02T00:00:00Z",
  });
  render(<SalesComparisons storeId={id} period={period} reads={reads} />);
  await load();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "publication a changé",
  );
  expect(screen.queryByRole("table")).toBeNull();
});
it("reports forbidden reads without automatically retrying", async () => {
  const reads = services();
  reads.collect.mockRejectedValueOnce(new ApiError("forbidden", 403));
  render(<SalesComparisons storeId={id} period={period} reads={reads} />);
  await load();
  expect(await screen.findByRole("alert")).toHaveTextContent("Accès refusé");
  expect(reads.collect).toHaveBeenCalledOnce();
});
it("aborts the pending collection when reference mode changes and ignores a late batch", async () => {
  const reads = services();
  let finish: (value: Collection<unknown>) => void = () => {};
  reads.collect.mockImplementationOnce(
    async () =>
      new Promise<Collection<never>>((resolve) => {
        finish = (value) => resolve(value as Collection<never>);
      }),
  );
  render(<SalesComparisons storeId={id} period={period} reads={reads} />);
  await load();
  await waitFor(() => expect(reads.collect).toHaveBeenCalledOnce());
  const signal = reads.collect.mock.calls[0]![3]!.signal;
  await userEvent.selectOptions(
    screen.getByLabelText("Référence de la fenêtre"),
    "year",
  );
  expect(signal?.aborted).toBe(true);
  await act(async () =>
    finish({
      items: [],
      complete: false,
      reason: "page-limit",
      nextCursor: null,
      attempts: 3,
    }),
  );
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps conflicting published amounts in a local retryable error", async () => {
  const reads = services();
  const complete = {
    complete: true,
    reason: null,
    nextCursor: null,
    attempts: 3,
  };
  reads.collect
    .mockResolvedValueOnce({
      ...complete,
      items: [monthlyChange(syntheticChange())],
    })
    .mockResolvedValueOnce({
      ...complete,
      items: [
        monthlySale(syntheticMonth({ period: "2025-12-01", revenue: "2" })),
      ],
    });
  render(<SalesComparisons storeId={id} period={period} reads={reads} />);
  await load();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "montants publiés sont incohérents",
  );
  expect(screen.queryByRole("table")).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Relire les comparaisons" }),
  );
  expect(await screen.findByRole("table")).toBeVisible();
});
