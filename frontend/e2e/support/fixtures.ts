import { test as base, expect } from "@playwright/test";

// Only public shell assets may reach the local preview. Future API scenarios
// must explicitly fulfill synthetic responses before this deny-by-default route.
export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    let unexpectedRequests = 0;
    let browserErrors = 0;
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const allowedPath =
        url.pathname === "/" ||
        /^\/assets\/[A-Za-z0-9_-]+\.(js|css)$/.test(url.pathname);
      if (
        url.origin === baseURL &&
        request.method() === "GET" &&
        !url.search &&
        allowedPath
      ) {
        await route.continue();
      } else {
        unexpectedRequests += 1;
        await route.abort("blockedbyclient");
      }
    });
    context.on("page", (page) => {
      page.on("pageerror", () => {
        browserErrors += 1;
      });
    });
    await use(context);
    // Report counts only: never echo URLs, response bodies or console payloads.
    expect(unexpectedRequests, "Unexpected network requests").toBe(0);
    expect(browserErrors, "Uncaught browser errors").toBe(0);
  },
});

export { expect };
