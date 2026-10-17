import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DataExplorer } from "../../src/features/data-explorer/DataExplorer";
import type { ExplorerReads } from "../../src/features/data-explorer/DataExplorer";
import { Quality } from "../../src/features/data-explorer/Quality";
import { resourceNames } from "../../src/api/read-api";
import { publishedContract } from "../../src/features/data-explorer/published-contract";
import {
  resourceLabels,
  rowDecoder,
} from "../../src/features/data-explorer/published-data";
import { syntheticResource, syntheticRow } from "../fixtures/published-fixture";
import { assertValue } from "../support/coverage-render";

function reads(operations: boolean): ExplorerReads {
  return {
    resources: vi.fn(async () =>
      resourceNames
        .filter((n) => operations || !publishedContract[n].operations)
        .map(syntheticResource),
    ),
    status: vi.fn(async () => ({
      state: "current",
      lastCompletedAt: "2026-01-02T00:00:00Z",
      lastAttemptStatus: "succeeded",
    })),
    page: vi.fn(async (name, _query, decode) => ({
      items: [decode(syntheticRow(name))],
      nextCursor: null,
      limit: 25,
    })),
  };
}
for (const name of resourceNames) {
  it(`opens all public fields of ${name} through its authorized native fallback`, async () => {
    const services = reads(publishedContract[name].operations);
    render(
      publishedContract[name].operations ? (
        <Quality reads={services} />
      ) : (
        <DataExplorer reads={services} />
      ),
    );
    expect(services.page).not.toHaveBeenCalled();
    await userEvent.click(
      await screen.findByRole("button", {
        name: resourceLabels[name],
      }),
    );
    const table = await screen.findByRole("region", {
      name: "Lignes de la collection",
    });
    await userEvent.click(
      within(table).getByRole("button", { name: "Ouvrir la ligne 1" }),
    );
    await screen.findByText(`(${syntheticResource(name).columns[0]})`, {});
    const root = document.querySelector("dl")!.parentElement!;
    const row = rowDecoder(syntheticResource(name))(syntheticRow(name));
    assertValue(
      row,
      { kind: "object", fields: publishedContract[name].fields },
      root,
    );
    expect(services.page).toHaveBeenCalledTimes(2);
  });
}
it("offers neither operational fallback nor audit read to an ordinary catalogue", async () => {
  const services = reads(false);
  render(<Quality reads={services} />);
  await screen.findByText(/audits sont indisponibles/);
  expect(screen.queryByRole("button", { name: "Imports" })).toBeNull();
  expect(
    screen.queryByRole("button", {
      name: "Publications analytiques",
    }),
  ).toBeNull();
  expect(services.page).not.toHaveBeenCalled();
});
