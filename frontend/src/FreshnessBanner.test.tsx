import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { FreshnessBanner } from "./FreshnessBanner";
import type { Freshness } from "./read-api";

const current: Freshness = {
  state: "current",
  lastCompletedAt: "2026-01-01T12:30:00Z",
  lastAttemptStatus: "succeeded",
};
it.each(["current", "stale", "uninitialized"] as const)(
  "distinguishes %s publication from coverage",
  async (state) => {
    const reads = {
      status: vi.fn(async () => ({
        ...current,
        state,
        lastCompletedAt:
          state === "uninitialized" ? null : current.lastCompletedAt,
      })),
    };
    render(<FreshnessBanner reads={reads} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      state === "current"
        ? "Publication à jour"
        : state === "stale"
          ? "Publication ancienne"
          : "Aucune publication analytique initialisée",
    );
    expect(screen.getByText(/ne mesure pas la couverture/)).toBeVisible();
    expect(reads.status).toHaveBeenCalledWith(
      expect.objectContaining({ refresh: true }),
    );
  },
);
it("keeps the previous publication visible after a failed server refresh", async () => {
  render(
    <FreshnessBanner
      reads={{
        status: async () => ({ ...current, lastAttemptStatus: "failed" }),
      }}
    />,
  );
  expect(
    await screen.findByText(/La dernière mise à jour analytique a échoué/),
  ).toHaveTextContent("La publication précédente reste consultable");
  expect(screen.getByText(/Dernière publication réussie/)).toHaveTextContent(
    "01/01/2026 12:30:00 UTC",
  );
});
it("keeps a qualified last known status after a failed check and permits recovery", async () => {
  const status = vi
    .fn()
    .mockResolvedValueOnce(current)
    .mockRejectedValueOnce(new Error("synthetic-hidden"))
    .mockResolvedValueOnce({ ...current, state: "stale" });
  render(<FreshnessBanner reads={{ status }} />);
  await screen.findByText(/Publication à jour/);
  await userEvent.click(
    screen.getByRole("button", { name: "Vérifier la fraîcheur" }),
  );
  expect(
    await screen.findByText(/La fraîcheur n’a pas pu être vérifiée/),
  ).toHaveTextContent("dernier état connu");
  expect(screen.getByText(/Dernière publication réussie/)).toBeVisible();
  expect(screen.queryByText("synthetic-hidden")).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Vérifier la fraîcheur" }),
  );
  expect(await screen.findByText(/Publication ancienne/)).toBeVisible();
  expect(screen.queryByText(/n’a pas pu être vérifiée/)).toBeNull();
});
it("cancels a status check on departure and ignores a late result", async () => {
  let finish: (value: Freshness) => void = () => {};
  const status = vi.fn(
    async () =>
      new Promise<Freshness>((resolve) => {
        finish = resolve;
      }),
  );
  const { unmount } = render(<FreshnessBanner reads={{ status }} />);
  await waitFor(() => expect(status).toHaveBeenCalledOnce());
  const signal = (
    status.mock.calls[0] as unknown as [{ signal: AbortSignal }]
  )[0].signal;
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => finish(current));
  expect(screen.queryByText(/Publication à jour/)).toBeNull();
});

it("does not claim that an uninitialized publication is readable after failure", async () => {
  render(
    <FreshnessBanner
      reads={{
        status: async () => ({
          ...current,
          state: "uninitialized",
          lastAttemptStatus: "failed",
        }),
      }}
    />,
  );
  expect(
    await screen.findByText(/La dernière mise à jour analytique a échoué/),
  ).toHaveTextContent(
    "Aucune publication analytique consultable n’est confirmée",
  );
  expect(
    screen.queryByText(/publication précédente reste consultable/),
  ).toBeNull();
});
