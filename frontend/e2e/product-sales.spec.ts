import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { installProvider } from "./provider";
import { syntheticStore } from "../test/store-fixture";
import {
  syntheticId,
  syntheticResource,
  syntheticRow,
} from "../test/published-fixture";
import {
  syntheticProductRows,
  observationId,
} from "../test/product-sales-fixture";
const headers = { "access-control-allow-origin": "http://127.0.0.1:4180" };
async function setup(
  page: import("@playwright/test").Page,
  initialIncomplete = false,
) {
  await installProvider(page);
  const store = syntheticStore();
  let incomplete = initialIncomplete;
  let pages = 0,
    observations = 0,
    products = 0;
  const catalog = [
    syntheticResource("analytics_register_product_month"),
    syntheticResource("products"),
    syntheticResource("register_observations"),
  ];
  await page.context().route("https://api.example.test/v1/resources", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers,
      body: JSON.stringify(catalog),
    }),
  );
  await page
    .context()
    .route("https://api.example.test/v1/analytics/status", (route) =>
      route.fulfill({
        contentType: "application/json",
        headers,
        body: JSON.stringify({
          state: "stale",
          last_completed_at: "2026-01-01T00:00:00Z",
          last_attempt_status: "failed",
        }),
      }),
    );
  await page
    .context()
    .route("https://api.example.test/v1/data/stores?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        headers,
        body: JSON.stringify({ items: [store], next_cursor: null }),
      }),
    );
  await page
    .context()
    .route(
      "https://api.example.test/v1/data/analytics_register_product_month?**",
      (route) => {
        pages++;
        const url = new URL(route.request().url());
        expect(url.searchParams.get("store_id")).toBe(store.id);
        expect(url.searchParams.get("period_from")).toBe("2026-01-01");
        expect(url.searchParams.get("period_to")).toBe("2026-03-01");
        expect(url.searchParams.has("category_code")).toBe(false);
        expect(route.request().method()).toBe("GET");
        const rows = syntheticProductRows();
        return route.fulfill({
          contentType: "application/json",
          headers,
          body: JSON.stringify({
            items: incomplete
              ? [rows[0]]
              : url.searchParams.has("after")
                ? rows.slice(2)
                : rows.slice(0, 2),
            next_cursor: incomplete
              ? `synthetic-${pages}`
              : url.searchParams.has("after")
                ? null
                : "synthetic-next",
          }),
        });
      },
    );
  await page
    .context()
    .route(
      "https://api.example.test/v1/data/register_observations?**",
      (route) => {
        observations++;
        const url = new URL(route.request().url());
        expect(url.searchParams.get("id")).toBe(observationId);
        return route.fulfill({
          contentType: "application/json",
          headers,
          body: JSON.stringify({
            items: [
              syntheticRow("register_observations", {
                id: observationId,
                store_id: syntheticId,
                period: "2026-01-01",
                source_gtin: "00000000000001",
                source_product_label:
                  "Source synthétique <img src=x onerror=alert(1)>",
                unpublished: "hidden-db-field",
              }),
            ],
            next_cursor: null,
          }),
        });
      },
    );
  await page
    .context()
    .route("https://api.example.test/v1/data/products?**", (route) => {
      products++;
      expect(new URL(route.request().url()).searchParams.get("id")).toBe(
        syntheticId,
      );
      return route.fulfill({
        contentType: "application/json",
        headers,
        body: JSON.stringify({ items: [], next_cursor: null }),
      });
    });
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByRole("button", { name: store.name, exact: true }).click();
  await page
    .getByRole("tab", { name: "Ventes et produits", exact: true })
    .click();
  await page.getByLabel("Mois de début").fill("2026-01");
  await page.getByLabel("Mois de fin").fill("2026-03");
  expect(pages).toBe(0);
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  return {
    counts: () => ({ pages, observations, products }),
    complete: () => {
      incomplete = false;
    },
  };
}
test("product sales keep GTIN identities, plot exact returns and open live evidence only on demand", async ({
  page,
}) => {
  test.setTimeout(60000);
  const fixture = await setup(page);
  const table = page
    .getByRole("region", { name: "Ventes par GTIN et mois, valeurs exactes" })
    .getByRole("table");
  await expect(table).toContainText("-0,2", { timeout: 15000 });
  await expect(
    table.getByText("Lien produit indisponible", { exact: true }),
  ).toHaveCount(3);
  expect(fixture.counts()).toEqual({ pages: 2, observations: 0, products: 0 });
  await expect(
    page.locator('svg[aria-label="CA par GTIN source, barres mensuelles"]'),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Courbe GTIN 00000000000001", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("table", {
      name: "Calendrier complet du GTIN source sélectionné",
    }),
  ).toContainText("Cellule absente de la publication");
  await expect(
    page.getByText(/Couverture : 1\/3 mois avec valeur/),
  ).toBeVisible();
  await expect(
    page.locator('svg[aria-label="CA mensuel du GTIN sélectionné"]'),
  ).toBeVisible();
  const detail = page.getByRole("button", {
    name: "Détail GTIN 00000000000001, 2026-01",
    exact: true,
  });
  await detail.focus();
  await page.keyboard.press("Enter");
  expect(fixture.counts().observations).toBe(0);
  const proof = page.getByRole("button", {
    name: `Consulter l’observation ${observationId}`,
    exact: true,
  });
  await proof.click();
  await expect(
    page.getByText("Source synthétique <img src=x onerror=alert(1)>", {
      exact: true,
    }),
  ).toBeVisible();
  expect(await page.locator("img").count()).toBe(0);
  await expect(page.getByText("hidden-db-field")).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole("button", { name: "Fermer la preuve", exact: true })
    .click();
  await expect(proof).toBeFocused();
  await page
    .getByRole("button", { name: "Fermer le détail produit", exact: true })
    .click();
  await expect(detail).toBeFocused();
  await page
    .getByRole("button", {
      name: "Détail GTIN 00000000000003, 2026-01",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Consulter le produit actuel", exact: true })
    .click();
  await expect(
    page.getByText(
      "Cette ligne n’est plus disponible dans la source vivante.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(fixture.counts()).toEqual({ pages: 2, observations: 1, products: 1 });
  await page.getByLabel("Mois de début").fill("2026-02");
  expect(fixture.counts().pages).toBe(2);
  await expect(page.getByText(/Modifications non appliquées/)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  await page
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
  await expect(table).toHaveCount(0);
});
test("an incomplete product extraction hides values and allows explicit recovery", async ({
  page,
}) => {
  const fixture = await setup(page, true);
  await expect(
    page.getByText(/Lecture incomplète : aucun tableau/),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("table")).toHaveCount(0);
  expect(fixture.counts().pages).toBe(5);
  fixture.complete();
  await page
    .getByRole("button", { name: "Relire les ventes produit", exact: true })
    .click();
  await expect(
    page.getByRole("region", {
      name: "Ventes par GTIN et mois, valeurs exactes",
    }),
  ).toBeVisible({ timeout: 15000 });
  expect(fixture.counts()).toEqual({ pages: 7, observations: 0, products: 0 });
  await page
    .getByRole("tab", { name: "Données détaillées", exact: true })
    .click();
  await expect(
    page.getByRole("region", {
      name: "Ventes par GTIN et mois, valeurs exactes",
    }),
  ).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
