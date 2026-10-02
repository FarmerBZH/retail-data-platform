import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CollectionExplorer, DataExplorer } from "./DataExplorer";
import type { ExplorerReads } from "./DataExplorer";
import type { ReadPage } from "./read-queries";
import type { Decoder } from "./api-validation";
import type { Query, ResourceName } from "./read-api";
import { ApiError } from "./read-api";
import {
  syntheticId,
  syntheticResource,
  syntheticRow,
} from "../test/published-fixture";

afterEach(cleanup);
const freshness = {
  state: "current" as const,
  lastCompletedAt: "2026-01-02T00:00:00Z",
  lastAttemptStatus: "succeeded" as const,
};
function service(name: ResourceName = "products") {
  const page = vi.fn(
    async (
      _name: ResourceName,
      query: Query,
      decode: Decoder<unknown>,
    ): Promise<ReadPage<unknown>> => ({
      items: [decode(syntheticRow(name))],
      nextCursor: null,
      limit: query.limit ?? 25,
    }),
  );
  // Mock records unknown decoded rows; the production page method preserves its generic type.
  const reads: ExplorerReads = {
    resources: vi.fn().mockResolvedValue([syntheticResource(name)]),
    status: vi.fn().mockResolvedValue(freshness),
    page: page as ExplorerReads["page"],
  };
  return { reads, page };
}
it("loads catalogue first, hides operations and makes no list-ID requests", async () => {
  const user = userEvent.setup();
  const { reads, page } = service("analytics_activity_month");
  vi.mocked(reads.resources).mockResolvedValue([
    syntheticResource("analytics_activity_month"),
    syntheticResource("import_runs"),
  ]);
  render(<DataExplorer reads={reads} />);
  await screen.findByRole("button", { name: "Activité mensuelle par type" });
  expect(page).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Imports" }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Activité mensuelle par type" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Ouvrir la ligne 1" }),
  );
  await screen.findByText("Liste (2 éléments)");
  await user.click(screen.getByText("Liste (2 éléments)"));
  expect(document.querySelectorAll("li")).toHaveLength(2);
  expect(page).toHaveBeenCalledTimes(2);
  expect(page.mock.calls[1]![1]).toEqual({
    limit: 1,
    store_id: syntheticId,
    period_from: "2026-01-01",
    period_to: "2026-01-01",
    activity_type: "sssssssss",
  });
  expect(document.querySelector("b")).toBeNull();
});
it("retains filters through second page, detail and back, restoring keyboard focus", async () => {
  const user = userEvent.setup();
  const { reads, page } = service("register_observations");
  page.mockImplementation(async (_name, query, decode) => ({
    items: [
      decode(
        syntheticRow("register_observations", {
          id:
            query.after || query.id
              ? "00000000-0000-4000-8000-000000000002"
              : syntheticId,
        }),
      ),
    ],
    nextCursor: query.after || query.id ? null : "synthetic-cursor",
    limit: query.limit ?? 25,
  }));
  render(
    <CollectionExplorer
      reads={reads}
      resource={syntheticResource("register_observations")}
    />,
  );
  await screen.findByRole("button", { name: "Ouvrir la ligne 1" });
  await user.click(screen.getByLabelText("Identifiant magasin (store_id)"));
  await user.paste(syntheticId);
  await user.click(
    screen.getByRole("button", { name: "Appliquer les filtres" }),
  );
  await waitFor(() => expect(page).toHaveBeenCalledTimes(2));
  await user.click(
    await screen.findByRole("button", { name: "Page suivante" }),
  );
  await waitFor(() => expect(page).toHaveBeenCalledTimes(3));
  expect(page.mock.calls[2]![1]).toEqual({
    store_id: syntheticId,
    limit: 25,
    after: "synthetic-cursor",
  });
  await user.click(
    await screen.findByRole("button", { name: "Ouvrir la ligne 1" }),
  );
  await screen.findByRole("button", { name: "Retour à la page de collection" });
  await user.click(
    screen.getByRole("button", { name: "Retour à la page de collection" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Ouvrir la ligne 1" }),
    ).toHaveFocus(),
  );
  expect(page.mock.calls.at(-1)![1]).toEqual({
    store_id: syntheticId,
    limit: 25,
    after: "synthetic-cursor",
  });
  await user.click(screen.getByRole("button", { name: "Page précédente" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Page suivante" })).toBeEnabled(),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(page.mock.calls.at(-1)![1]).toEqual({
    store_id: syntheticId,
    limit: 25,
  });
});
it("hides data on publication change and permits manual retry", async () => {
  const user = userEvent.setup();
  const { reads } = service();
  vi.mocked(reads.status)
    .mockResolvedValueOnce(freshness)
    .mockResolvedValueOnce({ ...freshness, state: "stale" });
  render(
    <CollectionExplorer
      reads={reads}
      resource={syntheticResource("products")}
    />,
  );
  await screen.findByText("La publication a changé. Rechargez les données.");
  expect(
    screen.queryByRole("button", { name: "Ouvrir la ligne 1" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Réessayer" }));
  await screen.findByRole("button", { name: "Ouvrir la ligne 1" });
});
it("rejects a wrong composite detail, clears old values and cancels on exit", async () => {
  const user = userEvent.setup();
  const { reads, page } = service("analytics_activity_month");
  render(<DataExplorer reads={reads} />);
  await user.click(
    await screen.findByRole("button", { name: "Activité mensuelle par type" }),
  );
  await screen.findByRole("button", { name: "Ouvrir la ligne 1" });
  page.mockImplementationOnce(async (_name, query, decode) => ({
    items: [
      decode(
        syntheticRow("analytics_activity_month", { activity_type: "wrong" }),
      ),
    ],
    nextCursor: null,
    limit: query.limit ?? 25,
  }));
  await user.click(screen.getByRole("button", { name: "Ouvrir la ligne 1" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("wrong")).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Retour aux collections" }),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("reports forbidden locally without retrying or reconnecting", async () => {
  const { reads, page } = service();
  page.mockRejectedValue(new ApiError("forbidden"));
  render(
    <CollectionExplorer
      reads={reads}
      resource={syntheticResource("products")}
    />,
  );
  await screen.findByText("Vous n’avez pas accès à cette collection.");
  expect(page).toHaveBeenCalledTimes(1);
});
it("offers catalogue retry and does not fetch analytics before initialization", async () => {
  const user = userEvent.setup();
  const { reads, page } = service("analytics_activity_month");
  vi.mocked(reads.resources).mockRejectedValueOnce(new ApiError("network"));
  vi.mocked(reads.status).mockResolvedValue({
    state: "uninitialized",
    lastCompletedAt: null,
    lastAttemptStatus: null,
  });
  render(<DataExplorer reads={reads} />);
  await user.click(await screen.findByRole("button", { name: "Réessayer" }));
  await user.click(
    await screen.findByRole("button", { name: "Activité mensuelle par type" }),
  );
  await screen.findByText("Les analyses ne sont pas initialisées.");
  expect(page).not.toHaveBeenCalled();
});

it("keeps the store context fixed while applying editable catalogue filters", async () => {
  const user = userEvent.setup();
  const { reads, page } = service("analytics_activity_month");
  render(
    <CollectionExplorer
      reads={reads}
      resource={syntheticResource("analytics_activity_month")}
      fixedQuery={{ store_id: syntheticId }}
    />,
  );
  await screen.findByRole("button", { name: "Ouvrir la ligne 1" });
  expect(
    screen.queryByLabelText("Identifiant magasin (store_id)"),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Appliquer les filtres" }),
  );
  await waitFor(() => expect(page).toHaveBeenCalledTimes(2));
  expect(page.mock.calls[1]![1]).toEqual({ store_id: syntheticId, limit: 25 });
});
it("offers a fresh first page when a later cursor is rejected", async () => {
  const user = userEvent.setup();
  const { reads, page } = service();
  page.mockImplementation(async (_name, query, decode) => {
    if (query.after) throw new ApiError("invalid-request");
    return {
      items: [decode(syntheticRow("products"))],
      nextCursor: "synthetic-next",
      limit: query.limit ?? 25,
    };
  });
  render(
    <CollectionExplorer
      reads={reads}
      resource={syntheticResource("products")}
    />,
  );
  await user.click(
    await screen.findByRole("button", { name: "Page suivante" }),
  );
  await screen.findByRole("alert");
  await user.click(
    screen.getByRole("button", { name: "Recharger depuis la première page" }),
  );
  await screen.findByRole("button", { name: "Ouvrir la ligne 1" });
  expect(page.mock.calls.at(-1)![1]).toEqual({ limit: 25 });
});
it("restores catalogue focus and avoids focusing a replacement row after a live deletion", async () => {
  const user = userEvent.setup();
  const { reads, page } = service();
  render(<DataExplorer reads={reads} />);
  await user.click(await screen.findByRole("button", { name: "Produits" }));
  await user.click(
    await screen.findByRole("button", { name: "Ouvrir la ligne 1" }),
  );
  await screen.findByRole("button", { name: "Retour à la page de collection" });
  page.mockImplementationOnce(async (_name, query, decode) => ({
    items: [
      decode(
        syntheticRow("products", {
          id: "00000000-0000-4000-8000-000000000002",
        }),
      ),
    ],
    nextCursor: null,
    limit: query.limit ?? 25,
  }));
  await user.click(
    screen.getByRole("button", { name: "Retour à la page de collection" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "Produits" })).toHaveFocus(),
  );
  await user.click(
    screen.getByRole("button", { name: "Retour aux collections" }),
  );
  expect(screen.getByRole("button", { name: "Produits" })).toHaveFocus();
});
it("renders a large evidence list in local pages and retains every element without extra requests", async () => {
  const user = userEvent.setup();
  const { reads, page } = service("analytics_activity_month");
  const last = "00000000-0000-4000-8000-000000000002";
  page.mockImplementation(async (_name, query, decode) => ({
    items: [
      decode(
        syntheticRow("analytics_activity_month", {
          observation_ids: [...Array<string>(10000).fill(syntheticId), last],
        }),
      ),
    ],
    nextCursor: null,
    limit: query.limit ?? 25,
  }));
  render(
    <CollectionExplorer
      reads={reads}
      resource={syntheticResource("analytics_activity_month")}
    />,
  );
  await user.click(
    await screen.findByRole("button", { name: "Ouvrir la ligne 1" }),
  );
  await user.click(await screen.findByText("Liste (10001 éléments)"));
  expect(document.querySelectorAll("li[value], ol > li")).toHaveLength(50);
  await user.click(
    screen.getByRole("button", { name: "Dernière page de la liste" }),
  );
  expect(document.querySelectorAll("ol > li")).toHaveLength(1);
  expect(screen.getByText(last)).toBeInTheDocument();
  expect(page).toHaveBeenCalledTimes(2);
});
