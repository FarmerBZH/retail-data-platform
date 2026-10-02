import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { installProvider } from "./provider";
import { syntheticStore } from "../test/store-fixture";
import { syntheticMonth } from "../test/monthly-fixture";

async function setup(
  page: import("@playwright/test").Page,
  incomplete = false,
) {
  await installProvider(page);
  const store = syntheticStore();
  await page
    .context()
    .route("https://api.example.test/v1/data/stores?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        headers: { "access-control-allow-origin": "http://127.0.0.1:4180" },
        body: JSON.stringify({ items: [store], next_cursor: null }),
      }),
    );
  await page
    .context()
    .route("https://api.example.test/v1/analytics/status", (route) =>
      route.fulfill({
        contentType: "application/json",
        headers: { "access-control-allow-origin": "http://127.0.0.1:4180" },
        body: JSON.stringify({
          state: "current",
          last_completed_at: "2026-01-01T00:00:00Z",
          last_attempt_status: "succeeded",
        }),
      }),
    );
  let requests = 0;
  await page
    .context()
    .route(
      "https://api.example.test/v1/data/analytics_store_month?**",
      (route) => {
        requests++;
        const url = new URL(route.request().url());
        expect(route.request().method()).toBe("GET");
        expect(url.searchParams.get("store_id")).toBe(store.id);
        expect(url.searchParams.get("period_from")).toBe("2026-01-01");
        expect(["2026-04-01", "2026-05-01"]).toContain(
          url.searchParams.get("period_to"),
        );
        const rows = [
          syntheticMonth(),
          syntheticMonth({ period: "2026-03-01", revenue: "-0.1", units: "0" }),
          syntheticMonth({
            period: "2026-04-01",
            revenue: null,
            units: null,
            register_ambiguous_products: 1,
            register_revenue_product_count: 1,
            register_units_product_count: 1,
            unambiguous_reported_revenue: "100.12",
          }),
        ];
        return route.fulfill({
          contentType: "application/json",
          headers: { "access-control-allow-origin": "http://127.0.0.1:4180" },
          body: JSON.stringify({
            items:
              url.searchParams.get("period_to") === "2026-05-01"
                ? [
                    syntheticMonth({
                      period: "2026-05-01",
                      revenue: "42",
                      unambiguous_reported_revenue: "42",
                    }),
                  ]
                : rows,
            next_cursor: incomplete ? `synthetic-${requests}` : null,
          }),
        });
      },
    );
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByRole("button", { name: store.name, exact: true }).click();
  await page.getByLabel("Mois de début").fill("2026-01");
  await page.getByLabel("Mois de fin").fill("2026-04");
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  return () => requests;
}

test("monthly chart and exact table distinguish holes, zero and ambiguous sales; drafts cause no reads", async ({
  page,
}) => {
  const count = await setup(page);
  const table = page.getByRole("table");
  await expect(table).toContainText(
    "février 2026 — mois absent de la publication",
    { timeout: 15000 },
  );
  await expect(
    table.getByRole("row").filter({ hasText: "janvier 2026" }),
  ).toContainText("0,1");
  await expect(
    table.getByRole("row").filter({ hasText: "mars 2026" }),
  ).toContainText("-0,1");
  await expect(
    table.getByRole("row").filter({ hasText: "avril 2026" }),
  ).toContainText("100,12");
  await expect(
    page.getByText("CA observé — partiel", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByText("Couverture : 2/4 mois avec valeur.", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    page.locator(
      "svg[aria-label='CA observé mensuel, valeurs exactes dans le tableau']",
    ),
  ).toBeVisible();
  const keyboardChart = page
    .locator("[class*='MuiCharts'] [tabindex='0']")
    .first();
  await keyboardChart.focus();
  await expect(keyboardChart).toBeFocused();
  await page.keyboard.press("ArrowRight");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("Mois de fin").fill("2026-05");
  expect(count()).toBe(1);
  await expect(
    page.getByText(/Période appliquée : janvier 2026 à avril 2026/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Chargement de la synthèse mensuelle" }),
  ).toBeVisible();
  await expect(
    table.getByRole("row").filter({ hasText: "mai 2026" }),
  ).toContainText("42", { timeout: 15000 });
  await expect(
    table.getByRole("row").filter({ hasText: "janvier 2026" }),
  ).toContainText("mois absent de la publication");
  expect(count()).toBe(2);
  await page.getByRole("tab", { name: "Données détaillées" }).click();
  await expect(page.getByRole("table")).toHaveCount(0);
  expect(count()).toBe(2);
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
});

test("a bounded incomplete read displays no monthly total or false missing month", async ({
  page,
}) => {
  const count = await setup(page, true);
  // The shared one-request/second scheduler also paces status checks and all five pages.
  await expect(page.getByText(/Lecture incomplète/)).toBeVisible({
    timeout: 15000,
  });
  expect(count()).toBe(5);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByText("CA observé — partiel")).toHaveCount(0);
  await expect(page.getByText(/mois absent de la publication/)).toHaveCount(0);
});
