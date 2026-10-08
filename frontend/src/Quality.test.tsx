import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { Quality } from "./Quality";
import type { ExplorerReads } from "./DataExplorer";
import { ApiError } from "./read-api";
import { qualityNames, qualityResources } from "./quality-data";
import {
  syntheticId,
  syntheticResource,
  syntheticRow,
} from "../test/published-fixture";
const quality = "analytics_monthly_link_quality";
function services(operations = false) {
  return {
    resources: vi.fn<ExplorerReads["resources"]>(async () =>
      (operations ? qualityNames : ([quality] as const)).map(syntheticResource),
    ),
    status: vi.fn<ExplorerReads["status"]>(async () => ({
      state: "stale",
      lastCompletedAt: "2026-01-02T00:00:00Z",
      lastAttemptStatus: "failed",
    })),
    page: vi.fn<ExplorerReads["page"]>(async (name, _query, decode) => ({
      items: [
        decode(
          syntheticRow(name, {
            dataset: "synthetic-dataset",
            store_match_status: "unmatched",
            source_row_count: 0,
            status: "failed",
            completed_at: null,
            source_run_ids: [
              syntheticId,
              "00000000-0000-4000-8000-000000000002",
            ],
            filename: "synthetic-private-filename",
            source_hash: "synthetic-private-hash",
            error_message: "synthetic-private-error",
          }),
        ),
      ],
      nextCursor: null,
      limit: 25,
    })) as Mock<ExplorerReads["page"]> & ExplorerReads["page"],
  };
}
async function open(name: string) {
  await userEvent.click(await screen.findByRole("button", { name }));
}
it("uses network grain, no store filter, no eager OPS reads, and keeps zero distinct from absence", async () => {
  const reads = services();
  render(<Quality reads={reads} />);
  await screen.findByText(/audits sont indisponibles/);
  expect(reads.page).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Imports" })).toBeNull();
  await open("Qualité mensuelle du rapprochement");
  const table = await screen.findByRole("region");
  expect(table).toHaveTextContent("0");
  expect(screen.getByText(/Périmètre réseau/)).toBeVisible();
  expect(screen.queryByLabelText(/Identifiant magasin/)).toBeNull();
  expect(reads.page.mock.calls[0]![1]).toEqual({ limit: 25 });
  await userEvent.click(
    within(table).getByRole("button", { name: "Ouvrir la ligne 1" }),
  );
  expect(
    await screen.findByText("synthetic-dataset", { exact: true }),
  ).toBeVisible();
  expect(document.body).not.toHaveTextContent("synthetic-private");
  await userEvent.click(
    screen.getByRole("button", { name: "Retour à la qualité" }),
  );
  expect(
    await screen.findByRole("button", {
      name: "Qualité mensuelle du rapprochement",
    }),
  ).toHaveFocus();
  expect(reads.page.mock.calls.every((c) => c[0] === quality)).toBe(true);
});
it.each(["import_runs", "analytics_refresh_runs"] as const)(
  "shows all published %s fields with initialized or uninitialized publication",
  async (name) => {
    const reads = services(true);
    reads.status.mockResolvedValue({
      state: "uninitialized",
      lastCompletedAt: null,
      lastAttemptStatus: "failed",
    });
    render(<Quality reads={reads} />);
    await open(name === "import_runs" ? "Imports" : "Publications analytiques");
    const table = await screen.findByRole("region");
    expect(table).toHaveTextContent("failed");
    await userEvent.click(
      within(table).getByRole("button", { name: "Ouvrir la ligne 1" }),
    );
    await vi.waitFor(() => expect(reads.page).toHaveBeenCalledTimes(2));
    expect(document.querySelectorAll("dt")).toHaveLength(
      syntheticResource(name).columns.length,
    );
    expect(document.body).not.toHaveTextContent("synthetic-private");
    if (name === "analytics_refresh_runs") {
      await userEvent.click(
        screen.getByText("Liste (2 éléments)", { exact: true }),
      );
      expect(document.querySelectorAll("ol > li")).toHaveLength(2);
    }
  },
);
it("rechecks the catalogue before opening an audit and makes no data request if revoked", async () => {
  const reads = services(true);
  reads.resources
    .mockResolvedValueOnce(qualityNames.map(syntheticResource))
    .mockResolvedValue([syntheticResource(quality)]);
  render(<Quality reads={reads} />);
  await open("Imports");
  expect(
    await screen.findByText(
      /Cette collection est indisponible ou non autorisée/,
    ),
  ).toBeVisible();
  expect(reads.page).not.toHaveBeenCalled();
});
it("contains direct audit refusal without echoing diagnostic and leaves quality available", async () => {
  const reads = services(true);
  reads.page.mockRejectedValueOnce(new ApiError("forbidden", 403));
  render(<Quality reads={reads} />);
  await open("Imports");
  expect(
    await screen.findByText("Vous n’avez pas accès à cette collection."),
  ).toBeVisible();
  expect(reads.page).toHaveBeenCalledTimes(1);
  await userEvent.click(
    screen.getByRole("button", { name: "Retour à la qualité" }),
  );
  await open("Qualité mensuelle du rapprochement");
  expect(await screen.findByRole("region")).toBeVisible();
});
it("cancels an audit on departure and rejects its late response", async () => {
  const reads = services(true);
  let resolve!: (value: Awaited<ReturnType<ExplorerReads["page"]>>) => void;
  reads.page.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { unmount } = render(<Quality reads={reads} />);
  await open("Imports");
  await vi.waitFor(() => expect(reads.page).toHaveBeenCalledTimes(1));
  const signal = reads.page.mock.calls[0]![3]!.signal!;
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ items: [], nextCursor: null, limit: 25 }));
  expect(screen.queryByRole("region")).toBeNull();
});
it("fails closed on catalogue error and retries only on demand", async () => {
  const reads = services();
  reads.resources.mockRejectedValueOnce(new Error("synthetic-private-error"));
  render(<Quality reads={reads} />);
  await screen.findByText(/catalogue de qualité n’a pas pu être vérifié/);
  expect(document.body).not.toHaveTextContent("synthetic-private-error");
  expect(reads.page).not.toHaveBeenCalled();
  await open("Réessayer le catalogue");
  expect(
    await screen.findByRole("button", {
      name: "Qualité mensuelle du rapprochement",
    }),
  ).toBeVisible();
});
it("blocks monthly quality before data if analytics are uninitialized", async () => {
  const reads = services();
  reads.status.mockResolvedValue({
    state: "uninitialized",
    lastCompletedAt: null,
    lastAttemptStatus: "failed",
  });
  render(<Quality reads={reads} />);
  await open("Qualité mensuelle du rapprochement");
  expect(
    await screen.findByText("Les analyses ne sont pas initialisées."),
  ).toBeVisible();
  expect(reads.page).not.toHaveBeenCalled();
});
it.each([
  { columns: [...syntheticResource("import_runs").columns, "source_hash"] },
  { columns: ["id"] },
  { keys: ["status"] },
  { filters: ["store_id"] },
  { path: "https://other.example.test/collection" },
])("rejects malformed or nonpublic capability contract %j", (changes) => {
  expect(() =>
    qualityResources([{ ...syntheticResource("import_runs"), ...changes }]),
  ).toThrow();
});
it("rejects duplicated capability entries", () =>
  expect(() =>
    qualityResources([
      syntheticResource("import_runs"),
      syntheticResource("import_runs"),
    ]),
  ).toThrow());
