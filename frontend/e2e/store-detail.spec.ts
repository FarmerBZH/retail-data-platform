import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { installProvider } from "./provider";
import { syntheticStore } from "../test/store-fixture";

const store = syntheticStore({
  region_name: "Région synthétique",
  store_format: "Format synthétique",
  postal_code: "00123",
  annual_turnover_2025_millions: "1234567890.12",
  checkout_count: 0,
  unpublished: "synthetic-unpublished-field",
});

test("detail preserves explicit inclusive months and reads its reference only on demand", async ({
  page,
}) => {
  await installProvider(page);
  let requests = 0;
  await page
    .context()
    .route("https://api.example.test/v1/data/stores?**", async (route) => {
      requests++;
      const url = new URL(route.request().url());
      expect(url.pathname).toBe("/v1/data/stores");
      expect(route.request().method()).toBe("GET");
      expect(
        [...url.searchParams.keys()].every((key) =>
          ["id", "limit"].includes(key),
        ),
      ).toBe(true);
      await route.fulfill({
        contentType: "application/json",
        headers: { "access-control-allow-origin": "http://127.0.0.1:4180" },
        body: JSON.stringify({ items: [store], next_cursor: null }),
      });
    });
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page
    .getByRole("checkbox", { name: `Sélectionner ${store.name}` })
    .check();
  await page.getByRole("button", { name: store.name, exact: true }).click();
  await expect(
    page.getByText("Région actuelle : Région synthétique"),
  ).toBeVisible();
  await expect(page.getByText(/Aucune période appliquée/)).toBeVisible();
  await page.getByLabel("Mois de début").fill("2025-12");
  await page.getByLabel("Mois de fin").fill("2026-02");
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  await expect(
    page.getByText(/Période appliquée : décembre 2025 à février 2026/),
  ).toContainText("3 mois");
  await page.getByLabel("Mois de début").fill("2026-03");
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /Le mois de début doit précéder/ }),
  ).toBeVisible();
  await expect(
    page.getByText(/Période appliquée : décembre 2025 à février 2026/),
  ).toBeVisible();
  await page.getByLabel("Mois de début").fill("2016-02");
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /120/ }),
  ).toBeVisible();
  expect(requests).toBe(2);
  await page
    .getByRole("tab", { name: "Données détaillées", exact: true })
    .click();
  expect(requests).toBe(2);
  await page.getByRole("button", { name: "Référentiel complet" }).click();
  await expect(page.getByText("00123", { exact: true })).toBeVisible();
  await expect(
    page.getByText("1\u202f234\u202f567\u202f890,12", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("dt")).toHaveCount(Object.keys(store).length - 1);
  await expect(page.getByText("synthetic-unpublished-field")).toHaveCount(0);
  expect(requests).toBe(3);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Retour aux magasins" }).click();
  await expect(
    page.getByRole("checkbox", { name: `Sélectionner ${store.name}` }),
  ).toBeChecked();
  await page.getByRole("button", { name: store.name, exact: true }).click();
  await expect(page.getByLabel("Mois de début")).toHaveValue("2016-02");
  await expect(
    page.getByText(/Période appliquée : décembre 2025 à février 2026/),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Données détaillées" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("button", { name: "Référentiel complet" }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
  expect(page.url()).toBe("http://127.0.0.1:4180/");
});
