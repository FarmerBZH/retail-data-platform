import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { installProvider } from "./provider";
import { syntheticStore } from "../test/store-fixture";
import { syntheticMonth } from "../test/monthly-fixture";
import { syntheticChange } from "../test/comparison-fixture";
import type { Page } from "@playwright/test";

async function setup(page: Page, incomplete = false) {
  await installProvider(page);
  const store = syntheticStore();
  const headers = { "access-control-allow-origin": "http://127.0.0.1:4180" };
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
    .route("https://api.example.test/v1/analytics/status", (route) =>
      route.fulfill({
        contentType: "application/json",
        headers,
        body: JSON.stringify({
          state: "current",
          last_completed_at: "2026-01-01T00:00:00Z",
          last_attempt_status: "succeeded",
        }),
      }),
    );
  let changes = 0;
  let references = 0;
  await page
    .context()
    .route(
      "https://api.example.test/v1/data/analytics_store_month_changes?**",
      (route) => {
        changes++;
        const url = new URL(route.request().url());
        expect(route.request().method()).toBe("GET");
        expect(url.searchParams.get("store_id")).toBe(store.id);
        expect(url.searchParams.get("period_from")).toBe("2026-01-01");
        expect(url.searchParams.get("period_to")).toBe("2026-02-01");
        return route.fulfill({
          contentType: "application/json",
          headers,
          body: JSON.stringify({
            items: [
              syntheticChange(),
              syntheticChange({
                period: "2026-02-01",
                revenue: "1.1",
                revenue_previous_month: "110",
                revenue_previous_year: "-1",
              }),
            ],
            next_cursor: null,
          }),
        });
      },
    );
  await page
    .context()
    .route(
      "https://api.example.test/v1/data/analytics_store_month?**",
      (route) => {
        const url = new URL(route.request().url());
        expect(route.request().method()).toBe("GET");
        expect(url.searchParams.get("store_id")).toBe(store.id);
        const from = url.searchParams.get("period_from");
        const to = url.searchParams.get("period_to");
        let items;
        if (from === "2026-01-01") {
          expect(to).toBe("2026-02-01");
          items = [
            syntheticMonth({ revenue: "110" }),
            syntheticMonth({ period: "2026-02-01", revenue: "1.1" }),
          ];
        } else {
          references++;
          if (from === "2025-11-01") {
            expect(to).toBe("2025-12-01");
            items = [
              syntheticMonth({ period: "2025-11-01", revenue: "100" }),
              syntheticMonth({ period: "2025-12-01", revenue: "1" }),
            ];
          } else {
            expect(from).toBe("2025-01-01");
            expect(to).toBe("2025-02-01");
            items = [
              syntheticMonth({ period: "2025-01-01", revenue: "0" }),
              syntheticMonth({ period: "2025-02-01", revenue: "-1" }),
            ];
          }
        }
        return route.fulfill({
          contentType: "application/json",
          headers,
          body: JSON.stringify({
            items,
            next_cursor:
              incomplete && from !== "2026-01-01"
                ? `synthetic-${references}`
                : null,
          }),
        });
      },
    );
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByRole("button", { name: store.name, exact: true }).click();
  await page.getByLabel("Mois de début").fill("2026-01");
  await page.getByLabel("Mois de fin").fill("2026-02");
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible({ timeout: 15000 });
  expect(changes).toBe(0);
  expect(references).toBe(0);
  return () => ({ changes, references });
}

test("store comparisons use complete window totals and qualify zero/negative calendar bases", async ({
  page,
}) => {
  test.setTimeout(60000);
  const count = await setup(page);
  await page.getByRole("button", { name: "Charger les comparaisons" }).click();
  const region = page.getByRole("region", {
    name: "Comparaisons mensuelles exactes, défilement horizontal",
  });
  await expect(region).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/Variation absolue de la fenêtre/)).toContainText(
    "+10,1",
  );
  await expect(
    page.getByText(/Variation relative de la fenêtre/),
  ).toContainText(/Variation relative de la fenêtre : 10\s*%/);
  const january = region.getByRole("row").filter({
    has: page.getByRole("rowheader", { name: "janvier 2026", exact: true }),
  });
  await expect(january).toContainText("décembre 2025");
  await expect(january).toContainText("janvier 2025");
  await expect(january).toContainText("Indisponible — base nulle");
  await expect(
    region.getByRole("row").filter({ hasText: "février 2026" }),
  ).toContainText("Non interprétée — base négative");
  await region.focus();
  await expect(region).toBeFocused();
  await page.keyboard.press("ArrowRight");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("Référence de la fenêtre").selectOption("year");
  await expect(region).toHaveCount(0);
  expect(count()).toEqual({ changes: 1, references: 1 });
  await expect(page.getByText(/Fenêtre courante/)).toContainText(
    "janvier 2025 à février 2025",
  );
  await page.getByRole("button", { name: "Charger les comparaisons" }).click();
  await expect(region).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/Variation absolue de la fenêtre/)).toContainText(
    "+112,1",
  );
  await expect(
    page.getByText(/Variation relative de la fenêtre/),
  ).toContainText("Non interprétée — base négative");
  expect(count()).toEqual({ changes: 2, references: 2 });
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
  await expect(region).toHaveCount(0);
});

test("an incomplete reference collection hides every comparison and keeps the independent synthesis", async ({
  page,
}) => {
  test.setTimeout(60000);
  const count = await setup(page, true);
  await page.getByRole("button", { name: "Charger les comparaisons" }).click();
  await expect(
    page.getByText(/Lecture incomplète : aucune comparaison/),
  ).toBeVisible({ timeout: 25000 });
  expect(count()).toEqual({ changes: 1, references: 5 });
  await expect(
    page.getByRole("region", {
      name: "Comparaisons mensuelles exactes, défilement horizontal",
    }),
  ).toHaveCount(0);
  await expect(page.getByText(/Variation absolue de la fenêtre/)).toHaveCount(
    0,
  );
  await expect(page.getByRole("table")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
