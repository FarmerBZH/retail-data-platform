import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { installProvider } from "./provider";
import {
  syntheticId,
  syntheticResource,
  syntheticRow,
} from "../test/published-fixture";

const headers = { "access-control-allow-origin": "http://127.0.0.1:4180" };
test("explores second-page products and composite details without eager evidence reads", async ({
  page,
}) => {
  test.setTimeout(60000);
  await installProvider(page);
  const catalog = [
    syntheticResource("products"),
    syntheticResource("analytics_activity_month"),
    syntheticResource("typology_rank_rules"),
    syntheticResource("register_observations"),
    syntheticResource("import_runs"),
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
          state: "current",
          last_completed_at: "2026-01-02T00:00:00Z",
          last_attempt_status: "succeeded",
        }),
      }),
    );
  const requests: URL[] = [];
  await page
    .context()
    .route("https://api.example.test/v1/data/products?**", (route) => {
      const url = new URL(route.request().url());
      requests.push(url);
      const second =
        url.searchParams.has("after") || url.searchParams.has("id");
      return route.fulfill({
        contentType: "application/json",
        headers,
        body: JSON.stringify({
          items: [
            syntheticRow("products", {
              id: second ? "00000000-0000-4000-8000-000000000002" : syntheticId,
              name: second
                ? "Produit sans vente <img src=x onerror=alert(1)>"
                : "Produit synthétique",
              unpublished: "hidden-db-column",
            }),
          ],
          next_cursor: second ? null : "synthetic-next",
        }),
      });
    });
  let activities = 0;
  await page
    .context()
    .route(
      "https://api.example.test/v1/data/analytics_activity_month?**",
      (route) => {
        const url = new URL(route.request().url());
        activities++;
        if (url.searchParams.get("limit") === "1") {
          expect(url.searchParams.get("store_id")).toBe(syntheticId);
          expect(url.searchParams.get("period_from")).toBe("2026-01-01");
          expect(url.searchParams.get("period_to")).toBe("2026-01-01");
          expect(url.searchParams.get("activity_type")).toBe("calls");
        }
        return route.fulfill({
          contentType: "application/json",
          headers,
          body: JSON.stringify({
            items: [
              syntheticRow("analytics_activity_month", {
                activity_type: "calls",
              }),
            ],
            next_cursor: null,
          }),
        });
      },
    );
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByRole("button", { name: "Données", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Données publiées" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Imports", exact: true }),
  ).toHaveCount(0);
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "Produits", exact: true }).click();
  await page
    .getByRole("button", { name: "Page suivante", exact: true })
    .click();
  await expect(page.getByText(/Page 2, 1 lignes/)).toBeVisible();
  await page.getByRole("button", { name: "Ouvrir la ligne 1" }).click();
  await expect(
    page.getByText("Produit sans vente <img src=x onerror=alert(1)>", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator("img")).toHaveCount(0);
  await expect(page.getByText("hidden-db-column")).toHaveCount(0);
  expect(requests).toHaveLength(3);
  expect(requests[1]!.searchParams.get("after")).toBe("synthetic-next");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Retour aux collections" }).click();
  await page
    .getByRole("button", { name: "Activité mensuelle par type" })
    .click();
  await page.getByRole("button", { name: "Ouvrir la ligne 1" }).click();
  const list = page
    .locator("summary")
    .filter({ hasText: "Liste (2 éléments)" });
  await expect(list).toBeVisible({ timeout: 15000 });
  await list.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("li")).toHaveCount(2);
  expect(activities).toBe(2);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Données publiées" }),
  ).toHaveCount(0);
  await expect(page.locator("li")).toHaveCount(0);
});

test("opens unused rules and unmatched observations, handles local refusal", async ({
  page,
}) => {
  test.setTimeout(60000);
  await installProvider(page);
  const catalog = [
    syntheticResource("typology_rank_rules"),
    syntheticResource("register_observations"),
    syntheticResource("analytics_activity_month"),
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
          state: "current",
          last_completed_at: "2026-01-02T00:00:00Z",
          last_attempt_status: null,
        }),
      }),
    );
  for (const resource of [
    "typology_rank_rules",
    "register_observations",
  ] as const) {
    await page
      .context()
      .route(`https://api.example.test/v1/data/${resource}?**`, (route) =>
        route.fulfill({
          contentType: "application/json",
          headers,
          body: JSON.stringify({
            items: [
              syntheticRow(
                resource,
                resource === "register_observations"
                  ? {
                      store_id: null,
                      product_id: null,
                      store_match_status: "unmatched",
                      product_match_status: "unmatched",
                    }
                  : {},
              ),
            ],
            next_cursor: null,
          }),
        }),
      );
  }
  let refused = 0;
  await page
    .context()
    .route(
      "https://api.example.test/v1/data/analytics_activity_month?**",
      (route) => {
        refused++;
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          headers,
          body: JSON.stringify({ error: "forbidden" }),
        });
      },
    );
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByRole("button", { name: "Données", exact: true }).click();
  await page
    .getByRole("button", { name: "Règles de rang des typologies" })
    .click();
  await page.getByRole("button", { name: "Ouvrir la ligne 1" }).click();
  await expect(page.locator("dt").filter({ hasText: "(rank)" })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole("button", { name: "Retour aux collections" }).click();
  await page.getByRole("button", { name: "Observations de ventes" }).click();
  await page.getByRole("button", { name: "Ouvrir la ligne 1" }).click();
  await expect(
    page.getByText("unmatched", { exact: true }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Indisponible", { exact: true })).toHaveCount(2);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.evaluate(() => {
    document.body.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    document.body.style.zoom = "1";
  });
  await page.getByRole("button", { name: "Retour aux collections" }).click();
  await page
    .getByRole("button", { name: "Activité mensuelle par type" })
    .click();
  await expect(
    page.getByText("Vous n’avez pas accès à cette collection."),
  ).toBeVisible({ timeout: 15000 });
  expect(refused).toBe(1);
  await expect(
    page.getByRole("button", { name: "Se connecter", exact: true }),
  ).toHaveCount(0);
});

test("keeps store navigation and fixed context while paging a large evidence list locally", async ({
  page,
}) => {
  test.setTimeout(60000);
  await installProvider(page);
  const { syntheticStore } = await import("../test/store-fixture");
  const store = syntheticStore();
  const catalog = [
    syntheticResource("analytics_activity_month"),
    syntheticResource("products"),
    syntheticResource("analytics_distribution_product_month"),
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
          state: "current",
          last_completed_at: "2026-01-02T00:00:00Z",
          last_attempt_status: null,
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
  let requests = 0;
  const last = "00000000-0000-4000-8000-000000000002";
  await page
    .context()
    .route(
      "https://api.example.test/v1/data/analytics_activity_month?**",
      (route) => {
        requests++;
        expect(
          new URL(route.request().url()).searchParams.get("store_id"),
        ).toBe(store.id);
        return route.fulfill({
          contentType: "application/json",
          headers,
          body: JSON.stringify({
            items: [
              syntheticRow("analytics_activity_month", {
                activity_type: "calls",
                observation_ids: [...Array<string>(10000).fill(store.id), last],
              }),
            ],
            next_cursor: null,
          }),
        });
      },
    );
  const longKey = `synthetic-${"x".repeat(800)}`;
  await page
    .context()
    .route(
      "https://api.example.test/v1/data/analytics_distribution_product_month?**",
      (route) =>
        route.fulfill({
          contentType: "application/json",
          headers,
          body: JSON.stringify({
            items: [
              syntheticRow("analytics_distribution_product_month", {
                product_key: longKey,
              }),
            ],
            next_cursor: null,
          }),
        }),
    );
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page
    .getByRole("checkbox", { name: `Sélectionner ${store.name}` })
    .check();
  await page.getByRole("button", { name: store.name, exact: true }).click();
  await page
    .getByRole("tab", { name: "Données détaillées", exact: true })
    .click();
  await page.getByLabel("Mois de début").fill("2026-01");
  await page.getByLabel("Mois de fin").fill("2026-02");
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  await page.getByLabel("Mois de début").fill("2026-03");
  await page
    .getByRole("button", { name: "Autres collections publiées" })
    .click();
  await page
    .getByRole("button", { name: "Activité mensuelle par type" })
    .click();
  await expect(page.getByLabel("Identifiant magasin (store_id)")).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Appliquer les filtres", exact: true })
    .click();
  await page.getByRole("button", { name: "Ouvrir la ligne 1" }).click();
  const list = page
    .locator("summary")
    .filter({ hasText: "Liste (10001 éléments)" });
  await expect(list).toBeVisible({ timeout: 15000 });
  await list.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("ol > li")).toHaveCount(50);
  const before = requests;
  await page.getByRole("button", { name: "Dernière page de la liste" }).click();
  await expect(page.locator("ol > li")).toHaveCount(1);
  await expect(page.locator("ol > li")).toHaveText(last);
  expect(requests).toBe(before);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Données", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Présence mensuelle par produit",
      exact: true,
    })
    .click();
  await page.getByLabel("Clé produit (product_key)").fill(longKey);
  await page
    .getByRole("button", { name: "Appliquer les filtres", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Ouvrir la ligne 1" }),
  ).toBeVisible({ timeout: 15000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Magasins", exact: true }).click();
  await expect(page.getByLabel("Mois de début")).toHaveValue("2026-03");
  await expect(
    page.getByText(/Période appliquée : janvier 2026 à février 2026/),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Données détaillées" }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Retour aux magasins" }).click();
  await expect(
    page.getByRole("button", { name: store.name, exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("checkbox", { name: `Sélectionner ${store.name}` }),
  ).toBeChecked();
});
