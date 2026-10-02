import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { installProvider } from "./provider";

const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
const long =
  "Magasin synthétique avec un très long libellé accessible sans troncature et <script>texte inerte</script>";
const first = {
  id: a,
  name: long,
  retailer_name: null,
  region_name: null,
  store_format: null,
  city: "Ville synthétique",
  is_active: false,
};
const second = {
  ...first,
  id: b,
  name: "Autre magasin synthétique",
  is_active: true,
};
const third = {
  ...first,
  id: "00000000-0000-4000-8000-000000000003",
  name: "Z magasin synthétique",
  is_active: true,
};

test("store pages preserve selection, local sort and keyboard return; logout removes business data", async ({
  page,
}) => {
  await installProvider(page);
  let requests = 0;
  await page.context().route("https://api.example.test/**", async (route) => {
    requests++;
    const url = new URL(route.request().url());
    expect(url.pathname).toBe("/v1/data/stores");
    expect(route.request().method()).toBe("GET");
    expect(
      [...url.searchParams.keys()].every((key) =>
        ["id", "after", "limit"].includes(key),
      ),
    ).toBe(true);
    const detail = url.searchParams.get("id");
    await route.fulfill({
      contentType: "application/json",
      headers: { "access-control-allow-origin": "http://127.0.0.1:4180" },
      body: JSON.stringify({
        items: detail
          ? [second]
          : url.searchParams.has("after")
            ? [second]
            : [first, third],
        next_cursor:
          detail || url.searchParams.has("after") ? null : "synthetic-next",
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByRole("checkbox", { name: `Sélectionner ${long}` }).check();
  await expect(page.getByText("Inactif", { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const beforeSort = requests;
  await page.getByRole("combobox", { name: "Trier cette page" }).click();
  await page.getByRole("option", { name: "Nom décroissant" }).click();
  await expect(page.getByRole("row").nth(1)).toContainText(third.name);
  expect(requests).toBe(beforeSort);
  await page
    .getByRole("button", { name: "Page suivante", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: `Sélectionner ${second.name}` })
    .check();
  await expect(
    page.getByText("2 magasins sélectionnés", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: second.name, exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: second.name, exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Retour aux magasins" }).click();
  await expect(
    page.getByRole("button", { name: second.name, exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("checkbox", { name: `Sélectionner ${second.name}` }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Page précédente", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: `Sélectionner ${long}` }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Vider la sélection" }).click();
  await expect(
    page.getByText("0 magasin sélectionné", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Comparer la sélection" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
  expect(page.url()).toBe("http://127.0.0.1:4180/");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page.getByText(long, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Se connecter", exact: true }),
  ).toBeFocused();
});

test("a missing store has an explicit state and a usable return", async ({
  page,
}) => {
  await installProvider(page);
  await page
    .context()
    .route("https://api.example.test/v1/data/stores?**", (route) => {
      const detail = new URL(route.request().url()).searchParams.has("id");
      return route.fulfill({
        contentType: "application/json",
        headers: { "access-control-allow-origin": "http://127.0.0.1:4180" },
        body: JSON.stringify({
          items: detail ? [] : [second],
          next_cursor: null,
        }),
      });
    });
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByRole("button", { name: second.name, exact: true }).click();
  await expect(
    page.getByText(/Ce magasin n’est plus disponible/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retour aux magasins" }).click();
  await expect(
    page.getByRole("button", { name: second.name, exact: true }),
  ).toBeFocused();
});

test("manual retry recovers from a synthetic API failure", async ({ page }) => {
  await installProvider(page);
  let requests = 0;
  await page
    .context()
    .route("https://api.example.test/v1/data/stores?**", (route) => {
      requests++;
      return route.fulfill({
        status: requests === 1 ? 500 : 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "http://127.0.0.1:4180" },
        body: JSON.stringify({ items: [second], next_cursor: null }),
      });
    });
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(
    page.getByText(/Les magasins n’ont pas pu être chargés/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: second.name, exact: true }),
  ).toBeVisible();
  expect(requests).toBe(2);
});
