import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { installProvider } from "./provider";
import { syntheticStore } from "../test/store-fixture";
import { syntheticRow, syntheticResource } from "../test/published-fixture";
import { syntheticTypologyRows, typologyIds } from "../test/typology-fixture";
import { typologyNames } from "../src/typology-data";
import type { Page, Route } from "@playwright/test";
const headers = { "access-control-allow-origin": "http://127.0.0.1:4180" };
async function setup(
  page: Page,
  mode: "normal" | "refused" | "delayed" = "normal",
) {
  await installProvider(page);
  const store = syntheticStore(),
    counts = { collections: 0, sources: 0 };
  let first = true,
    release!: () => void,
    started!: () => void;
  const pending = new Promise<void>((done) => (release = done)),
    oldStarted = new Promise<void>((done) => (started = done));
  const respond = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers,
      body: JSON.stringify(body),
    });
  const names = [
    ...typologyNames,
    "store_typology_values",
    "typology_snapshots",
    "typology_rank_rules",
    "assortments",
    "products",
    "typology_mapping_rules",
  ] as const;
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
  await page
    .context()
    .route("https://api.example.test/v1/data/stores?**", (route) =>
      respond(route, { items: [store], next_cursor: null }),
    );
  for (const name of typologyNames)
    await page
      .context()
      .route(`https://api.example.test/v1/data/${name}?**`, async (route) => {
        counts.collections++;
        const query = new URL(route.request().url()).searchParams;
        expect(query.get("store_id")).toBe(store.id);
        expect(query.get("limit")).toBe("100");
        expect(route.request().method()).toBe("GET");
        const april = query.get("period_from") === "2026-04-01";
        expect(query.get("period_to")).toBe(
          april ? "2026-04-01" : "2026-03-01",
        );
        if (name === "analytics_typology_month" && first) {
          first = false;
          if (mode === "refused") return respond(route, {}, 403);
          if (mode === "delayed") {
            started();
            await pending;
          }
        }
        return respond(route, {
          items: april ? [] : syntheticTypologyRows(name),
          next_cursor: null,
        });
      });
  await page
    .context()
    .route(
      "https://api.example.test/v1/data/typology_snapshots?**",
      (route) => {
        counts.sources++;
        expect(new URL(route.request().url()).searchParams.get("id")).toBe(
          typologyIds[1],
        );
        return respond(route, {
          items: [
            syntheticRow("typology_snapshots", {
              id: typologyIds[1],
              store_id: store.id,
              period: "2026-01-01",
              store_match_status: "matched",
              source_info: "Synthetic <img src=x> reference",
            }),
          ],
          next_cursor: null,
        });
      },
    );
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByRole("button", { name: store.name, exact: true }).click();
  await page
    .getByRole("tab", { name: "Typologies et assortiments", exact: true })
    .click();
  await page.getByLabel("Mois de début").fill("2026-01");
  await page.getByLabel("Mois de fin").fill("2026-03");
  expect(counts.collections).toBe(0);
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  return { counts, release, oldStarted };
}
test("monthly conflicts and independent assortment context keep inert evidence on demand and accessible focus", async ({
  page,
}) => {
  test.setTimeout(60000);
  const fixture = await setup(page),
    table = page.getByRole("region", {
      name: "Typologies mensuelles",
      exact: true,
    });
  await expect(table).toContainText("Valeurs contradictoires", {
    timeout: 15000,
  });
  await expect(
    page.getByRole("region", { name: "Assortiments mensuels par enseigne" }),
  ).toContainText("ambiguous", { timeout: 15000 });
  await expect(
    page.getByText("Lecture complète : 0 lignes, 0/3 mois avec lignes.", {
      exact: false,
    }),
  ).toBeVisible();
  const trigger = table.getByRole("button").first();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", {
      name: "Détail — Typologies mensuelles",
      exact: true,
    }),
  ).toBeFocused();
  expect(fixture.counts.sources).toBe(0);
  const proof = page.getByRole("button", {
    name: `Consulter Instantanés des typologies : ${typologyIds[1]}`,
    exact: true,
  });
  await proof.click();
  await expect(
    page.getByText("Synthetic <img src=x> reference", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect(await page.locator("img").count()).toBe(0);
  expect(fixture.counts.sources).toBe(1);
  await page
    .getByRole("button", { name: "Fermer la référence", exact: true })
    .click();
  await expect(proof).toBeFocused();
  await page
    .getByRole("button", { name: "Fermer le détail typologies", exact: true })
    .click();
  await expect(trigger).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.evaluate(() => (document.documentElement.style.zoom = "2"));
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
test("refusal remains local and recovery is explicit", async ({ page }) => {
  const fixture = await setup(page, "refused");
  await expect(
    page.getByText("Accès refusé à ce bloc.", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByRole("region", { name: "Assortiments mensuels par enseigne" }),
  ).toBeVisible({ timeout: 15000 });
  expect(fixture.counts.collections).toBe(3);
  await page
    .getByRole("button", { name: "Relire Typologies mensuelles", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Typologies mensuelles", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect(fixture.counts.collections).toBe(4);
});
test("changing applied scope cancels pending typologies without returning old values", async ({
  page,
}) => {
  const fixture = await setup(page, "delayed");
  await fixture.oldStarted;
  await page.getByLabel("Mois de début").fill("2026-04");
  await page.getByLabel("Mois de fin").fill("2026-04");
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  const table = page.getByRole("region", {
    name: "Typologies mensuelles",
    exact: true,
  });
  await expect(table).toBeVisible({ timeout: 15000 });
  fixture.release();
  await expect(table).not.toContainText("Synthetic");
  await expect(
    page
      .getByText("Mois sans ligne publiée : avril 2026.", { exact: false })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "Données détaillées", exact: true })
    .click();
  await expect(table).toHaveCount(0);
});
