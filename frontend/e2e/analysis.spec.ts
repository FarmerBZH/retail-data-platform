import AxeBuilder from "@axe-core/playwright";
import { test, expect as baseExpect } from "./support/fixtures";
import { installProvider } from "./support/provider";
import {
  analysisFixture,
  analysisStore,
  fixtureQuery,
  publication,
  syntheticId,
} from "../test/fixtures/analysis-fixture";
import type { AnalysisRoute } from "../src/api/analysis-contract";
import { syntheticMonth } from "../test/fixtures/monthly-fixture";
import { syntheticResource } from "../test/fixtures/published-fixture";
const expect = baseExpect.configure({ timeout: 15000 });
test.describe.configure({ timeout: 60000 });
async function setup(page: import("@playwright/test").Page, total = 7) {
  await installProvider(page);
  const headers = { "access-control-allow-origin": "http://127.0.0.1:4180" };
  let conflict = false;
  let failSeries = false;
  let slow = false;
  let delayed = false;
  let requests = 0;
  const queries: { route: string; query: URLSearchParams }[] = [];
  await page
    .context()
    .route("https://api.example.test/v1/analytics/status", (route) =>
      route.fulfill({
        headers,
        contentType: "application/json",
        body: JSON.stringify({
          state: "current",
          last_completed_at: "2025-03-01T00:00:00Z",
          last_attempt_status: "succeeded",
        }),
      }),
    );
  await page.context().route("https://api.example.test/v1/resources", (route) =>
    route.fulfill({
      headers,
      contentType: "application/json",
      body: JSON.stringify([
        syntheticResource("stores"),
        syntheticResource("analytics_store_month"),
      ]),
    }),
  );
  await page
    .context()
    .route(/https:\/\/api\.example\.test\/v1\/data\/stores/, (route) => {
      const query = new URL(route.request().url()).searchParams;
      const ids = query.get("id")
        ? [Number(query.get("id")!.slice(-12))]
        : [1, 2];
      return route.fulfill({
        headers,
        contentType: "application/json",
        body: JSON.stringify({
          items: ids.map((i) => {
            const s = analysisStore(i);
            return {
              id: s.store_id,
              name: s.name,
              city: s.city,
              retailer_name: s.retailer_name,
              is_active: s.is_active,
              region_name: null,
              store_format: s.store_format,
            };
          }),
          next_cursor: null,
        }),
      });
    });
  await page
    .context()
    .route(
      "https://api.example.test/v1/data/analytics_store_month?*",
      (route) => {
        const q = new URL(route.request().url()).searchParams;
        return route.fulfill({
          headers,
          contentType: "application/json",
          body: JSON.stringify({
            items: [
              syntheticMonth({
                store_id: q.get("store_id"),
                period: q.get("period_from"),
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
      "https://api.example.test/v1/analytics/analysis/*",
      async (route) => {
        const request = route.request();
        if (request.method() === "OPTIONS")
          return route.fulfill({
            status: 200,
            headers: {
              ...headers,
              "access-control-allow-methods": "GET",
              "access-control-allow-headers": "authorization",
            },
          });
        expect(request.method()).toBe("GET");
        const url = new URL(request.url());
        const name = url.pathname.split("/").at(-1)! as AnalysisRoute;
        const q = fixtureQuery(url.searchParams);
        requests++;
        queries.push({ route: name, query: url.searchParams });
        if (q.after) expect(q.publication_id).toBe(publication);
        if (conflict)
          return route.fulfill({
            status: 409,
            headers,
            contentType: "application/json",
            body: '{"error":"publication_changed"}',
          });
        if (failSeries && name === "series")
          return route.fulfill({
            status: 403,
            headers,
            contentType: "application/json",
            body: '{"error":"insufficient_scope"}',
          });
        if (slow && name === "summary" && !delayed) {
          delayed = true;
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
        await route.fulfill({
          headers,
          contentType: "application/json",
          body: JSON.stringify(analysisFixture(name, q, total)),
        });
      },
    );
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page
    .getByRole("button", { name: "Analyses filtrées", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Appliquer l’analyse", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Début de l’analyse").fill("2025-02");
  await page.getByLabel("Fin de l’analyse").fill("2025-02");
  return {
    queries,
    requests: () => requests,
    conflict: () => {
      conflict = true;
    },
    fail: () => {
      failSeries = true;
    },
    slow: () => {
      slow = true;
    },
  };
}
async function apply(page: import("@playwright/test").Page) {
  await page
    .getByRole("button", { name: "Appliquer l’analyse", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("heading", { name: /Résultats appliqués/ }),
  ).toBeVisible();
}
test("filtered A/B oracle, inert labels, fixed cohorts, exact tables and accessibility", async ({
  page,
}) => {
  const h = await setup(page);
  await page
    .getByRole("checkbox", {
      name: "Sélectionner Magasin synthétique 1",
      exact: true,
    })
    .check();
  await page.getByRole("checkbox", { name: /Sélectionner <img/ }).check();
  const before = h.requests();
  await apply(page);
  await expect(
    page.getByText("CA observé — partiel", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Somme globale.*20/)).toBeVisible();
  const summary = h.queries.find((q) => q.route === "summary")!;
  expect(summary.query.getAll("store_ids")).toEqual([
    syntheticId(1),
    syntheticId(2),
  ]);
  expect(summary.query.get("publication_id")).toBe(publication);
  expect(h.requests()).toBeGreaterThan(before);
  await page.getByRole("switch", { name: /Cohorte comparable/ }).check();
  await expect(
    page.getByText("CA observé — cohorte comparable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: "Valeurs mensuelles filtrées",
      exact: true,
    }),
  ).toContainText("120 — partiel");
  expect(await page.locator("img[src=x]").count()).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
  await page
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
  await expect(page.getByText(/Somme globale/)).toHaveCount(0);
});
test("seven selections, six visible series and preserved total", async ({
  page,
}) => {
  await setup(page);
  const checks = page.getByRole("checkbox", { name: /^Sélectionner / });
  await expect(checks).toHaveCount(7);
  for (const check of await checks.all()) await check.check();
  await apply(page);
  await page
    .getByRole("tab", { name: "Comparer les magasins", exact: true })
    .click();
  await expect(
    page.getByText(/7 magasins dans le total appliqué ; 6 séries visibles/),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole("button", { name: "Séries suivantes", exact: true })
    .click();
  await expect(
    page.getByText(/7 magasins dans le total appliqué ; 1 séries visibles/),
  ).toBeVisible();
  await expect(page.getByText(/7 magasins retenus/)).toBeVisible();
});
test("ranking second page, server sort, detail return and keyboard focus", async ({
  page,
}) => {
  const h = await setup(page, 25);
  await apply(page);
  await page.getByRole("tab", { name: "Classement", exact: true }).click();
  const table = page.getByRole("region", {
    name: "Classement filtré exact",
    exact: true,
  });
  await expect(
    table.getByRole("button", { name: "Magasin synthétique 1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Classement suivant", exact: true })
    .press("Enter");
  await expect(table).toContainText("21");
  expect(
    h.queries
      .filter((q) => q.route === "ranking")
      .at(-1)!
      .query.get("after"),
  ).toBe("synthetic:20");
  await page
    .getByRole("button", { name: "Classement précédent", exact: true })
    .click();
  await table
    .getByRole("button", { name: "Magasin synthétique 1", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Magasin synthétique 1", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("Début de l’analyse")).toHaveValue("2025-02");
  await expect(
    table.getByRole("button", { name: "Magasin synthétique 1", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("combobox", { name: "Sens du classement", exact: true })
    .click();
  await page.getByRole("option", { name: "Croissant", exact: true }).click();
  await expect(table).toContainText("Magasin synthétique 3");
  expect(
    h.queries
      .filter((q) => q.route === "ranking")
      .at(-1)!
      .query.get("direction"),
  ).toBe("asc");
});
test("publication change removes every result and does not loop", async ({
  page,
}) => {
  const h = await setup(page);
  await apply(page);
  h.conflict();
  await page.getByRole("tab", { name: "Classement", exact: true }).click();
  await expect(page.getByText(/La publication a changé/)).toBeVisible();
  await expect(page.getByText(/Somme globale/)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /Résultats appliqués/ }),
  ).toHaveCount(0);
  const count = h.requests();
  await page.waitForTimeout(300);
  expect(h.requests()).toBe(count);
});
test("local refusal preserves summary, and changed draft waits for Apply", async ({
  page,
}) => {
  const h = await setup(page);
  h.fail();
  await apply(page);
  await expect(
    page.getByText("Accès refusé à ces analyses.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Somme globale/)).toBeVisible();
  const count = h.requests();
  await page.getByLabel("Début de l’analyse").fill("2025-01");
  expect(h.requests()).toBe(count);
  await expect(
    page.getByRole("heading", {
      name: /Résultats appliqués — février 2025 à février 2025/,
    }),
  ).toBeVisible();
});

test("a slow old context cannot replace a newly applied window", async ({
  page,
}) => {
  const h = await setup(page);
  h.slow();
  await page
    .getByRole("button", { name: "Appliquer l’analyse", exact: true })
    .click();
  await expect
    .poll(() => h.queries.some((q) => q.route === "summary"))
    .toBe(true);
  await page.getByLabel("Début de l’analyse").fill("2025-01");
  await page
    .getByRole("button", { name: "Appliquer l’analyse", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: /Résultats appliqués — janvier 2025 à février 2025/,
    }),
  ).toBeVisible();
  await page.waitForTimeout(1300);
  await expect(
    page.getByRole("heading", {
      name: /Résultats appliqués — février 2025 à février 2025/,
    }),
  ).toHaveCount(0);
});

test("logout during analysis clears the entire context before the late response", async ({
  page,
}) => {
  const h = await setup(page);
  h.slow();
  await page
    .getByRole("checkbox", {
      name: "Sélectionner Magasin synthétique 1",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Appliquer l’analyse", exact: true })
    .click();
  await expect
    .poll(() => h.queries.some((q) => q.route === "summary"))
    .toBe(true);
  await page
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Se connecter", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1300);
  await expect(page.getByText(/Résultats appliqués|Somme globale/)).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
});
