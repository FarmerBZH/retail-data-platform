import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { installProvider } from "./provider";
import { syntheticStore } from "../test/store-fixture";
import { syntheticResource, syntheticRow } from "../test/published-fixture";

// Reach controls through the browser's tab order, without programmatic focus.
async function reach(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let step = 0; step < 100; step++) {
    if (await target.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Control unreachable within the bounded keyboard traversal");
}
async function activate(page: Page, target: Locator) {
  await reach(page, target);
  await page.keyboard.press("Enter");
}
async function check(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations.map(({ id }) => id)).toEqual([]);
}

test("keyboard alone reaches long store and native details, then logout", async ({
  page,
}) => {
  test.setTimeout(90000);
  await installProvider(page);
  const store = syntheticStore({
    name: "Magasin synthétique au libellé volontairement très long pour vérifier le retour au clavier et la lecture sur petit écran",
    address_line_1: "Adresse synthétique ".repeat(12),
  });
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
  await page.context().route("https://api.example.test/v1/resources", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers,
      body: JSON.stringify([syntheticResource("products")]),
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
  await page
    .context()
    .route("https://api.example.test/v1/data/products?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        headers,
        body: JSON.stringify({
          items: [
            syntheticRow("products", {
              name: "Produit synthétique ".repeat(12),
            }),
          ],
          next_cursor: null,
        }),
      }),
    );
  await page.goto("/");
  await activate(
    page,
    page.getByRole("button", { name: "Se connecter", exact: true }),
  );
  const openStore = page.getByRole("button", { name: store.name, exact: true });
  await activate(page, openStore);
  await expect(
    page.getByRole("heading", { name: store.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Magasin", exact: true }),
  ).toBeFocused();
  await check(page);
  const tabs = page.getByRole("tab", { name: "Synthèse", exact: true });
  await reach(page, tabs);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("tab", { name: "Données détaillées" }),
  ).toHaveAttribute("aria-selected", "true");
  const reference = page.getByRole("button", { name: "Référentiel complet" });
  await activate(page, reference);
  await expect(page.locator("#store-reference dt")).toHaveCount(
    Object.keys(store).length,
    { timeout: 15000 },
  );
  await expect(reference).toBeFocused();
  await check(page);
  await activate(
    page,
    page.getByRole("button", { name: "Retour aux magasins" }),
  );
  await expect(openStore).toBeFocused();
  await activate(
    page,
    page.getByRole("button", { name: "Données", exact: true }),
  );
  await activate(
    page,
    page.getByRole("button", { name: "Produits", exact: true }),
  );
  await activate(page, page.getByRole("button", { name: "Ouvrir la ligne 1" }));
  await expect(page.locator("dt")).toHaveCount(
    syntheticResource("products").columns.length,
    { timeout: 15000 },
  );
  await check(page);
  await activate(
    page,
    page.getByRole("button", { name: "Retour à la page de collection" }),
  );
  await activate(
    page,
    page.getByRole("button", { name: "Se déconnecter", exact: true }),
  );
  await expect(
    page.getByRole("button", { name: "Se connecter", exact: true }),
  ).toBeFocused();
});

test("shell reflows with enlarged text and reduced motion without clipping controls", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Accès à la plateforme" }),
  ).toBeVisible();
  // Text enlargement is an automated supplement, not native browser zoom.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await activate(
    page,
    page.getByRole("button", { name: "Comprendre l’accès" }),
  );
  await check(page);
  expect(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
  ).toBe(true);
  expect(
    await page.locator("button").evaluateAll((nodes) =>
      nodes.every((node) => {
        const style = getComputedStyle(node);
        return (
          style.animationName === "none" &&
          style.transitionDuration
            .split(",")
            .every((value) => parseFloat(value) === 0)
        );
      }),
    ),
  ).toBe(true);
  for (const button of await page.getByRole("button").all()) {
    await reach(page, button);
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width + 1,
    );
  }
});

test("loading and failure semantics preserve a keyboard retry", async ({
  page,
}) => {
  await installProvider(page);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const store = syntheticStore();
  await page
    .context()
    .route("https://api.example.test/v1/data/stores?**", async (route) => {
      calls++;
      const failed = calls === 1;
      if (failed) await gate;
      await route.fulfill({
        status: failed ? 500 : 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "http://127.0.0.1:4180" },
        body: JSON.stringify({ items: [store], next_cursor: null }),
      });
    });
  try {
    await page.goto("/");
    await activate(
      page,
      page.getByRole("button", { name: "Se connecter", exact: true }),
    );
    const loading = page
      .getByRole("status")
      .filter({ hasText: "Chargement des magasins" });
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute("aria-busy", "true");
    release();
    const failure = page
      .getByRole("alert")
      .filter({ hasText: "Les magasins n’ont pas pu être chargés" });
    await expect(failure).toBeVisible();
    await activate(
      page,
      failure.getByRole("button", { name: "Réessayer", exact: true }),
    );
    await expect(
      page.getByRole("button", { name: store.name, exact: true }),
    ).toBeVisible();
    await expect(failure).toHaveCount(0);
    expect(calls).toBe(2);
    await check(page);
  } finally {
    release();
  }
});
