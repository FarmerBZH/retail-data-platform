import { arch, cpus, platform, totalmem } from "node:os";
import type { Route } from "@playwright/test";
import { test, expect } from "./fixtures";
import { installProvider } from "./provider";
import { syntheticStore } from "../test/store-fixture";
import { syntheticResource, syntheticRow } from "../test/published-fixture";
import {
  syntheticProductRows,
  observationId,
} from "../test/product-sales-fixture";

// Local qualification budgets selected before repeated qualification; not production SLOs.
const budgets = {
  loginMs: 8_000,
  salesMs: 10_000,
  journeyMs: 60_000,
  apiRequests: 24,
  apiJsonBytes: 131_072,
  sampledHeapBytes: 134_217_728,
};
const headers = { "access-control-allow-origin": "http://127.0.0.1:4180" };

for (const delayMs of [0, 300]) {
  test(`integrated delivery with ${delayMs} ms synthetic API delay`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    const provider = await installProvider(page);
    const store = syntheticStore();
    const firstPage = Array.from({ length: 25 }, (_, index) =>
      syntheticStore({
        id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
        source_key: `synthetic-${index}`,
        name: `Magasin synthétique ${index}`,
      }),
    );
    let apiRequests = 0,
      apiJsonBytes = 0,
      qualityCalls = 0,
      salesPages = 0,
      proofs = 0;
    page.context().on("request", (request) => {
      if (new URL(request.url()).origin === "https://api.example.test")
        apiRequests++;
    });
    const respond = async (route: Route, value: unknown, status = 200) => {
      const body = JSON.stringify(value);
      apiJsonBytes += Buffer.byteLength(body, "utf8");
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      await route.fulfill({
        status,
        contentType: "application/json",
        headers,
        body,
      });
    };
    await page
      .context()
      .route("https://api.example.test/v1/resources", (route) =>
        respond(
          route,
          (
            [
              "analytics_register_product_month",
              "register_observations",
              "analytics_monthly_link_quality",
            ] as const
          ).map(syntheticResource),
        ),
      );
    await page
      .context()
      .route("https://api.example.test/v1/analytics/status", (route) =>
        respond(route, {
          state: "stale",
          last_completed_at: "2026-01-02T00:00:00Z",
          last_attempt_status: "failed",
        }),
      );
    await page
      .context()
      .route("https://api.example.test/v1/data/stores?**", (route) => {
        const query = new URL(route.request().url()).searchParams;
        return respond(route, {
          items: query.has("id") || query.has("after") ? [store] : firstPage,
          next_cursor:
            query.has("id") || query.has("after") ? null : "synthetic-next",
        });
      });
    await page
      .context()
      .route(
        "https://api.example.test/v1/data/analytics_register_product_month?**",
        (route) => {
          const query = new URL(route.request().url()).searchParams;
          expect(query.get("store_id")).toBe(store.id);
          expect(query.get("period_from")).toBe("2026-01-01");
          expect(query.get("period_to")).toBe("2026-03-01");
          salesPages++;
          return respond(route, {
            items: query.has("after")
              ? syntheticProductRows().slice(2)
              : syntheticProductRows().slice(0, 2),
            next_cursor: query.has("after") ? null : "synthetic-next",
          });
        },
      );
    await page
      .context()
      .route(
        "https://api.example.test/v1/data/register_observations?**",
        (route) => {
          expect(new URL(route.request().url()).searchParams.get("id")).toBe(
            observationId,
          );
          proofs++;
          return respond(route, {
            items: [
              syntheticRow("register_observations", {
                id: observationId,
                store_id: store.id,
                period: "2026-01-01",
                source_gtin: "00000000000001",
                source_product_label: "Preuve synthétique intégrée",
              }),
            ],
            next_cursor: null,
          });
        },
      );
    await page
      .context()
      .route(
        "https://api.example.test/v1/data/analytics_monthly_link_quality?**",
        (route) => {
          qualityCalls++;
          expect(
            new URL(route.request().url()).searchParams.has("store_id"),
          ).toBe(false);
          return qualityCalls === 1
            ? respond(route, { error: "database_unavailable" }, 500)
            : respond(route, {
                items: [
                  syntheticRow("analytics_monthly_link_quality", {
                    dataset: "synthetic-delivery",
                    source_row_count: 0,
                  }),
                ],
                next_cursor: null,
              });
        },
      );
    const start = performance.now();
    await page.goto("/");
    await page
      .getByRole("button", { name: "Se connecter", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Magasin synthétique 24", exact: true }),
    ).toBeVisible();
    const loginMs = performance.now() - start;
    const cdp = await page.context().newCDPSession(page);
    const heaps: number[] = [];
    const sampleHeap = async () => {
      const usage = await cdp.send("Runtime.getHeapUsage");
      heaps.push(usage.usedSize);
    };
    await sampleHeap();
    await page
      .getByRole("button", { name: "Page suivante", exact: true })
      .click();
    await page.getByRole("button", { name: store.name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: store.name, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("tab", { name: "Ventes et produits", exact: true })
      .click();
    await page.getByLabel("Mois de début").fill("2026-01");
    await page.getByLabel("Mois de fin").fill("2026-03");
    expect(salesPages).toBe(0);
    const salesStart = performance.now();
    await page.getByRole("button", { name: "Appliquer", exact: true }).click();
    const table = page.getByRole("region", {
      name: "Ventes par GTIN et mois, valeurs exactes",
    });
    await expect(table).toContainText("-0,2", { timeout: 15_000 });
    const salesMs = performance.now() - salesStart;
    expect(salesPages).toBe(2);
    expect(proofs).toBe(0);
    await sampleHeap();
    await page
      .getByRole("button", {
        name: "Détail GTIN 00000000000001, 2026-01",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: `Consulter l’observation ${observationId}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Preuve synthétique intégrée", { exact: true }),
    ).toBeVisible();
    expect(proofs).toBe(1);
    await page
      .getByRole("button", { name: "Fermer la preuve", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Fermer le détail produit", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Qualité des données", exact: true })
      .click();
    await expect(page.getByText(/audits sont indisponibles/)).toBeVisible();
    await page
      .getByRole("button", {
        name: "Qualité mensuelle du rapprochement",
        exact: true,
      })
      .click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Les données n’ont pas pu être chargées" }),
    ).toBeVisible({ timeout: 15_000 });
    // Failure is local: navigation and logout stay usable, no automatic retry of 500.
    expect(qualityCalls).toBe(1);
    await expect(
      page.getByRole("button", { name: "Se déconnecter", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Réessayer", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Lignes de la collection" }),
    ).toContainText("synthetic-delivery", { timeout: 15_000 });
    expect(qualityCalls).toBe(2);
    await sampleHeap();
    await page
      .getByRole("button", { name: "Se déconnecter", exact: true })
      .click();
    await expect(
      page.getByText("Session terminée", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(
      page.getByText("synthetic-delivery", { exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.length + sessionStorage.length),
    ).toBe(0);
    await sampleHeap();
    await cdp.detach();
    expect(provider.exchanges).toBe(1);
    const metrics = {
      loginMs,
      salesMs,
      journeyMs: performance.now() - start,
      apiRequests,
      apiJsonBytes,
      sampledHeapBytes: Math.max(...heaps),
    };
    for (const key of Object.keys(budgets) as (keyof typeof budgets)[])
      expect(metrics[key], key).toBeLessThanOrEqual(budgets[key]);
    // Only synthetic aggregate measurements; no host names, payloads or credentials.
    console.log(
      "DELIVERY_METRICS " +
        JSON.stringify({
          delayMs,
          width: info.project.use.viewport?.width,
          repeat: info.repeatEachIndex,
          browser: page.context().browser()?.version(),
          machine: {
            platform: platform(),
            arch: arch(),
            logicalCpus: cpus().length,
            ramGiB: totalmem() / 2 ** 30,
          },
          ...metrics,
        }),
    );
  });
}
