import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { test, expect } from "./fixtures";
import { installProvider } from "./provider";
import { qualityNames } from "../src/quality-data";
import {
  syntheticId,
  syntheticResource,
  syntheticRow,
} from "../test/published-fixture";
const headers = { "access-control-allow-origin": "http://127.0.0.1:4180" };
async function setup(page: Page, operations = false, refused = false) {
  const provider = await installProvider(page);
  provider.grantedScope = operations
    ? "openid data:read operations:read"
    : "openid data:read";
  let allowed = operations;
  const calls = { quality: 0, audit: 0 };
  const respond = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      headers,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await page
    .context()
    .route("https://api.example.test/v1/resources", (route) =>
      respond(
        route,
        (allowed ? qualityNames : [qualityNames[0]]).map(syntheticResource),
      ),
    );
  await page
    .context()
    .route("https://api.example.test/v1/analytics/status", (route) =>
      respond(route, {
        state: "stale",
        last_completed_at: "2026-01-02T00:00:00Z",
        last_attempt_status: "failed",
      }),
    );
  await page
    .context()
    .route(
      "https://api.example.test/v1/data/analytics_monthly_link_quality?**",
      (route) => {
        calls.quality++;
        const query = new URL(route.request().url()).searchParams;
        expect(query.has("store_id")).toBe(false);
        expect(route.request().method()).toBe("GET");
        const second =
          query.has("after") || query.get("period_from") === "2026-02-01";
        if (query.has("dataset")) {
          expect(query.get("dataset")).toBe("synthetic-dataset");
          expect(query.get("period_from")).toBe(
            query.get("limit") === "1" ? "2026-02-01" : "2026-01-01",
          );
          expect(query.get("period_to")).toBe("2026-02-01");
          expect(query.get("store_match_status")).toBe("unmatched");
        }
        return respond(route, {
          items: [
            syntheticRow(qualityNames[0], {
              dataset: "synthetic-dataset",
              period: second ? "2026-02-01" : "2026-01-01",
              store_match_status: "unmatched",
              source_row_count: second ? null : 0,
            }),
          ],
          next_cursor:
            query.get("limit") === "1" || second ? null : "synthetic-next",
        });
      },
    );
  for (const name of qualityNames.slice(1))
    await page
      .context()
      .route(`https://api.example.test/v1/data/${name}?**`, (route) => {
        calls.audit++;
        if (!allowed || refused)
          return respond(
            route,
            {
              error: "insufficient_scope",
              diagnostic: "synthetic-private-error",
            },
            403,
          );
        const query = new URL(route.request().url()).searchParams;
        const second =
          query.has("after") ||
          (query.has("id") && query.get("id") !== syntheticId);
        return respond(route, {
          items: [
            syntheticRow(name, {
              id: second ? "00000000-0000-4000-8000-000000000002" : syntheticId,
              dataset: "Synthetic <img src=x> audit",
              status: "failed",
              completed_at: null,
              source_run_ids: [
                syntheticId,
                "00000000-0000-4000-8000-000000000002",
              ],
              source_filename: "synthetic-private-filename",
              source_hash: "synthetic-private-hash",
              error_message: "synthetic-private-error",
            }),
          ],
          next_cursor: second || query.has("id") ? null : "synthetic-next",
        });
      });
  await page.goto("/");
  await page
    .getByRole("button", {
      name: operations ? "Se connecter aux opérations" : "Se connecter",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Qualité des données", exact: true })
    .click();
  expect(provider.authorization?.searchParams.get("scope")).toBe(
    operations ? "openid data:read operations:read" : "openid data:read",
  );
  return {
    calls,
    revoke: () => {
      allowed = false;
      provider.grantedScope = "openid data:read";
      provider.accessToken = "synthetic-second-access-token";
    },
  };
}
test("ordinary quality remains network scoped across filters, cursors and null/zero with no OPS reads", async ({
  page,
}) => {
  test.setTimeout(60000);
  const fixture = await setup(page);
  await expect(page.getByText(/audits sont indisponibles/)).toBeVisible({
    timeout: 15000,
  });
  expect(fixture.calls).toEqual({ quality: 0, audit: 0 });
  await expect(
    page.getByRole("button", { name: "Imports", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Qualité mensuelle du rapprochement",
      exact: true,
    })
    .click();
  const table = page.getByRole("region", { name: "Lignes de la collection" });
  await expect(table).toContainText("0", { timeout: 15000 });
  await page.getByLabel("Jeu de données (dataset)").fill("synthetic-dataset");
  await page
    .getByLabel("Statut de rapprochement magasin (store_match_status)")
    .fill("unmatched");
  await page.getByLabel("Mois de début").fill("2026-01");
  await page.getByLabel("Mois de fin").fill("2026-02");
  await page.getByRole("button", { name: "Appliquer les filtres" }).click();
  await expect(table).toBeVisible({ timeout: 15000 });
  await page
    .getByRole("button", { name: "Page suivante", exact: true })
    .click();
  await expect(table).toContainText("Indisponible", { timeout: 15000 });
  await page.getByRole("button", { name: "Ouvrir la ligne 1" }).click();
  await expect(page.locator("dt")).toHaveCount(4, { timeout: 15000 });
  expect(fixture.calls.audit).toBe(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.evaluate(() => (document.documentElement.style.zoom = "2"));
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
});
test("OPS audits expose only public fields, second page and source run IDs, then clear on user change", async ({
  page,
}) => {
  test.setTimeout(90000);
  const fixture = await setup(page, true);
  const imports = page.getByRole("button", { name: "Imports", exact: true });
  await expect(imports).toBeVisible({ timeout: 15000 });
  expect(fixture.calls.audit).toBe(0);
  await imports.click();
  const table = page.getByRole("region", { name: "Lignes de la collection" });
  await expect(table).toContainText("failed", { timeout: 15000 });
  await page
    .getByRole("button", { name: "Page suivante", exact: true })
    .click();
  await expect(table).toContainText("00000000-0000-4000-8000-000000000002", {
    timeout: 15000,
  });
  await page.getByRole("button", { name: "Ouvrir la ligne 1" }).click();
  await expect(page.locator("dt")).toHaveCount(8, { timeout: 15000 });
  await expect(
    page.getByText("Synthetic <img src=x> audit", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("synthetic-private");
  await page
    .getByRole("button", { name: "Retour à la qualité", exact: true })
    .click();
  await expect(imports).toBeFocused({ timeout: 15000 });
  await page
    .getByRole("button", { name: "Publications analytiques", exact: true })
    .click();
  await expect(table).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Ouvrir la ligne 1" }).click();
  await expect(page.locator("dt")).toHaveCount(6, { timeout: 15000 });
  await page
    .locator("summary")
    .filter({ hasText: "Liste (2 éléments)" })
    .click();
  await expect(page.locator("ol > li")).toHaveCount(2);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const source = page.getByRole("button", {
    name: `Consulter l’import : ${syntheticId}`,
    exact: true,
  });
  const sourceBefore = fixture.calls.audit;
  await source.click();
  await expect(
    page.getByRole("heading", { name: "Référence vivante — Import source" }),
  ).toBeFocused();
  await expect(page.locator("dt")).toHaveCount(14, { timeout: 15000 });
  expect(fixture.calls.audit).toBe(sourceBefore + 1);
  await expect(page.locator("body")).not.toContainText("synthetic-private");
  await page
    .getByRole("button", { name: "Fermer l’import source", exact: true })
    .click();
  await expect(source).toBeFocused();
  const before = fixture.calls.audit;
  await page
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
  await expect(page.locator("dt")).toHaveCount(0);
  fixture.revoke();
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page
    .getByRole("button", { name: "Qualité des données", exact: true })
    .click();
  await expect(page.getByText(/audits sont indisponibles/)).toBeVisible({
    timeout: 15000,
  });
  await expect(imports).toHaveCount(0);
  expect(fixture.calls.audit).toBe(before);
});
test("API audit refusal stays local without private error disclosure", async ({
  page,
}) => {
  test.setTimeout(60000);
  const fixture = await setup(page, true, true);
  await page.getByRole("button", { name: "Imports", exact: true }).click();
  await expect(
    page.getByText("Vous n’avez pas accès à cette collection.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 15000 });
  expect(fixture.calls.audit).toBe(1);
  await expect(page.locator("body")).not.toContainText("synthetic-private");
  await page
    .getByRole("button", { name: "Retour à la qualité", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Qualité mensuelle du rapprochement",
      exact: true,
    })
    .click();
  await expect(page.getByRole("region")).toBeVisible({ timeout: 15000 });
  expect(fixture.calls.audit).toBe(1);
});
