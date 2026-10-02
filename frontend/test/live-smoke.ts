// Opt-in local integration runner. No traces, screenshots, storage states or token output.
import { chromium } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

type Input = {
  issuer: string;
  origin: string;
  api: string;
  pin: string;
  allowed: { username: string; password: string };
  denied: { username: string; password: string };
};
const input = JSON.parse(readFileSync(0, "utf8")) as Input;
const browser = await chromium.launch({
  args: [`--ignore-certificate-errors-spki-list=${input.pin}`],
});
let stage = "prepare";

async function prepare(page: Page) {
  await page.addInitScript(
    ({ api }) => {
      const original = window.fetch.bind(window);
      let token: string | undefined;
      let expiresAt = 0;
      window.fetch = async (...args) => {
        const response = await original(...args);
        if (
          String(args[0]).endsWith("/protocol/openid-connect/token") &&
          response.ok
        ) {
          const value = (await response.clone().json()) as {
            access_token: string;
            expires_in: number;
            refresh_token?: unknown;
          };
          if (value.refresh_token !== undefined)
            throw new Error("Unexpected refresh");
          token = value.access_token;
          expiresAt = Date.now() + value.expires_in * 1000;
        }
        return response;
      };
      // This closure is created only by the test runner; credentials never leave the page.
      Object.defineProperty(window, "liveRead", {
        value: async () => {
          const sessionPath = "/src/session.ts";
          const queryPath = "/src/read-queries.ts";
          const decoderPath = "/src/api-validation.ts";
          const { Session } = (await import(
            sessionPath
          )) as typeof import("../src/session");
          const { ReadQueries } = (await import(
            queryPath
          )) as typeof import("../src/read-queries");
          const { storeSummary } = (await import(
            decoderPath
          )) as typeof import("../src/api-validation");
          if (!token) return { code: "no-token" };
          const session = new Session();
          session.accept(session.begin(), { accessToken: token, expiresAt });
          const reads = new ReadQueries(api, session);
          try {
            const first = await reads.page(
              "stores",
              { limit: 1 },
              storeSummary,
            );
            if (!first.nextCursor) return { code: "missing-cursor" };
            const second = await reads.page(
              "stores",
              { limit: 1, after: first.nextCursor },
              storeSummary,
            );
            return {
              code: "ok",
              count: first.items.length + second.items.length,
              distinct: first.items[0]?.id !== second.items[0]?.id,
              finished: second.nextCursor === null,
            };
          } catch (error) {
            return { code: (error as { code?: string }).code ?? "failed" };
          } finally {
            reads.dispose();
            session.end();
            token = undefined;
          }
        },
      });
    },
    { api: input.api },
  );
}

function check(value: boolean, label: string) {
  if (!value) throw new Error(label);
}

async function login(page: Page, user: Input["allowed"], approved = true) {
  stage = "frontend";
  await page.goto(input.origin);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  stage = "provider";
  await page.waitForURL((url) => url.origin === new URL(input.issuer).origin);
  const authorization = new URL(page.url());
  check(authorization.searchParams.get("prompt") === "login", "prompt");
  check(authorization.searchParams.get("max_age") === "0", "max-age");
  check(
    authorization.searchParams.get("code_challenge_method") === "S256",
    "PKCE",
  );
  await page.locator("#username").fill(user.username);
  await page.locator("#password").fill(user.password);
  await page.locator("#kc-login").click();
  stage = "callback";
  await page.waitForURL(`${input.origin}/`);
  stage = approved ? "allowed-session" : "denied-session";
  if (approved) {
    await page
      .getByRole("button", { name: "Se déconnecter", exact: true })
      .waitFor();
  } else {
    await page.getByText("Connexion interrompue", { exact: true }).waitFor();
    check(
      (await page
        .getByRole("button", { name: "Se déconnecter", exact: true })
        .count()) === 0,
      "denied-session",
    );
  }
  check(
    await page.evaluate(
      () => !location.search && !sessionStorage.length && !localStorage.length,
    ),
    "storage",
  );
  return authorization;
}

try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await prepare(page);
  const authorization = await login(page, input.allowed);
  stage = "read";
  const result = await page.evaluate(async () => {
    const probe = (
      window as unknown as {
        liveRead: () => Promise<{
          code: string;
          count?: number;
          distinct?: boolean;
          finished?: boolean;
        }>;
      }
    ).liveRead;
    return probe();
  });
  check(
    result.code === "ok" &&
      result.count === 2 &&
      result.distinct === true &&
      result.finished === true,
    "API pages",
  );
  await page
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Se connecter", exact: true })
    .waitFor();
  authorization.searchParams.set(
    "redirect_uri",
    `${input.origin}/unregistered`,
  );
  stage = "redirect-refusal";
  const rejected = await page.goto(authorization.href);
  check(rejected?.status() === 400, "callback rejection status");
  check((await page.locator("#username").count()) === 0, "callback rejection");
  await context.close();

  const deniedContext = await browser.newContext({ serviceWorkers: "block" });
  const denied = await deniedContext.newPage();
  await prepare(denied);
  await login(denied, input.denied, false);
  stage = "scope-refusal";
  const refusal = await denied.evaluate(async () =>
    (
      window as unknown as { liveRead: () => Promise<{ code: string }> }
    ).liveRead(),
  );
  check(refusal.code === "forbidden", "scope rejection");
  await deniedContext.close();

  const otherContext = await browser.newContext({ serviceWorkers: "block" });
  const other = await otherContext.newPage();
  await other.goto(input.origin.replace("127.0.0.1", "localhost"));
  stage = "origin-refusal";
  // Browser events may omit rejected preflights; inspect the same request directly.
  const rejection = await otherContext.request.fetch(
    `${input.api}/v1/resources`,
    {
      method: "OPTIONS",
      headers: {
        Origin: input.origin.replace("127.0.0.1", "localhost"),
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    },
  );
  check(
    rejection.status() === 400 &&
      !rejection.headers()["access-control-allow-origin"],
    "API CORS preflight rejection",
  );
  const blocked = await other.evaluate(async (api) => {
    try {
      await fetch(`${api}/v1/resources`, {
        headers: { Authorization: "Bearer synthetic-invalid" },
      });
      return false;
    } catch {
      return true;
    }
  }, input.api);
  check(blocked, "API CORS rejection");
  await otherContext.close();
  process.stdout.write(
    "Browser login, token exchange, two API pages, scope/CORS/callback denial and logout passed.\n",
  );
} catch {
  process.stderr.write(`LIVE_STAGE:${stage}\n`);
  process.stderr.write(
    "Live browser smoke failed; sensitive diagnostics suppressed.\n",
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
