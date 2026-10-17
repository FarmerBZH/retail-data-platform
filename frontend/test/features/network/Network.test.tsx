import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Network } from "../../../src/features/network/Network";
import type { NetworkReads } from "../../../src/features/network/network-data";
import { syntheticResource } from "../../fixtures/published-fixture";
import { syntheticNetwork } from "../../fixtures/network-fixture";
import { resourceNames } from "../../../src/api/read-api";
vi.mock("@mui/x-charts/LineChart", () => ({
  LineChart: () => <div>Graphique</div>,
}));
function services() {
  return {
    status: vi.fn(async () => ({
      state: "current" as const,
      lastCompletedAt: "2026-01-01T00:00:00Z",
      lastAttemptStatus: "succeeded" as const,
    })),
    resources: vi.fn(async () => resourceNames.map(syntheticResource)),
    collect: vi.fn<NetworkReads["collect"]>(async (name, _query, decode) => ({
      items: [decode(syntheticNetwork(name))],
      complete: true,
      reason: null,
      nextCursor: null,
      attempts: 3,
    })),
  };
}
it("shows server partial amounts and independent coverage without hiding zeros", async () => {
  render(<Network reads={services()} />);
  const table = await screen.findByRole("table");
  expect(table).toHaveTextContent("0,3 — partiel ; 1/2");
  expect(table).toHaveTextContent("0 — complet ; 2/2");
  expect(table).toHaveTextContent("Indisponible — partiel ; 0/2");
  expect(screen.getByText(/2 magasins distincts/)).toBeVisible();
});
it("draft changes cause no reads; applying remounts results and never displays old values under new scope", async () => {
  const reads = services();
  render(<Network reads={reads} />);
  await screen.findByRole("table");
  await userEvent.click(
    screen.getByRole("combobox", { name: "Lecture réseau" }),
  );
  await userEvent.click(screen.getByRole("option", { name: "Par mois" }));
  expect(reads.collect).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Appliquer" }));
  expect(screen.getByText(/Renseignez deux mois/)).toBeVisible();
  expect(reads.collect).toHaveBeenCalledTimes(1);
});
it("sanitizes unexpected errors and retries explicitly", async () => {
  const reads = services();
  reads.collect.mockRejectedValueOnce(new Error("secret value"));
  render(<Network reads={reads} />);
  await screen.findByText(/Lecture réseau impossible/);
  expect(screen.queryByText(/secret value/)).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Relire les résultats" }),
  );
  expect(await screen.findByRole("table")).toBeVisible();
});
it("aborts and ignores pending work after leaving the protected screen", async () => {
  const reads = services();
  reads.collect.mockImplementation(() => new Promise(() => {}));
  const view = render(<Network reads={reads} />);
  await waitFor(() => expect(reads.collect).toHaveBeenCalled());
  const signal = reads.collect.mock.calls[0]?.[3]?.signal;
  view.unmount();
  expect(signal?.aborted).toBe(true);
});
