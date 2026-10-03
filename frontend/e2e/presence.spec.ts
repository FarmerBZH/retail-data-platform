import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { installProvider } from "./provider";
import { syntheticStore } from "../test/store-fixture";
import { syntheticResource } from "../test/published-fixture";
import {
  categoryCode,
  syntheticCategories,
  syntheticDistributions,
  syntheticShelf,
} from "../test/presence-fixture";
const headers = { "access-control-allow-origin": "http://127.0.0.1:4180" };
async function setup(
  page: import("@playwright/test").Page,
  initialIncomplete = false,
) {
  await installProvider(page);
  let incomplete = initialIncomplete;
  const counts = [0, 0, 0];
  const names = [
    "analytics_store_category_month",
    "analytics_distribution_product_month",
    "analytics_shelf_category_month",
  ] as const;
  const respond = (route: import("@playwright/test").Route, body: unknown) =>
    route.fulfill({
      contentType: "application/json",
      headers,
      body: JSON.stringify(body),
    });
  await page
    .context()
    .route("https://api.example.test/v1/resources", (route) =>
      respond(route, names.map(syntheticResource)),
    );
  await page
    .context()
    .route("https://api.example.test/v1/analytics/status", (route) =>
      respond(route, {
        state: "stale",
        last_completed_at: "2026-01-01T00:00:00Z",
        last_attempt_status: "failed",
      }),
    );
  const store = syntheticStore();
  await page
    .context()
    .route("https://api.example.test/v1/data/stores?**", (route) =>
      respond(route, { items: [store], next_cursor: null }),
    );
  for (const [i, name] of names.entries()) {
    await page
      .context()
      .route(`https://api.example.test/v1/data/${name}?**`, (route) => {
        counts[i]!++;
        const url = new URL(route.request().url());
        expect(url.searchParams.get("store_id")).toBe(store.id);
        expect(url.searchParams.get("period_from")).toBe("2026-01-01");
        expect(url.searchParams.get("period_to")).toBe("2026-03-01");
        expect(url.searchParams.get("category_code")).toBe(
          i === 0 ? null : categoryCode,
        );
        expect(route.request().method()).toBe("GET");
        return respond(route, {
          items:
            i === 0
              ? syntheticCategories()
              : i === 1
                ? syntheticDistributions()
                : [syntheticShelf()],
          next_cursor: incomplete && i === 0 ? `synthetic-${counts[i]}` : null,
        });
      });
  }
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByRole("button", { name: store.name, exact: true }).click();
  await page
    .getByRole("tab", { name: "Présence et linéaire", exact: true })
    .click();
  await page.getByLabel("Mois de début").fill("2026-01");
  await page.getByLabel("Mois de fin").fill("2026-03");
  expect(counts).toEqual([0, 0, 0]);
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  return {
    counts,
    complete: () => {
      incomplete = false;
    },
  };
}
test("presence and shelf keep separate ratios, unknown units and evidence requested by category", async ({
  page,
}) => {
  test.setTimeout(60000);
  const fixture = await setup(page);
  const table = page
    .getByRole("region", { name: "Ratios et dénominateurs par catégorie" })
    .getByRole("table");
  await expect(table).toContainText("150 %", { timeout: 15000 });
  await expect(table).toContainText("3 / 2");
  await expect(table).toContainText("0 / 0");
  await expect(table).toContainText("cellule absente");
  expect(fixture.counts).toEqual([1, 0, 0]);
  await expect(
    page.locator('svg[aria-label="Présence observée mensuelle par catégorie"]'),
  ).toBeVisible();
  await expect(
    page.locator('svg[aria-label="Part de linéaire mensuelle par catégorie"]'),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Catégorie publiée" }).click();
  await page.getByRole("option", { name: "B", exact: true }).click();
  await expect(table).toContainText("25 %");
  expect(fixture.counts).toEqual([1, 0, 0]);
  await page.getByRole("combobox", { name: "Catégorie publiée" }).click();
  await page.getByRole("option", { name: categoryCode, exact: true }).click();
  const button = page.getByRole("button", {
    name: "Consulter les produits de présence",
    exact: true,
  });
  await button.focus();
  await page.keyboard.press("Enter");
  const products = page.getByRole("region", {
    name: "Produits de présence publiés",
  });
  await expect(products).toContainText("source:unknown<img src=x>", {
    timeout: 15000,
  });
  expect(fixture.counts).toEqual([1, 1, 0]);
  expect(await page.locator("img").count()).toBe(0);
  const detail = products.getByRole("button").first();
  await detail.click();
  await expect(
    page.getByRole("heading", {
      name: "Détail de la collection catégorie",
      exact: true,
    }),
  ).toBeFocused();
  await page.getByText("Liste (1 éléments)", { exact: true }).click();
  await expect(
    page.getByText("00000000-0000-4000-8000-000000000002", { exact: true }),
  ).toBeVisible();
  expect(fixture.counts).toEqual([1, 1, 0]);
  await page
    .getByRole("button", { name: "Fermer la ligne catégorie", exact: true })
    .click();
  await expect(detail).toBeFocused();
  await page
    .getByRole("button", {
      name: "Fermer la collection catégorie",
      exact: true,
    })
    .click();
  await expect(button).toBeFocused();
  await page
    .getByRole("button", {
      name: "Consulter les dénominateurs du linéaire",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("region", { name: "Dénominateurs de linéaire publiés" }),
  ).toContainText("150 %", { timeout: 15000 });
  expect(fixture.counts).toEqual([1, 1, 1]);
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
test("incomplete category reads expose no ratios and recover only on explicit retry", async ({
  page,
}) => {
  const fixture = await setup(page, true);
  await expect(page.getByText(/Lecture incomplète : aucun ratio/)).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByRole("table")).toHaveCount(0);
  expect(fixture.counts).toEqual([5, 0, 0]);
  fixture.complete();
  await page
    .getByRole("button", { name: "Relire la synthèse catégorie", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Ratios et dénominateurs par catégorie" }),
  ).toBeVisible({ timeout: 15000 });
  expect(fixture.counts).toEqual([6, 0, 0]);
  await page
    .getByRole("tab", { name: "Données détaillées", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Ratios et dénominateurs par catégorie" }),
  ).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
