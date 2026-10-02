import type { Page } from "@playwright/test";
import { providerFixture } from "../test/oidc-provider";

const settings = {
  issuer: "https://identity.example.test",
  clientId: "synthetic-web",
  redirectUri: "http://127.0.0.1:4180/oidc/callback",
};

export async function installProvider(page: Page, failure = "") {
  await page
    .context()
    .route("https://api.example.test/v1/data/stores?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        headers: { "access-control-allow-origin": "http://127.0.0.1:4180" },
        body: JSON.stringify({ items: [], next_cursor: null }),
      }),
    );
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
