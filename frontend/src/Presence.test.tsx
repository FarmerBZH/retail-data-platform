import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Presence } from "./Presence";
import type { PresenceReads } from "./Presence";
import { presenceNames, presenceDecoders } from "./presence-data";
import {
  syntheticCategories,
  syntheticDistributions,
  syntheticShelf,
  categoryCode,
} from "../test/presence-fixture";
import { syntheticId, syntheticResource } from "../test/published-fixture";
import { ApiError } from "./read-api";
vi.mock("@mui/x-charts/LineChart", () => ({
  LineChart: vi.fn(() => (
    <div role="img" aria-label="Courbe testée dans Chromium" />
  )),
}));
const period = { from: "2026-01", to: "2026-03", months: 3 };
const freshness = {
  state: "current",
  lastCompletedAt: "2026-01-01T00:00:00Z",
  lastAttemptStatus: "succeeded",
};
const result = {
  items: syntheticCategories().map(
    presenceDecoders.analytics_store_category_month,
  ),
  complete: true,
  reason: null,
  nextCursor: null,
  attempts: 1,
} as const;
function services() {
  return {
    resources: vi.fn(async () => presenceNames.map(syntheticResource)),
    status: vi.fn(async () => freshness),
    collect: vi.fn<PresenceReads["collect"]>(async (name, _query, decode) => ({
      ...result,
      items: (name === presenceNames[0]
        ? syntheticCategories()
        : name === presenceNames[1]
          ? syntheticDistributions()
          : [syntheticShelf()]
      ).map(decode),
    })),
  };
}
function view(reads = services()) {
  return render(
    <Presence storeId={syntheticId} period={period} reads={reads} />,
  );
}
it("loads only bounded category summaries and renders separate plots with exact denominators", async () => {
  const reads = services();
  view(reads);
  const table = await screen.findByRole("table");
  expect(table).toHaveTextContent("150 %");
  expect(table).toHaveTextContent("3 / 2");
  expect(table).toHaveTextContent("cellule absente");
  expect(table).toHaveTextContent("0 / 0");
  expect(screen.getAllByRole("img")).toHaveLength(2);
  expect(reads.collect).toHaveBeenCalledWith(
    presenceNames[0],
    {
      store_id: syntheticId,
      period_from: "2026-01-01",
      period_to: "2026-03-01",
      limit: 100,
    },
    presenceDecoders.analytics_store_category_month,
    expect.objectContaining({ maxPages: 5, maxItems: 500, refresh: true }),
  );
  expect(reads.collect).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("combobox"));
  await userEvent.click(screen.getByRole("option", { name: "B" }));
  expect(screen.getByRole("table")).toHaveTextContent("25 %");
  expect(screen.getByRole("table")).toHaveTextContent("1 / 10");
  expect(reads.collect).toHaveBeenCalledTimes(1);
});
it("loads evidence only on demand with a category filter, keeps source keys inert and restores focus", async () => {
  const reads = services();
  view(reads);
  await screen.findByRole("table");
  const button = screen.getByRole("button", {
    name: "Consulter les produits de présence",
  });
  await userEvent.click(button);
  const table = await screen.findByRole("region", {
    name: "Produits de présence publiés",
  });
  expect(table).toHaveTextContent("source:unknown<img src=x>");
  expect(table.querySelector("img")).toBeNull();
  expect(reads.collect).toHaveBeenLastCalledWith(
    presenceNames[1],
    expect.objectContaining({ category_code: categoryCode }),
    presenceDecoders.analytics_distribution_product_month,
    expect.objectContaining({ maxPages: 5, maxItems: 500 }),
  );
  await userEvent.click(within(table).getAllByRole("button")[0]!);
  expect(
    screen.getByRole("heading", { name: "Détail de la collection catégorie" }),
  ).toHaveFocus();
  await userEvent.click(screen.getByText("Liste (1 éléments)"));
  expect(
    screen.getByText("00000000-0000-4000-8000-000000000002"),
  ).toBeVisible();
  expect(reads.collect).toHaveBeenCalledTimes(2);
  await userEvent.click(
    screen.getByRole("button", { name: "Fermer la ligne catégorie" }),
  );
  expect(within(table).getAllByRole("button")[0]).toHaveFocus();
  await userEvent.click(
    screen.getByRole("button", { name: "Fermer la collection catégorie" }),
  );
  expect(button).toHaveFocus();
  await userEvent.click(
    screen.getByRole("button", {
      name: "Consulter les dénominateurs du linéaire",
    }),
  );
  expect(
    await screen.findByRole("region", {
      name: "Dénominateurs de linéaire publiés",
    }),
  ).toHaveTextContent("150 %");
});
it.each(["page-limit", "freshness-changed"] as const)(
  "hides incomplete %s summaries and retries manually",
  async (reason) => {
    const reads = services();
    reads.collect.mockResolvedValueOnce({ ...result, complete: false, reason });
    view(reads);
    expect(
      await screen.findByText(
        reason === "page-limit" ? /Lecture incomplète/ : /publication a changé/,
      ),
    ).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Relire la synthèse catégorie" }),
    );
    expect(await screen.findByRole("table")).toBeVisible();
  },
);
it("contains detail refusal locally and retries without hiding the summary", async () => {
  const reads = services();
  view(reads);
  await screen.findByRole("table");
  reads.collect.mockRejectedValueOnce(new ApiError("forbidden", 403));
  await userEvent.click(
    screen.getByRole("button", { name: "Consulter les produits de présence" }),
  );
  expect(await screen.findByText("Accès refusé à ce bloc.")).toBeVisible();
  expect(screen.getByRole("table")).toBeVisible();
  expect(reads.collect).toHaveBeenCalledTimes(2);
  await userEvent.click(
    screen.getByRole("button", { name: "Relire la collection catégorie" }),
  );
  expect(
    await screen.findByRole("region", { name: "Produits de présence publiés" }),
  ).toBeVisible();
});
it("rejects changed freshness and uninitialized publications", async () => {
  const reads = services();
  reads.status.mockResolvedValueOnce(freshness).mockResolvedValueOnce({
    ...freshness,
    lastCompletedAt: "2026-02-01T00:00:00Z",
  });
  const rendered = view(reads);
  expect(await screen.findByText(/publication a changé/)).toBeVisible();
  rendered.unmount();
  const next = services();
  next.status.mockResolvedValue({ ...freshness, state: "uninitialized" });
  view(next);
  expect(
    await screen.findByText(/Aucune publication analytique/),
  ).toBeVisible();
  expect(next.collect).not.toHaveBeenCalled();
});
it("rejects unsupported catalogue filters before reading values", async () => {
  const reads = services();
  reads.resources.mockResolvedValue([
    { ...syntheticResource(presenceNames[0]), filters: ["category_code"] },
  ]);
  view(reads);
  expect(await screen.findByText(/catalogue ne permet pas/)).toBeVisible();
  expect(reads.collect).not.toHaveBeenCalled();
});
it("aborts on departure and ignores late results", async () => {
  const reads = services();
  let resolve!: (v: typeof result) => void;
  reads.collect.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const rendered = view(reads);
  await vi.waitFor(() => expect(reads.collect).toHaveBeenCalledTimes(1));
  const signal = reads.collect.mock.calls[0]![3]!.signal!;
  rendered.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(result));
  expect(screen.queryByRole("table")).toBeNull();
});
it("does not infer an absence from an empty complete collection", async () => {
  const reads = services();
  reads.collect.mockResolvedValue({ ...result, items: [] });
  view(reads);
  expect(await screen.findByText(/cela ne signifie pas/)).toBeVisible();
  expect(screen.queryByRole("table")).toBeNull();
});

it("paginates category evidence locally and restores focus when the opened row leaves the page", async () => {
  const reads = services();
  view(reads);
  await screen.findByRole("table");
  reads.collect.mockResolvedValueOnce({
    ...result,
    items: Array.from({ length: 26 }, (_, i) =>
      presenceDecoders.analytics_distribution_product_month({
        ...syntheticDistributions()[1],
        product_key: `source:${String(i).padStart(2, "0")}`,
      }),
    ),
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Consulter les produits de présence" }),
  );
  const region = await screen.findByRole("region", {
    name: "Produits de présence publiés",
  });
  expect(within(region).getAllByRole("row")).toHaveLength(26);
  await userEvent.click(within(region).getAllByRole("button")[0]!);
  await userEvent.click(
    screen.getByRole("button", { name: "Lignes suivantes" }),
  );
  expect(within(region).getAllByRole("row")).toHaveLength(2);
  await userEvent.click(
    screen.getByRole("button", { name: "Fermer la ligne catégorie" }),
  );
  expect(region).toHaveFocus();
  expect(reads.collect).toHaveBeenCalledTimes(2);
});
it("keeps the detail category scope explicit even when its source code is empty", async () => {
  const reads = services();
  reads.collect
    .mockResolvedValueOnce({
      ...result,
      items: [{ ...result.items[0]!, category_code: "" }],
    })
    .mockResolvedValueOnce({ ...result, items: [] });
  view(reads);
  await screen.findByRole("table");
  await userEvent.click(
    screen.getByRole("button", { name: "Consulter les produits de présence" }),
  );
  expect(await screen.findByText(/aucun zéro inféré/)).toBeVisible();
  expect(reads.collect).toHaveBeenLastCalledWith(
    presenceNames[1],
    expect.objectContaining({ category_code: "" }),
    presenceDecoders.analytics_distribution_product_month,
    expect.any(Object),
  );
});
