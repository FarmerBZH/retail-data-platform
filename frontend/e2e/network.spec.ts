import AxeBuilder from "@axe-core/playwright";
import { test, expect as baseExpect } from "./fixtures";

// Shared transport deliberately spaces API reads; use the same bounded budget
// as the other multi-resource browser journeys.
const expect = baseExpect.configure({ timeout: 15000 });
test.describe.configure({ timeout: 60000 });
import { installProvider } from "./provider";
import { syntheticNetwork } from "../test/network-fixture";
import { syntheticResource } from "../test/published-fixture";
import { resourceNames } from "../src/read-api";

async function setup(
  page: import("@playwright/test").Page,
  incomplete = false,
) {
  await installProvider(page);
  const headers = { "access-control-allow-origin": "http://127.0.0.1:4180" };
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
  await page.context().route("https://api.example.test/v1/resources", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers,
      body: JSON.stringify(
        resourceNames
          .filter((n) => n.startsWith("analytics_network_"))
          .map(syntheticResource),
      ),
    }),
  );
  let requests = 0;
  await page
    .context()
    .route(
      /https:\/\/api\.example\.test\/v1\/data\/analytics_network_/,
      (route) => {
        requests++;
        const url = new URL(route.request().url());
        expect(route.request().method()).toBe("GET");
        expect(url.searchParams.has("store_id")).toBe(false);
        const name = url.pathname
          .split("/")
          .at(-1)! as (typeof resourceNames)[number];
        if (name.endsWith("overview")) {
          expect(url.searchParams.get("scope")).toBe("network");
          expect(url.searchParams.has("period_from")).toBe(false);
        } else {
          expect(url.searchParams.get("period_from")).toBe("2026-01-01");
          expect(url.searchParams.get("period_to")).toBe(
            name.endsWith("year") ? "2026-01-01" : "2026-03-01",
          );
        }
        const second = url.searchParams.has("after");
        const changes = name.endsWith("changes");
        const rows = changes
          ? [
              syntheticNetwork(name, {
                revenue: "0",
                revenue_previous_month: "-1",
                revenue_previous_year: "0",
                revenue_month_change: "1",
                revenue_month_change_ratio: "-1",
                revenue_year_change: "0",
                revenue_year_change_ratio: null,
              }),
            ]
          : [
              syntheticNetwork(
                name,
                second
                  ? {
                      period: "2026-03-01",
                      revenue: "0",
                      revenue_partial: "0",
                      revenue_covered_cell_count: 2,
                    }
                  : {},
              ),
            ];
        return route.fulfill({
          contentType: "application/json",
          headers,
          body: JSON.stringify({
            items: rows,
            next_cursor: incomplete
              ? `next-${requests}`
              : name.endsWith("month") && !second
                ? "next-page"
                : null,
          }),
        });
      },
    );
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByRole("button", { name: "Vue réseau", exact: true }).click();
  return () => requests;
}
for (const width of [360, 768, 1440])
  test(`network exact coverage, pagination and accessibility at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const requests = await setup(page);
    const values = page.getByRole("region", {
      name: "Valeurs réseau exactes",
      exact: true,
    });
    await expect(values).toContainText("0,3 — partiel ; 1/2");
    await expect(values).toContainText("0 — complet ; 2/2");
    await page.getByRole("combobox", { name: "Lecture réseau" }).click();
    await page.getByRole("option", { name: "Par mois", exact: true }).click();
    await page.getByLabel("Mois de début").fill("2026-01");
    await page.getByLabel("Mois de fin").fill("2026-03");
    expect(requests()).toBe(1);
    await page
      .getByRole("button", { name: "Appliquer", exact: true })
      .press("Enter");
    await expect(values).toContainText("mars 2026");
    await expect(
      page.getByText("février 2026 — mois absent de la publication"),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Comparaisons réseau exactes" }),
    ).toContainText("Base négative");
    await expect(
      page.getByRole("region", { name: "Comparaisons réseau exactes" }),
    ).toContainText("Indisponible");
    expect(requests()).toBe(4);
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
    await expect(values).toHaveCount(0);
  });
test("network pagination failure does not expose incomplete KPIs", async ({
  page,
}) => {
  await setup(page, true);
  await expect(page.getByText(/Lecture incomplète/)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Valeurs réseau exactes" }),
  ).toHaveCount(0);
});
test("annual view labels actual months and uses year keys", async ({
  page,
}) => {
  await setup(page);
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("combobox", { name: "Lecture réseau" }).click();
  await page.getByRole("option", { name: "Par année", exact: true }).click();
  await page.getByLabel("Mois de début").fill("2026-02");
  await page.getByLabel("Mois de fin").fill("2026-03");
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  await expect(page.getByRole("table")).toContainText("Année 2026 — 1 mois");
});
