import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { Typologies } from "./Typologies";
import type { TypologyReads } from "./Typologies";
import { typologyNames } from "./typology-data";
import {
  syntheticId,
  syntheticResource,
  syntheticRow,
} from "../test/published-fixture";
import {
  syntheticTypologyRows,
  syntheticTypology,
  typologyIds,
} from "../test/typology-fixture";
import { ApiError } from "./read-api";
const freshness = {
    state: "current",
    lastCompletedAt: "2026-01-01T00:00:00Z",
    lastAttemptStatus: "succeeded",
  },
  period = { from: "2026-01", to: "2026-03", months: 3 };
function services() {
  return {
    resources: vi.fn<TypologyReads["resources"]>(async () =>
      [
        ...typologyNames,
        "store_typology_values",
        "typology_snapshots",
        "typology_rank_rules",
        "assortments",
        "products",
        "typology_mapping_rules",
      ].map((name) =>
        syntheticResource(name as Parameters<typeof syntheticResource>[0]),
      ),
    ),
    status: vi.fn<TypologyReads["status"]>(async () => freshness),
    collect: vi.fn<TypologyReads["collect"]>(async (name, _query, decode) => ({
      items: syntheticTypologyRows(name as (typeof typologyNames)[number]).map(
        decode,
      ),
      complete: true,
      reason: null,
      nextCursor: null,
      attempts: 1,
    })) as Mock<TypologyReads["collect"]> & TypologyReads["collect"],
    page: vi.fn<TypologyReads["page"]>(async (name, query, decode) => ({
      items: [
        decode(
          syntheticRow(name, {
            id: query.id,
            store_id: syntheticId,
            period: "2026-01-01",
            store_match_status: "matched",
          }),
        ),
      ],
      nextCursor: null,
      limit: 2,
    })) as Mock<TypologyReads["page"]> & TypologyReads["page"],
  };
}
const view = (reads = services()) =>
  render(<Typologies storeId={syntheticId} period={period} reads={reads} />);
const table = () =>
  screen.findByRole("region", { name: "Typologies mensuelles" });
it("keeps three independent complete blocks, contradictions, no candidates, calendar absence and inert values", async () => {
  const reads = services();
  view(reads);
  const region = await table();
  expect(region).toHaveTextContent("Valeurs contradictoires");
  expect(region).toHaveTextContent("Plusieurs règles candidates");
  expect(region).toHaveTextContent("Synthetic <img src=x> value");
  expect(document.querySelector("img")).toBeNull();
  expect(
    await screen.findByRole("region", {
      name: "Assortiments mensuels par enseigne",
    }),
  ).toBeVisible();
  expect(reads.collect).toHaveBeenCalledTimes(3);
  expect(reads.page).not.toHaveBeenCalled();
  expect(screen.getAllByText(/février 2026, mars 2026/).length).toBeGreaterThan(
    0,
  );
  expect(reads.collect).toHaveBeenCalledWith(
    "analytics_typology_month",
    {
      store_id: syntheticId,
      period_from: "2026-01-01",
      period_to: "2026-03-01",
      limit: 100,
    },
    expect.any(Function),
    expect.objectContaining({ maxPages: 5, maxItems: 500 }),
  );
});
it("opens a snapshot explicitly and restores focus without replacing published rows", async () => {
  const reads = services();
  view(reads);
  const region = await table(),
    trigger = within(region).getAllByRole("button")[0]!;
  await userEvent.click(trigger);
  expect(
    screen.getByRole("heading", { name: "Détail — Typologies mensuelles" }),
  ).toHaveFocus();
  expect(reads.page).not.toHaveBeenCalled();
  const proof = screen.getByRole("button", {
    name: new RegExp(
      `Consulter Instantanés des typologies : ${typologyIds[1]}`,
    ),
  });
  await userEvent.click(proof);
  await screen.findByRole("heading", {
    name: "Référence vivante — Instantanés des typologies",
  });
  await vi.waitFor(() => expect(reads.page).toHaveBeenCalledTimes(1));
  await userEvent.click(
    screen.getByRole("button", { name: "Fermer la référence" }),
  );
  expect(proof).toHaveFocus();
  await userEvent.click(
    screen.getByRole("button", { name: "Fermer le détail typologies" }),
  );
  expect(trigger).toHaveFocus();
});
it("contains an incomplete collection and recovers only on explicit action", async () => {
  const reads = services(),
    original = reads.collect.getMockImplementation()!;
  let fail = true;
  reads.collect.mockImplementation(async (...args) =>
    args[0] === "analytics_typology_month" && fail
      ? ((fail = false),
        {
          items: [],
          complete: false,
          reason: "page-limit",
          nextCursor: "synthetic",
          attempts: 5,
        })
      : original(...args),
  );
  view(reads);
  expect(await screen.findByText(/Lecture incomplète/)).toBeVisible();
  expect(
    screen.queryByRole("region", { name: "Typologies mensuelles" }),
  ).toBeNull();
  expect(
    await screen.findByRole("region", {
      name: "Assortiments mensuels par enseigne",
    }),
  ).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Relire Typologies mensuelles" }),
  );
  expect(await table()).toBeVisible();
});
it("blocks uninitialized publication before collections", async () => {
  const reads = services();
  reads.status.mockResolvedValue({ ...freshness, state: "uninitialized" });
  view(reads);
  expect(
    await screen.findAllByText(/Aucune publication analytique initialisée/),
  ).toHaveLength(3);
  expect(reads.collect).not.toHaveBeenCalled();
});
it("blocks a catalogue without store filter before reading that resource", async () => {
  const reads = services();
  reads.resources.mockResolvedValue(
    typologyNames.map((name) => ({
      ...syntheticResource(name),
      filters:
        name === "analytics_typology_month"
          ? []
          : syntheticResource(name).filters,
    })),
  );
  view(reads);
  expect(await screen.findByText(/catalogue ne permet pas/)).toBeVisible();
  expect(
    reads.collect.mock.calls.every((c) => c[0] !== "analytics_typology_month"),
  ).toBe(true);
});
it("preserves publication after a missing proof or local refusal", async () => {
  const reads = services();
  reads.page
    .mockResolvedValueOnce({ items: [], nextCursor: null, limit: 2 })
    .mockRejectedValueOnce(new ApiError("forbidden", 403));
  view(reads);
  const region = await table();
  await userEvent.click(within(region).getAllByRole("button")[0]!);
  await userEvent.click(
    screen.getByRole("button", {
      name: new RegExp(`Instantanés des typologies : ${typologyIds[1]}`),
    }),
  );
  expect(
    await screen.findByText(/Référence absente ou supprimée/),
  ).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Relire la référence" }),
  );
  expect(await screen.findByText("Accès refusé à ce bloc.")).toBeVisible();
  expect(await table()).toBeVisible();
});
it("aborts a departed proof and ignores its late reply", async () => {
  const reads = services();
  let resolve!: (v: Awaited<ReturnType<TypologyReads["page"]>>) => void;
  reads.page.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  view(reads);
  await userEvent.click(within(await table()).getAllByRole("button")[0]!);
  await userEvent.click(
    screen.getByRole("button", {
      name: new RegExp(`Instantanés des typologies : ${typologyIds[1]}`),
    }),
  );
  await vi.waitFor(() => expect(reads.page).toHaveBeenCalledTimes(1));
  const call = reads.page.mock.calls[0]!;
  await userEvent.click(
    screen.getByRole("button", { name: "Fermer la référence" }),
  );
  expect(call[3]!.signal!.aborted).toBe(true);
  await act(async () => resolve({ items: [], nextCursor: null, limit: 2 }));
  expect(screen.queryByText(/Référence absente ou supprimée/)).toBeNull();
});
it("paginates 51 rows locally with no further API read", async () => {
  const reads = services(),
    original = reads.collect.getMockImplementation()!;
  reads.collect.mockImplementation(async (...args) =>
    args[0] === "analytics_typology_month"
      ? {
          items: Array.from({ length: 51 }, (_, i) =>
            args[2](
              syntheticTypology("analytics_typology_month", {
                typology_value_id: `00000000-0000-4000-8000-${(i + 10).toString().padStart(12, "0")}`,
              }),
            ),
          ),
          complete: true,
          reason: null,
          nextCursor: null,
          attempts: 1,
        }
      : original(...args),
  );
  view(reads);
  const region = await table();
  expect(within(region).getAllByRole("button")).toHaveLength(50);
  await userEvent.click(
    screen.getAllByRole("button", { name: "Lignes suivantes" })[0]!,
  );
  expect(within(region).getAllByRole("button")).toHaveLength(1);
  expect(reads.collect).toHaveBeenCalledTimes(3);
});
it.each(["multiple", "cursor"])(
  "rejects a nonunique source response (%s)",
  async (mode) => {
    const reads = services();
    reads.page.mockImplementationOnce(async (name, query, decode) => ({
      items: (mode === "multiple" ? [1, 2] : [1]).map(() =>
        decode(
          syntheticRow(name, {
            id: query.id,
            store_id: syntheticId,
            period: "2026-01-01",
            store_match_status: "matched",
          }),
        ),
      ),
      nextCursor: mode === "cursor" ? "synthetic" : null,
      limit: 2,
    }));
    view(reads);
    await userEvent.click(within(await table()).getAllByRole("button")[0]!);
    await userEvent.click(
      screen.getByRole("button", {
        name: new RegExp(`Instantanés des typologies : ${typologyIds[1]}`),
      }),
    );
    expect(
      await screen.findByText(/Ce bloc n’a pas pu être chargé/),
    ).toBeVisible();
    expect(await table()).toBeVisible();
  },
);
it("blocks an uninitialized live reference before requesting its data", async () => {
  const reads = services();
  view(reads);
  await userEvent.click(within(await table()).getAllByRole("button")[0]!);
  reads.status.mockResolvedValue({ ...freshness, state: "uninitialized" });
  await userEvent.click(
    screen.getByRole("button", {
      name: new RegExp(`Instantanés des typologies : ${typologyIds[1]}`),
    }),
  );
  expect(
    await screen.findByText(/Cette référence ne peut pas être vérifiée/),
  ).toBeVisible();
  expect(reads.page).not.toHaveBeenCalled();
});
it("rejects freshness changing during an analytical collection", async () => {
  const reads = services(),
    original = reads.collect.getMockImplementation()!;
  let changed = false;
  reads.status.mockImplementation(async () => ({
    ...freshness,
    lastCompletedAt: changed
      ? "2026-02-01T00:00:00Z"
      : freshness.lastCompletedAt,
  }));
  reads.collect.mockImplementation(async (...args) => {
    const result = await original(...args);
    changed = true;
    return result;
  });
  view(reads);
  expect(
    (await screen.findAllByText(/La publication a changé/)).length,
  ).toBeGreaterThan(0);
  expect(
    screen.queryByRole("region", { name: "Typologies mensuelles" }),
  ).toBeNull();
});
