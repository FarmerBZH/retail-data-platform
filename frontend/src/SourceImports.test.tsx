import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { SourceImports } from "./SourceImports";
import type { ExplorerReads } from "./DataExplorer";
import type { PublishedRow } from "./published-data";
import {
  syntheticId,
  syntheticResource,
  syntheticRow,
} from "../test/published-fixture";
const otherId = "00000000-0000-4000-8000-000000000002";
function services() {
  return {
    resources: vi.fn<ExplorerReads["resources"]>(async () => [
      syntheticResource("import_runs"),
    ]),
    status: vi.fn<ExplorerReads["status"]>(async () => ({
      state: "uninitialized",
      lastCompletedAt: null,
      lastAttemptStatus: "failed",
    })),
    page: vi.fn<ExplorerReads["page"]>(async (_name, query, decode) => ({
      items: [decode(syntheticRow("import_runs", { id: query.id }))],
      nextCursor: null,
      limit: 2,
    })) as Mock<ExplorerReads["page"]> & ExplorerReads["page"],
  };
}
const row = {
  id: syntheticId,
  source_run_ids: [syntheticId, otherId],
} as PublishedRow;
const open = () =>
  userEvent.click(
    screen.getByRole("button", { name: `Consulter l’import : ${syntheticId}` }),
  );
it("reads a source import only explicitly, with exact ID, and restores focus", async () => {
  const reads = services();
  render(<SourceImports row={row} reads={reads} />);
  expect(reads.resources).not.toHaveBeenCalled();
  expect(reads.page).not.toHaveBeenCalled();
  const trigger = screen.getByRole("button", {
    name: `Consulter l’import : ${syntheticId}`,
  });
  await open();
  expect(
    screen.getByRole("heading", { name: "Référence vivante — Import source" }),
  ).toHaveFocus();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("dt")).toHaveLength(8),
  );
  expect(reads.page).toHaveBeenCalledWith(
    "import_runs",
    { id: syntheticId, limit: 2 },
    expect.any(Function),
    expect.objectContaining({ refresh: true }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Fermer l’import source" }),
  );
  expect(trigger).toHaveFocus();
});
it("rechecks import capability before data and never requests it when absent", async () => {
  const reads = services();
  reads.resources.mockResolvedValue([]);
  render(<SourceImports row={row} reads={reads} />);
  await open();
  expect(await screen.findByText(/Cet import est indisponible/)).toBeVisible();
  expect(reads.page).not.toHaveBeenCalled();
});
it.each(["wrong-id", "multiple", "cursor", "freshness"])(
  "rejects inconsistent reference %s while leaving publication links",
  async (mode) => {
    const reads = services();
    reads.page.mockImplementationOnce(async (_name, _query, decode) => ({
      items: Array.from({ length: mode === "multiple" ? 2 : 1 }, () =>
        decode(
          syntheticRow("import_runs", {
            id: mode === "wrong-id" ? otherId : syntheticId,
          }),
        ),
      ),
      nextCursor: mode === "cursor" ? "synthetic-next" : null,
      limit: 2,
    }));
    if (mode === "freshness")
      reads.status.mockResolvedValueOnce({
        state: "current",
        lastCompletedAt: "2026-01-02T00:00:00Z",
        lastAttemptStatus: "succeeded",
      });
    render(<SourceImports row={row} reads={reads} />);
    await open();
    expect(
      await screen.findByText(/Cet import est indisponible/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: `Consulter l’import : ${otherId}` }),
    ).toBeVisible();
  },
);
it("keeps missing import distinct from refusal and aborts a departed pending read", async () => {
  const reads = services();
  reads.page.mockResolvedValueOnce({ items: [], nextCursor: null, limit: 2 });
  render(<SourceImports row={row} reads={reads} />);
  await open();
  expect(
    await screen.findByText(/Import source absent ou supprimé/),
  ).toBeVisible();
  let resolve!: (value: Awaited<ReturnType<ExplorerReads["page"]>>) => void;
  reads.page.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Relire l’import source" }),
  );
  await vi.waitFor(() => expect(reads.page).toHaveBeenCalledTimes(2));
  const signal = reads.page.mock.calls[1]![3]!.signal!;
  await userEvent.click(
    screen.getByRole("button", { name: "Fermer l’import source" }),
  );
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ items: [], nextCursor: null, limit: 2 }));
  expect(screen.queryByText(/Import source absent ou supprimé/)).toBeNull();
});
it("paginates every source ID locally with no eager calls", async () => {
  const reads = services();
  render(
    <SourceImports
      row={{
        source_run_ids: Array<string>(50).fill(syntheticId).concat(otherId),
      }}
      reads={reads}
    />,
  );
  expect(document.querySelectorAll("li")).toHaveLength(50);
  await userEvent.click(
    screen.getByRole("button", { name: "Imports suivants" }),
  );
  expect(document.querySelectorAll("li")).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: `Consulter l’import : ${otherId}` }),
  ).toBeVisible();
  expect(reads.page).not.toHaveBeenCalled();
});
