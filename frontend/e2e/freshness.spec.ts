import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { installProvider } from "./provider";

for (const state of ["current", "stale", "uninitialized"] as const) {
  test(`publication ${state} is qualified independently of coverage`, async ({
    page,
  }) => {
    await installProvider(page);
    await page
      .context()
      .route("https://api.example.test/v1/analytics/status", async (route) => {
        expect(route.request().method()).toBe("GET");
        await route.fulfill({
          contentType: "application/json",
          headers: { "access-control-allow-origin": "http://127.0.0.1:4180" },
          body: JSON.stringify({
            state,
            last_completed_at:
              state === "uninitialized" ? null : "2026-01-01T12:30:00Z",
            last_attempt_status: state === "uninitialized" ? null : "succeeded",
          }),
        });
      });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Se connecter", exact: true })
      .click();
    await expect(
      page.getByText(
        state === "current"
          ? /Publication à jour/
          : state === "stale"
            ? /Publication ancienne/
            : /Aucune publication analytique initialisée/,
      ),
    ).toBeVisible();
    await expect(page.getByText(/ne mesure pas la couverture/)).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() => localStorage.length + sessionStorage.length),
    ).toBe(0);
  });
}

test("failed publication and failed status read preserve a qualified previous publication", async ({
  page,
}) => {
  await installProvider(page);
  let checks = 0;
  await page
    .context()
    .route("https://api.example.test/v1/analytics/status", (route) => {
      checks++;
      return route.fulfill({
        status: checks === 2 ? 500 : 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "http://127.0.0.1:4180" },
        body:
          checks === 2
            ? "{}"
            : JSON.stringify({
                state: checks === 1 ? "current" : "stale",
                last_completed_at: "2026-01-01T12:30:00Z",
                last_attempt_status: "failed",
              }),
      });
    });
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(
    page.getByText(/La dernière mise à jour analytique a échoué/),
  ).toContainText("La publication précédente reste consultable");
  await page.getByRole("button", { name: "Vérifier la fraîcheur" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText(/La fraîcheur n’a pas pu être vérifiée/),
  ).toContainText("dernier état connu");
  await expect(page.getByText(/Dernière publication réussie/)).toBeVisible();
  await page.getByRole("button", { name: "Vérifier la fraîcheur" }).click();
  await expect(page.getByText(/Publication ancienne/)).toBeVisible();
  await expect(page.getByText(/n’a pas pu être vérifiée/)).toHaveCount(0);
  expect(checks).toBe(3);
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page.getByText(/Dernière publication réussie/)).toHaveCount(0);
});
