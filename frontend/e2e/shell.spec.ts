import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";

test("public shell is responsive, isolated and keyboard accessible", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Accès à la plateforme" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Se connecter", exact: true }),
  ).toBeEnabled();
  expect(await page.locator("html").getAttribute("lang")).toBe("fr");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  const explanation = page.getByRole("button", { name: "Comprendre l’accès" });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(explanation).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(explanation).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#access-details")).toBeVisible();
  await expect(explanation).toBeFocused();
  await page.keyboard.press("Space");
  await expect(explanation).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#access-details")).toBeHidden();
  await expect(explanation).toBeFocused();

  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
});

test("collapsed and expanded shell pass automated accessibility checks", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Accès à la plateforme" }),
  ).toBeVisible();
  for (const expanded of [false, true]) {
    if (expanded)
      await page.getByRole("button", { name: "Comprendre l’accès" }).click();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    // Retain rule IDs, not DOM snapshots that could later contain business data.
    expect(result.violations.map(({ id }) => id)).toEqual([]);
  }
});
