import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { Activity } from "./Activity";
import type { ActivityReads } from "./Activity";
import { ApiError } from "./read-api";
import {
  syntheticActivities,
  syntheticActivity,
  syntheticActivityObservation,
  activityObservationIds,
} from "../test/activity-fixture";
import { syntheticId, syntheticResource } from "../test/published-fixture";
import { syntheticMonth } from "../test/monthly-fixture";
vi.mock("@mui/x-charts/LineChart", () => ({
  LineChart: vi.fn(() => (
    <div role="img" aria-label="Courbe vérifiée dans Chromium" />
  )),
}));
const period = { from: "2026-01", to: "2026-03", months: 3 };
const freshness = {
  state: "current",
  lastCompletedAt: "2026-01-01T00:00:00Z",
  lastAttemptStatus: "succeeded",
};
function services() {
  return {
    resources: vi.fn(async () => [
      syntheticResource("analytics_activity_month"),
      syntheticResource("store_activity_metrics"),
      syntheticResource("analytics_store_month"),
    ]),
    status: vi.fn(async () => freshness),
    collect: vi.fn<ActivityReads["collect"]>(async (name, _query, decode) => ({
      items: (name === "analytics_activity_month"
        ? syntheticActivities()
        : [
            syntheticMonth(),
            syntheticMonth({ period: "2026-03-01", revenue: "-0.2" }),
          ]
      ).map(decode),
      complete: true,
      reason: null,
      nextCursor: null,
      attempts: 1,
    })) as Mock<ActivityReads["collect"]> & ActivityReads["collect"],
    page: vi.fn<ActivityReads["page"]>(async (_name, _query, decode) => ({
      items: [syntheticActivityObservation()].map(decode),
      nextCursor: null,
      limit: 2,
    })),
  };
}
const view = (reads = services()) =>
  render(<Activity storeId={syntheticId} period={period} reads={reads} />);
const activityTable = () =>
  screen.findByRole("region", { name: "Activités mensuelles exactes" });
it("loads bounded store/month activity and independent sales, distinguishing zero, missing and ambiguity", async () => {
  const reads = services();
  view(reads);
  const region = await activityTable();
  expect(region).toHaveTextContent("Type absent de la publication");
  expect(region).toHaveTextContent("Ambiguïté");
  expect(within(region).getAllByRole("row")).toHaveLength(10);
  expect(
    await screen.findByRole("region", {
      name: "Contexte ventes mensuel exact",
    }),
  ).toHaveTextContent("-0,2");
  expect(reads.page).not.toHaveBeenCalled();
  expect(reads.collect).toHaveBeenCalledWith(
    "analytics_activity_month",
    {
      store_id: syntheticId,
      period_from: "2026-01-01",
      period_to: "2026-03-01",
      limit: 100,
    },
    expect.any(Function),
    expect.objectContaining({ maxPages: 5, maxItems: 360 }),
  );
  expect(screen.getAllByRole("img")).toHaveLength(4);
});
it("opens existing cell then one live source only on demand, renders inert text and restores focus", async () => {
  const reads = services();
  view(reads);
  await activityTable();
  const trigger = screen.getByRole("button", {
    name: "Détail activité Appels, 2026-01",
  });
  await userEvent.click(trigger);
  expect(
    screen.getByRole("heading", { name: /Détail activité — Appels/ }),
  ).toHaveFocus();
  expect(reads.page).not.toHaveBeenCalled();
  const proof = screen.getByRole("button", {
    name: `Consulter l’observation ${activityObservationIds[0]}`,
  });
  await userEvent.click(proof);
  expect(
    await screen.findByText("Synthetic <img src=x> activity"),
  ).toBeVisible();
  expect(document.querySelector("img")).toBeNull();
  expect(reads.page).toHaveBeenCalledTimes(1);
  expect(reads.page).toHaveBeenCalledWith(
    "store_activity_metrics",
    { id: activityObservationIds[0], limit: 2 },
    expect.any(Function),
    expect.objectContaining({ refresh: true }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Fermer l’observation activité" }),
  );
  expect(proof).toHaveFocus();
  await userEvent.click(
    screen.getByRole("button", { name: "Fermer le détail activité" }),
  );
  expect(trigger).toHaveFocus();
});
it("retains multiple ambiguous proofs without eager reads or summed activity", async () => {
  const reads = services();
  view(reads);
  await activityTable();
  await userEvent.click(
    screen.getByRole("button", { name: "Détail activité Appels, 2026-03" }),
  );
  expect(
    screen.getAllByRole("button", { name: /Consulter l’observation/ }),
  ).toHaveLength(2);
  expect(reads.page).not.toHaveBeenCalled();
});
it.each(["page-limit", "freshness-changed"] as const)(
  "hides incomplete %s activity while sales remain usable",
  async (reason) => {
    const reads = services();
    const original = reads.collect.getMockImplementation()!;
    let incomplete = true;
    reads.collect.mockImplementation(async (...args) => {
      if (args[0] === "analytics_activity_month" && incomplete) {
        incomplete = false;
        return {
          items: [],
          complete: false,
          reason,
          nextCursor: "synthetic",
          attempts: 5,
        };
      }
      return original(...args);
    });
    view(reads);
    expect(
      await screen.findByText(
        reason === "page-limit" ? /Lecture incomplète/ : /publication a changé/,
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Activités mensuelles exactes" }),
    ).toBeNull();
    expect(
      await screen.findByRole("region", {
        name: "Contexte ventes mensuel exact",
      }),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Relire l’activité" }),
    );
    expect(await activityTable()).toBeVisible();
  },
);
it("contains a sales failure without hiding activity", async () => {
  const reads = services();
  const original = reads.collect.getMockImplementation()!;
  reads.collect.mockImplementation(async (...args) => {
    if (args[0] === "analytics_store_month")
      throw new ApiError("forbidden", 403);
    return original(...args);
  });
  view(reads);
  expect(await activityTable()).toBeVisible();
  expect(await screen.findByText("Accès refusé à ce bloc.")).toBeVisible();
});
it("allows explicit recovery of a refused proof without removing the published cell", async () => {
  const reads = services();
  reads.page.mockRejectedValueOnce(new ApiError("forbidden", 403));
  view(reads);
  await activityTable();
  await userEvent.click(
    screen.getByRole("button", { name: "Détail activité Appels, 2026-01" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: /Consulter l’observation/ }),
  );
  expect(await screen.findByText("Accès refusé à ce bloc.")).toBeVisible();
  expect(await activityTable()).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Relire l’observation activité" }),
  );
  expect(
    await screen.findByText("Synthetic <img src=x> activity"),
  ).toBeVisible();
});
it("does not invent an activity when a live source has disappeared", async () => {
  const reads = services();
  reads.page.mockResolvedValueOnce({ items: [], nextCursor: null, limit: 2 });
  view(reads);
  await activityTable();
  await userEvent.click(
    screen.getByRole("button", { name: "Détail activité Appels, 2026-01" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: /Consulter l’observation/ }),
  );
  expect(
    await screen.findByText(/Observation absente ou supprimée/),
  ).toBeVisible();
  expect(await activityTable()).toBeVisible();
});
it("rejects changed live source grain", async () => {
  const reads = services();
  reads.page.mockImplementationOnce(async (_n, _q, decode) => ({
    items: [
      decode(syntheticActivityObservation({ activity_type: "field_visits" })),
    ],
    nextCursor: null,
    limit: 2,
  }));
  view(reads);
  await activityTable();
  await userEvent.click(
    screen.getByRole("button", { name: "Détail activité Appels, 2026-01" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: /Consulter l’observation/ }),
  );
  expect(
    await screen.findByText(/Ce bloc n’a pas pu être chargé/),
  ).toBeVisible();
  expect(screen.queryByText("Synthetic <img src=x> activity")).toBeNull();
});
it("requires catalogue filters before reading activity, leaving sales independent", async () => {
  const reads = services();
  reads.resources.mockResolvedValue([
    { ...syntheticResource("analytics_activity_month"), filters: [] },
    syntheticResource("analytics_store_month"),
  ]);
  view(reads);
  expect(await screen.findByText(/catalogue ne permet pas/)).toBeVisible();
  expect(
    reads.collect.mock.calls.every((c) => c[0] !== "analytics_activity_month"),
  ).toBe(true);
  expect(
    await screen.findByRole("region", {
      name: "Contexte ventes mensuel exact",
    }),
  ).toBeVisible();
});
it("aborts old activity reads when the applied period changes and ignores late results", async () => {
  const reads = services();
  const original = reads.collect.getMockImplementation()!;
  let resolve!: (v: Awaited<ReturnType<ActivityReads["collect"]>>) => void;
  let delayed = true;
  reads.collect.mockImplementation((...args) => {
    if (args[0] === "analytics_activity_month" && delayed) {
      delayed = false;
      return new Promise((done) => {
        resolve = done;
      });
    }
    return original(...args);
  });
  const rendered = view(reads);
  await vi.waitFor(() => expect(reads.collect).toHaveBeenCalledTimes(2));
  const oldCall = reads.collect.mock.calls.find(
    (c) => c[0] === "analytics_activity_month",
  )!;
  const signal = oldCall[3]!.signal!;
  rendered.rerender(
    <Activity
      key="new-scope"
      storeId={syntheticId}
      period={{ from: "2026-04", to: "2026-04", months: 1 }}
      reads={reads}
    />,
  );
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(await original(...oldCall)));
  expect(
    screen.queryByText("janvier 2026 à mars 2026, bornes incluses.", {
      exact: false,
    }),
  ).toBeNull();
});

it("blocks uninitialized analytical reads before any collection request", async () => {
  const reads = services();
  reads.status.mockResolvedValue({ ...freshness, state: "uninitialized" });
  view(reads);
  expect(
    await screen.findAllByText(/Aucune publication analytique initialisée/),
  ).toHaveLength(2);
  expect(reads.collect).not.toHaveBeenCalled();
  expect(screen.queryByRole("table")).toBeNull();
});
it("rejects a changed publication between activity collection and final status", async () => {
  const reads = services(),
    original = reads.collect.getMockImplementation()!;
  let changed = false;
  reads.status.mockImplementation(async () =>
    changed
      ? { ...freshness, lastCompletedAt: "2026-02-01T00:00:00Z" }
      : freshness,
  );
  reads.collect.mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[0] === "analytics_activity_month") changed = true;
    return result;
  });
  view(reads);
  expect(
    (await screen.findAllByText("La publication a changé. Relisez ce bloc."))
      .length,
  ).toBeGreaterThan(0);
  expect(
    screen.queryByRole("region", { name: "Activités mensuelles exactes" }),
  ).toBeNull();
});
it("keeps live proof unavailable when publication becomes uninitialized", async () => {
  const reads = services();
  view(reads);
  await activityTable();
  await userEvent.click(
    screen.getByRole("button", { name: "Détail activité Appels, 2026-01" }),
  );
  reads.status.mockResolvedValue({ ...freshness, state: "uninitialized" });
  await userEvent.click(
    screen.getByRole("button", { name: /Consulter l’observation/ }),
  );
  expect(
    await screen.findByText(/Cette observation ne peut pas être vérifiée/),
  ).toBeVisible();
  expect(reads.page).not.toHaveBeenCalled();
  expect(await activityTable()).toBeVisible();
});
it.each(["multiple", "cursor"])(
  "rejects an ambiguous per-ID response with %s results",
  async (mode) => {
    const reads = services();
    reads.page.mockImplementationOnce(async (_name, _query, decode) => ({
      items: (mode === "multiple"
        ? [syntheticActivityObservation(), syntheticActivityObservation()]
        : [syntheticActivityObservation()]
      ).map(decode),
      nextCursor: mode === "cursor" ? "synthetic-cursor" : null,
      limit: 2,
    }));
    view(reads);
    await activityTable();
    await userEvent.click(
      screen.getByRole("button", { name: "Détail activité Appels, 2026-01" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Consulter l’observation/ }),
    );
    expect(
      await screen.findByText(/Ce bloc n’a pas pu être chargé/),
    ).toBeVisible();
    expect(screen.queryByText("Synthetic <img src=x> activity")).toBeNull();
  },
);
it("aborts a departed proof and ignores its late result without removing the publication", async () => {
  const reads = services();
  let resolve!: (value: Awaited<ReturnType<ActivityReads["page"]>>) => void;
  reads.page.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  view(reads);
  await activityTable();
  await userEvent.click(
    screen.getByRole("button", { name: "Détail activité Appels, 2026-01" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: /Consulter l’observation/ }),
  );
  await vi.waitFor(() => expect(reads.page).toHaveBeenCalledTimes(1));
  const call = reads.page.mock.calls[0]!;
  await userEvent.click(
    screen.getByRole("button", { name: "Fermer l’observation activité" }),
  );
  expect(call[3]!.signal!.aborted).toBe(true);
  await act(async () =>
    resolve({
      items: [call[2](syntheticActivityObservation())],
      nextCursor: null,
      limit: 2,
    }),
  );
  expect(screen.queryByText("Synthetic <img src=x> activity")).toBeNull();
  expect(await activityTable()).toBeVisible();
});
it("paginates source IDs locally and restores heading focus when the proof trigger leaves the page", async () => {
  const reads = services(),
    original = reads.collect.getMockImplementation()!;
  const ids = Array.from(
    { length: 51 },
    (_, i) =>
      `00000000-0000-4000-8000-${(i + 2).toString(16).padStart(12, "0")}`,
  );
  reads.collect.mockImplementation(async (...args) => {
    if (args[0] !== "analytics_activity_month") return original(...args);
    return {
      items: [
        args[2](
          syntheticActivity({
            source_row_count: 51,
            ambiguous: true,
            activity_count: null,
            observation_ids: ids,
          }),
        ),
      ],
      complete: true,
      reason: null,
      nextCursor: null,
      attempts: 1,
    };
  });
  view(reads);
  await activityTable();
  await userEvent.click(
    screen.getByRole("button", { name: "Détail activité Appels, 2026-01" }),
  );
  expect(
    screen.getAllByRole("button", { name: /Consulter l’observation/ }),
  ).toHaveLength(50);
  await userEvent.click(
    screen.getAllByRole("button", { name: /Consulter l’observation/ })[0]!,
  );
  await screen.findByText("Synthetic <img src=x> activity");
  await userEvent.click(
    screen.getByRole("button", { name: "Observations suivantes" }),
  );
  expect(
    screen.getAllByRole("button", { name: /Consulter l’observation/ }),
  ).toHaveLength(1);
  await userEvent.click(
    screen.getByRole("button", { name: "Fermer l’observation activité" }),
  );
  expect(
    screen.getByRole("heading", { name: /Détail activité — Appels/ }),
  ).toHaveFocus();
  expect(reads.page).toHaveBeenCalledTimes(1);
  expect(reads.collect).toHaveBeenCalledTimes(2);
});
