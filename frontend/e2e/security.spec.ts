import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./support/fixtures";
import { installProvider } from "./support/provider";
import { syntheticStore } from "../test/fixtures/store-fixture";

import { syntheticCsp as csp } from "../test/support/security-policy";

const headers = { "access-control-allow-origin": "http://127.0.0.1:4180" };

test("built assets exclude credential shapes and test providers", async () => {
  // npm run check builds the normal production configuration before Playwright.
  for (const directory of ["dist", "dist-e2e"]) {
    const html = readFileSync(join(directory, "index.html"), "utf8");
    expect(html.includes("/src/")).toBe(false);
    const assets = readdirSync(join(directory, "assets"));
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      expect(/^[A-Za-z0-9_-]+\.(?:js|css)$/.test(asset)).toBe(true);
      const text = readFileSync(join(directory, "assets", asset), "utf8");
      // Heuristic shape checks cannot prove absence of every possible secret.
      expect(
        /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}/.test(
          text,
        ),
      ).toBe(false);
      expect(text.includes("synthetic-access-token")).toBe(false);
      expect(text.includes("synthetic-refresh-token")).toBe(false);
      expect(text.includes("sourceMappingURL=")).toBe(false);
    }
  }
});

test("synthetic CSP permits personal login and MUI while blocking inline script and other origins", async ({
  page,
}) => {
  await installProvider(page);
  const label = "javascript:alert(1) <img src=x onerror=alert(1)>";
  const store = syntheticStore({ name: label });
  await page
    .context()
    .route("https://api.example.test/v1/data/stores?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        headers,
        body: JSON.stringify({ items: [store], next_cursor: null }),
      }),
    );
  const response = await page.goto("/");
  expect(response!.headers()["content-security-policy"]).toBe(csp);
  const signIn = page.getByRole("button", {
    name: "Se connecter",
    exact: true,
  });
  await expect(signIn).toBeEnabled();
  expect(
    await signIn.evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe("rgb(29, 78, 216)");
  await signIn.click();
  await expect(
    page.getByRole("button", { name: label, exact: true }),
  ).toBeVisible();
  expect(page.url()).toBe("http://127.0.0.1:4180/");
  await expect(page.locator("img")).toHaveCount(0);
  await expect(page.locator("a[href^='javascript:']")).toHaveCount(0);
  const blocked = await page.evaluate(async () => {
    const directives: string[] = [];
    const listener = (event: SecurityPolicyViolationEvent) =>
      directives.push(event.effectiveDirective);
    document.addEventListener("securitypolicyviolation", listener);
    const script = document.createElement("script");
    script.textContent = "window.syntheticInlineExecuted=true";
    document.body.append(script);
    let fetchDenied = false;
    try {
      await fetch("https://blocked.example.test/");
    } catch {
      fetchDenied = true;
    }
    // CSP violation events are queued after the blocked operation.
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.removeEventListener("securitypolicyviolation", listener);
    script.remove();
    return {
      directives,
      fetchDenied,
      inlineExecuted: "syntheticInlineExecuted" in window,
    };
  });
  expect(blocked.fetchDenied).toBe(true);
  expect(blocked.inlineExecuted).toBe(false);
  expect(blocked.directives).toContain("connect-src");
  expect(blocked.directives).toContain("script-src-elem");
});

test("logout during a pending retry leaves no credentials, business data or persistent cache", async ({
  page,
}) => {
  const provider = await installProvider(page);
  const marker = "Synthetic confidential business canary";
  let leakedLogs = false;
  page.on("console", (message) => {
    if (
      message.text().includes(provider.accessToken) ||
      message.text().includes(marker)
    )
      leakedLogs = true;
  });
  let calls = 0;
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page
    .context()
    .route("https://api.example.test/v1/data/stores?**", async (route) => {
      calls++;
      if (calls === 2) await pending;
      try {
        await route.fulfill({
          status: calls === 1 ? 503 : 200,
          contentType: "application/json",
          headers: { ...headers, "retry-after": "1" },
          body: JSON.stringify({
            items: [syntheticStore({ name: marker })],
            next_cursor: null,
          }),
        });
      } catch {
        // Logout can cancel this deliberately held response before it is fulfilled.
      }
    });
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Se connecter", exact: true })
      .click();
    await expect.poll(() => calls).toBe(2);
    await page
      .getByRole("button", { name: "Se déconnecter", exact: true })
      .click();
    release();
    await expect(
      page.getByText("Session terminée", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(marker, { exact: true })).toHaveCount(0);
    const state = await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      cookies: document.cookie.length,
      caches: (await caches.keys()).length,
      databases: (await indexedDB.databases()).length,
      workers: (await navigator.serviceWorker.getRegistrations()).length,
    }));
    expect(state).toEqual({
      local: 0,
      session: 0,
      cookies: 0,
      caches: 0,
      databases: 0,
      workers: 0,
    });
    expect((await page.context().cookies()).length).toBe(0);
    expect(leakedLogs).toBe(false);
    expect(provider.exchanges).toBe(1);
    // Leave time for the held request and retry scheduler to settle after cancellation.
    await page.waitForTimeout(1500);
    expect(calls).toBe(2);
    await expect(page.getByText(marker, { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
});
