import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { providerFixture } from "../test/oidc-provider";

const settings = {
  issuer: "https://identity.example.test",
  clientId: "synthetic-web",
  redirectUri: "http://127.0.0.1:4180/oidc/callback",
};

async function installProvider(page: Page, failure = "") {
  const provider = await providerFixture(settings);
  provider.failure = failure;
  await page.context().route(`${settings.issuer}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/authorize" && request.method() === "GET") {
      provider.authorization = url;
      const callback = new URL(settings.redirectUri);
      callback.search = new URLSearchParams({
        code: "synthetic-code",
        state: url.searchParams.get("state") ?? "",
        iss: settings.issuer,
      }).toString();
      if (failure === "wrong-state")
        callback.searchParams.set("state", "synthetic-wrong");
      if (failure === "wrong-issuer")
        callback.searchParams.set("iss", "https://other.example.test");
      await route.fulfill({
        status: 302,
        headers: { location: callback.href },
      });
    } else {
      const expectedMethod = url.pathname === "/token" ? "POST" : "GET";
      const allowed = [
        "/.well-known/openid-configuration",
        "/token",
        "/jwks",
      ].includes(url.pathname);
      if (!allowed || request.method() !== expectedMethod || url.search)
        throw new Error("Unexpected synthetic provider request");
      const response = await provider.fetch(url.href, {
        method: request.method(),
        body: request.postData(),
      });
      await route.fulfill({
        status: response.status,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "http://127.0.0.1:4180",
        },
        body: await response.text(),
      });
    }
  });
  await page
    .context()
    .route(`${settings.redirectUri}?**`, (route) => route.continue());
  return provider;
}

test("signed PKCE return clears URL and transient storage; reload requires login", async ({
  page,
}) => {
  const provider = await installProvider(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(
    page.getByText("Connexion vérifiée", { exact: true }),
  ).toBeVisible();
  expect(page.url() === "http://127.0.0.1:4180/").toBe(true);
  expect(provider.exchanges).toBe(1);
  expect(provider.pkceValid).toBe(true);
  expect(provider.signatureRead).toBe(true);
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Se connecter", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("Connexion vérifiée", { exact: true }),
  ).toHaveCount(0);
});

for (const failure of [
  "wrong-state",
  "wrong-issuer",
  "nonce",
  "signature",
  "refresh",
  "exchange-refused",
]) {
  test(`fails closed for synthetic ${failure}`, async ({ page }) => {
    const provider = await installProvider(page, failure);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Se connecter", exact: true })
      .click();
    await expect(
      page.getByText("Connexion interrompue", { exact: true }),
    ).toBeVisible();
    expect(page.url() === "http://127.0.0.1:4180/").toBe(true);
    expect(
      await page.evaluate(() => localStorage.length + sessionStorage.length),
    ).toBe(0);
    expect(provider.exchanges).toBe(
      failure === "wrong-state" || failure === "wrong-issuer" ? 0 : 1,
    );
    await expect(
      page.getByRole("button", { name: "Se connecter", exact: true }),
    ).toBeEnabled();
  });
}

test("orphan callback is erased without exchange or session", async ({
  page,
}) => {
  const provider = await installProvider(page);
  await page.goto(
    "/oidc/callback?code=synthetic-orphan&state=synthetic-orphan&iss=https%3A%2F%2Fidentity.example.test",
  );
  await expect(
    page.getByText("Connexion interrompue", { exact: true }),
  ).toBeVisible();
  expect(page.url() === "http://127.0.0.1:4180/").toBe(true);
  expect(provider.exchanges).toBe(0);
});

test("logout clears the screen and requires another explicit personal login", async ({
  page,
}) => {
  const provider = await installProvider(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(
    page.getByText("Connexion vérifiée", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(
    page.getByText("Session terminée", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Connexion vérifiée", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Se connecter", exact: true }),
  ).toBeFocused();
  expect(provider.exchanges).toBe(1);
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(
    page.getByText("Connexion vérifiée", { exact: true }),
  ).toBeVisible();
  expect(provider.exchanges).toBe(2);
});

test("expiry removes the session screen without refresh or automatic login", async ({
  page,
}) => {
  const provider = await installProvider(page);
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(
    page.getByText("Connexion vérifiée", { exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(301_000);
  await expect(
    page.getByText("Session expirée", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Connexion vérifiée", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Se connecter", exact: true }),
  ).toBeFocused();
  expect(provider.exchanges).toBe(1);
});

test("history return cannot restore a previous authenticated screen", async ({
  page,
}) => {
  const provider = await installProvider(page);
  await page.context().route("http://127.0.0.1:4180/away", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Synthetic navigation</title><p>Public destination</p>",
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(
    page.getByText("Connexion vérifiée", { exact: true }),
  ).toBeVisible();
  await page.goto("/away");
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "Se connecter", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("Connexion vérifiée", { exact: true }),
  ).toHaveCount(0);
  expect(provider.exchanges).toBe(1);
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
});
