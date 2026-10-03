import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { installProvider } from "./provider";
import { syntheticStore } from "../test/store-fixture";
import { syntheticResource } from "../test/published-fixture";
import { syntheticMonth } from "../test/monthly-fixture";
import {
  syntheticActivities,
  syntheticActivity,
  syntheticActivityObservation,
  activityObservationIds,
} from "../test/activity-fixture";
const headers = { "access-control-allow-origin": "http://127.0.0.1:4180" };
async function setup(
  page: import("@playwright/test").Page,
  mode: "normal" | "refused" | "delayed" = "normal",
) {
  await installProvider(page);
  let refused = mode === "refused",
    delayed = mode === "delayed",
    release!: () => void,
    started!: () => void;
  const oldStarted = new Promise<void>((done) => {
    started = done;
  });
  const oldRelease = new Promise<void>((done) => {
    release = done;
  });
  const counts = { activity: 0, sales: 0, source: 0 };
  const respond = (
    route: import("@playwright/test").Route,
    body: unknown,
    status = 200,
  ) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers,
      body: JSON.stringify(body),
    });
  await page.context().route("https://api.example.test/v1/resources", (route) =>
    respond(
      route,
      [
        "analytics_activity_month",
        "analytics_store_month",
        "store_activity_metrics",
      ].map((name) =>
        syntheticResource(
          name as
            | "analytics_activity_month"
            | "analytics_store_month"
            | "store_activity_metrics",
        ),
      ),
    ),
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
  for (const name of [
    "analytics_activity_month",
    "analytics_store_month",
  ] as const) {
    await page
      .context()
      .route(`https://api.example.test/v1/data/${name}?**`, async (route) => {
        counts[name === "analytics_activity_month" ? "activity" : "sales"]++;
        const url = new URL(route.request().url());
        expect(url.searchParams.get("store_id")).toBe(store.id);
        expect(route.request().method()).toBe("GET");
        const april = url.searchParams.get("period_from") === "2026-04-01";
        expect(url.searchParams.get("period_to")).toBe(
          april ? "2026-04-01" : "2026-03-01",
        );
        if (name === "analytics_activity_month" && refused) {
          refused = false;
          return respond(route, {}, 403);
        }
        if (name === "analytics_activity_month" && delayed) {
          delayed = false;
          started();
          await oldRelease;
        }
        const items =
          name === "analytics_activity_month"
            ? april
              ? [syntheticActivity({ period: "2026-04-01", activity_count: 8 })]
              : syntheticActivities()
            : [
                syntheticMonth({ period: april ? "2026-04-01" : "2026-01-01" }),
                ...(april
                  ? []
                  : [
                      syntheticMonth({ period: "2026-03-01", revenue: "-0.2" }),
                    ]),
              ];
        await respond(route, { items, next_cursor: null });
      });
  }
  await page
    .context()
    .route(
      "https://api.example.test/v1/data/store_activity_metrics?**",
      (route) => {
        counts.source++;
        const id = new URL(route.request().url()).searchParams.get("id");
        expect(id).toBe(activityObservationIds[0]);
        expect(route.request().method()).toBe("GET");
        return respond(route, {
          items: [syntheticActivityObservation()],
          next_cursor: null,
        });
      },
    );
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByRole("button", { name: store.name, exact: true }).click();
  await page.getByRole("tab", { name: "Activité", exact: true }).click();
  await page.getByLabel("Mois de début").fill("2026-01");
  await page.getByLabel("Mois de fin").fill("2026-03");
  expect(counts).toEqual({ activity: 0, sales: 0, source: 0 });
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  return { counts, oldStarted, release };
}
test("three independent activity series align with sales and open inert live evidence only on demand", async ({
  page,
}) => {
  test.setTimeout(60000);
  const fixture = await setup(page);
  const activity = page.getByRole("region", {
    name: "Activités mensuelles exactes",
  });
  await expect(activity).toBeVisible({ timeout: 15000 });
  await expect(activity).toContainText("Ambiguïté");
  await expect(activity).toContainText("Type absent de la publication");
  const sales = page.getByRole("region", {
    name: "Contexte ventes mensuel exact",
  });
  await expect(sales).toContainText("-0,2", { timeout: 15000 });
  for (const label of [
    "Appels",
    "Visites terrain",
    "Visites participatives",
    "CA observé",
  ])
    await expect(
      page.locator(`svg[aria-label="${label} mensuels"]`),
    ).toBeVisible();
  expect(fixture.counts).toEqual({ activity: 1, sales: 1, source: 0 });
  const trigger = page.getByRole("button", {
    name: "Détail activité Appels, 2026-03",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: /Détail activité — Appels/ }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: /Consulter l’observation/ }),
  ).toHaveCount(2);
  expect(fixture.counts.source).toBe(0);
  await page
    .getByRole("button", { name: "Fermer le détail activité", exact: true })
    .click();
  await expect(trigger).toBeFocused();
  await page
    .getByRole("button", {
      name: "Détail activité Appels, 2026-01",
      exact: true,
    })
    .click();
  const proof = page.getByRole("button", {
    name: `Consulter l’observation ${activityObservationIds[0]}`,
    exact: true,
  });
  await proof.click();
  await expect(
    page.getByText("Synthetic <img src=x> activity", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect(await page.locator("img").count()).toBe(0);
  expect(fixture.counts.source).toBe(1);
  await page
    .getByRole("button", { name: "Fermer l’observation activité", exact: true })
    .click();
  await expect(proof).toBeFocused();
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
  await expect(activity).toHaveCount(0);
  await expect(sales).toHaveCount(0);
});
test("activity refusal is local, keeps sales and recovers only on explicit retry", async ({
  page,
}) => {
  const fixture = await setup(page, "refused");
  await expect(
    page.getByText("Accès refusé à ce bloc.", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByRole("region", { name: "Activités mensuelles exactes" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Contexte ventes mensuel exact" }),
  ).toBeVisible({ timeout: 15000 });
  expect(fixture.counts).toEqual({ activity: 1, sales: 1, source: 0 });
  await page
    .getByRole("button", { name: "Relire l’activité", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Activités mensuelles exactes" }),
  ).toBeVisible({ timeout: 15000 });
  expect(fixture.counts).toEqual({ activity: 2, sales: 1, source: 0 });
});
test("changing applied months during a pending activity read prevents old results returning", async ({
  page,
}) => {
  const fixture = await setup(page, "delayed");
  await fixture.oldStarted;
  await page.getByLabel("Mois de début").fill("2026-04");
  await page.getByLabel("Mois de fin").fill("2026-04");
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  const activity = page.getByRole("region", {
    name: "Activités mensuelles exactes",
  });
  await expect(activity).toContainText("avril 2026", { timeout: 15000 });
  fixture.release();
  await expect(activity).not.toContainText("janvier 2026");
  await expect(
    page.getByRole("button", {
      name: "Détail activité Appels, 2026-04",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "Données détaillées", exact: true })
    .click();
  await expect(activity).toHaveCount(0);
});
