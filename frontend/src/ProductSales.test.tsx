import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ProductSales } from "./ProductSales";
import { productSale } from "./product-sales";
import {
  syntheticProductRows,
  syntheticProductSale,
  observationId,
} from "../test/product-sales-fixture";
import {
  syntheticId,
  syntheticResource,
  syntheticRow,
} from "../test/published-fixture";
import { ApiError } from "./read-api";
import type { ProductReads } from "./ProductSales";
vi.mock("@mui/x-charts/BarChart", () => ({
  BarChart: vi.fn(() => (
    <div role="img" aria-label="Barres testées dans Chromium" />
  )),
}));
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
const result: import("./read-queries").Collection<
  import("./product-sales").ProductSale
> = {
  items: syntheticProductRows().map(productSale),
  complete: true,
  reason: null,
  nextCursor: null,
  attempts: 3,
};
function services() {
  return {
    resources: vi.fn(async () => [
      syntheticResource("analytics_register_product_month"),
      syntheticResource("products"),
      syntheticResource("register_observations"),
    ]),
    status: vi.fn(async () => freshness),
    collect: vi.fn<ProductReads["collect"]>(async () => result),
    page: vi.fn<ProductReads["page"]>(async () => ({
      items: [],
      nextCursor: null,
      limit: 2,
    })),
  };
}
function view(reads = services()) {
  return render(
    <ProductSales storeId={syntheticId} period={period} reads={reads} />,
  );
}
it("loads only the bounded active product collection, keeps unresolved rows and explicit local plots", async () => {
  const reads = services();
  view(reads);
  const table = await screen.findByRole("table");
  expect(within(table).getAllByText("Lien produit indisponible")).toHaveLength(
    3,
  );
  expect(table).toHaveTextContent("-0,2");
  expect(reads.collect).toHaveBeenCalledWith(
    "analytics_register_product_month",
    {
      store_id: syntheticId,
      period_from: "2026-01-01",
      period_to: "2026-03-01",
      limit: 100,
    },
    productSale,
    expect.objectContaining({ maxItems: 500, maxPages: 5 }),
  );
  expect(reads.page).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getAllByRole("button", { name: "Courbe GTIN 00000000000001" })[0]!,
  );
  expect(screen.getByText(/Couverture : 1\/3 mois/)).toBeVisible();
  expect(
    screen.getByRole("table", {
      name: "Calendrier complet du GTIN source sélectionné",
    }),
  ).toHaveTextContent("Cellule absente");
  expect(reads.collect).toHaveBeenCalledTimes(1);
});
it("opens evidence only on demand, handles a disappeared live product and restores cell focus", async () => {
  const reads = services();
  view(reads);
  await screen.findByRole("table");
  const button = screen.getByRole("button", {
    name: "Détail GTIN 00000000000003, 2026-01",
  });
  await userEvent.click(button);
  expect(reads.page).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Consulter le produit actuel" }),
  );
  expect(
    await screen.findByText(/Cette ligne n’est plus disponible/),
  ).toBeVisible();
  expect(reads.page).toHaveBeenCalledWith(
    "products",
    { id: syntheticId, limit: 2 },
    expect.any(Function),
    expect.objectContaining({ refresh: true }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Fermer le détail produit" }),
  );
  expect(button).toHaveFocus();
});
it("rejects a live observation whose identity or grain no longer matches", async () => {
  const reads = services();
  reads.page.mockImplementation(async (_name, _query, decode) => ({
    items: [
      decode(
        syntheticRow("register_observations", {
          id: observationId,
          store_id: syntheticId,
          period: "2026-01-01",
          source_gtin: "00000000000009",
        }),
      ),
    ],
    nextCursor: null,
    limit: 2,
  }));
  view(reads);
  await screen.findByRole("table");
  await userEvent.click(
    screen.getByRole("button", { name: "Détail GTIN 00000000000001, 2026-01" }),
  );
  await userEvent.click(
    screen.getByRole("button", {
      name: `Consulter l’observation ${observationId}`,
    }),
  );
  expect(
    await screen.findByText(/Cette preuve n’a pas pu être vérifiée/),
  ).toBeVisible();
});
it.each(["page-limit", "freshness-changed"] as const)(
  "hides product values for incomplete %s reads and retries manually",
  async (reason) => {
    const reads = services();
    reads.collect.mockResolvedValueOnce({
      ...result,
      complete: false,
      reason,
    });
    view(reads);
    expect(
      await screen.findByText(
        reason === "page-limit" ? /Lecture incomplète/ : /publication a changé/,
      ),
    ).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Relire les ventes produit" }),
    );
    expect(await screen.findByRole("table")).toBeVisible();
  },
);
it("blocks uninitialized analytics without collection reads", async () => {
  const reads = services();
  reads.status.mockResolvedValue({ ...freshness, state: "uninitialized" });
  view(reads);
  expect(
    await screen.findByText(/Aucune publication analytique initialisée/),
  ).toBeVisible();
  expect(reads.collect).not.toHaveBeenCalled();
});
it("refuses unsupported catalogue filters and rejects changed freshness", async () => {
  const reads = services();
  reads.status.mockResolvedValueOnce(freshness).mockResolvedValueOnce({
    ...freshness,
    lastCompletedAt: "2026-02-01T00:00:00Z",
  });
  view(reads);
  expect(await screen.findByText(/publication a changé/)).toBeVisible();
  expect(screen.queryByRole("table")).toBeNull();
});
it("shows refusal locally with no automatic retry", async () => {
  const reads = services();
  reads.collect.mockRejectedValue(new ApiError("forbidden", 403));
  view(reads);
  expect(
    await screen.findByText("Accès refusé aux ventes produit."),
  ).toBeVisible();
  expect(reads.collect).toHaveBeenCalledTimes(1);
});
it("aborts on departure and ignores a late result", async () => {
  const reads = services();
  let resolve!: (value: typeof result) => void;
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

it("paginates product tables and explicit bar subsets locally without extra reads", async () => {
  const reads = services();
  reads.collect.mockResolvedValue({
    ...result,
    items: Array.from({ length: 26 }, (_, i) =>
      productSale(
        syntheticProductSale({ source_gtin: String(i + 1).padStart(14, "0") }),
      ),
    ),
  });
  view(reads);
  const table = await screen.findByRole("table");
  expect(within(table).getAllByRole("row")).toHaveLength(26);
  await userEvent.click(
    screen.getByRole("button", { name: "Tableau produit : page suivante" }),
  );
  expect(within(table).getAllByRole("row")).toHaveLength(2);
  expect(table).toHaveTextContent("00000000000026");
  await userEvent.click(
    screen.getByRole("button", { name: "Barres : page suivante" }),
  );
  expect(screen.getByText(/cellules 21 à 26 sur 26/)).toBeVisible();
  expect(reads.collect).toHaveBeenCalledTimes(1);
  expect(reads.page).not.toHaveBeenCalled();
});
it("does not invent zero when a complete collection is empty", async () => {
  const reads = services();
  reads.collect.mockResolvedValue({ ...result, items: [] });
  view(reads);
  expect(await screen.findByText(/ne signifie pas zéro vente/)).toBeVisible();
  expect(screen.queryByRole("table")).toBeNull();
});
it("requires catalogue support for the store and month filters", async () => {
  const reads = services();
  reads.resources.mockResolvedValue([
    {
      ...syntheticResource("analytics_register_product_month"),
      filters: ["product_id"],
    },
  ]);
  view(reads);
  expect(await screen.findByText(/catalogue ne permet pas/)).toBeVisible();
  expect(reads.collect).not.toHaveBeenCalled();
});
it("limits a proof refusal to that detail and retries explicitly", async () => {
  const reads = services();
  reads.page.mockRejectedValueOnce(new ApiError("forbidden", 403));
  view(reads);
  await screen.findByRole("table");
  await userEvent.click(
    screen.getByRole("button", { name: "Détail GTIN 00000000000003, 2026-01" }),
  );
  const trigger = screen.getByRole("button", {
    name: "Consulter le produit actuel",
  });
  await userEvent.click(trigger);
  expect(await screen.findByText("Accès refusé à cette preuve.")).toBeVisible();
  expect(screen.getByRole("table")).toBeVisible();
  expect(reads.page).toHaveBeenCalledTimes(1);
  await userEvent.click(
    screen.getByRole("button", { name: "Réessayer la preuve" }),
  );
  expect(
    await screen.findByText(/Cette ligne n’est plus disponible/),
  ).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Fermer la preuve" }),
  );
  expect(trigger).toHaveFocus();
});
it("restores focus to the table when an opened cell leaves the current local page", async () => {
  const reads = services();
  reads.collect.mockResolvedValue({
    ...result,
    items: Array.from({ length: 26 }, (_, i) =>
      productSale(
        syntheticProductSale({ source_gtin: String(i + 1).padStart(14, "0") }),
      ),
    ),
  });
  view(reads);
  await screen.findByRole("table");
  await userEvent.click(
    screen.getByRole("button", { name: "Détail GTIN 00000000000001, 2026-01" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Tableau produit : page suivante" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Fermer le détail produit" }),
  );
  expect(
    screen.getByRole("region", {
      name: "Ventes par GTIN et mois, valeurs exactes",
    }),
  ).toHaveFocus();
});
it("labels null product links conservatively and marks partially covered bar series", async () => {
  const reads = services();
  const row = productSale(
    syntheticProductSale({
      revenue: null,
      revenue_reported_rows: 0,
      product_id: null,
      unmatched_product_rows: 0,
    }),
  );
  reads.collect.mockResolvedValue({
    ...result,
    items: [
      row,
      productSale(syntheticProductSale({ source_gtin: "00000000000002" })),
    ],
  });
  view(reads);
  const table = await screen.findByRole("table");
  expect(table).toHaveTextContent("Lien produit à la publication");
  expect(table).toHaveTextContent("Lien produit indisponible");
  expect(
    within(table).queryByText("Non rapproché", { exact: true }),
  ).toBeNull();
  const { BarChart } = await import("@mui/x-charts/BarChart");
  expect(vi.mocked(BarChart).mock.lastCall?.[0].series?.[0]?.label).toContain(
    "partiel",
  );
});
