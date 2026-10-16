import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "./theme";
import { FilteredAnalysis } from "./FilteredAnalysis";
import { initialAnalysisState } from "./analysis-state";
import {
  analysisFixture,
  fixedWindow,
  syntheticId,
  publication,
} from "../test/analysis-fixture";
import { decodeAnalysis } from "./analysis-contract";
import type { AnalysisQuery, AnalysisRoute } from "./analysis-contract";
import { ApiError } from "./read-api";
import type { ReadQueries } from "./read-queries";
function harness(
  options: { empty?: boolean; fail?: boolean; slow?: boolean } = {},
) {
  let conflict = false;
  const pending: (() => void)[] = [];
  const calls: { route: AnalysisRoute; query: AnalysisQuery }[] = [];
  const analysis: ReadQueries["analysis"] = async (
    route,
    query,
    readOptions,
  ) => {
    calls.push({ route, query });
    if (options.slow && route === "summary")
      await new Promise<void>((resolve) => {
        pending.push(resolve);
      });
    if (readOptions?.signal?.aborted && !options.slow)
      throw new ApiError("cancelled");
    if (conflict) throw new ApiError("publication-changed", 409);
    if (options.fail && route === "series")
      throw new ApiError("forbidden", 403);
    return decodeAnalysis(
      route,
      analysisFixture(route, query, options.empty ? 0 : 7),
      query,
    );
  };
  const reads = {
    analysis,
    page: vi.fn(),
    status: vi.fn(),
    collect: vi.fn(),
  } as unknown as ReadQueries;
  function Harness() {
    const [state, setState] = useState(() => ({
      ...initialAnalysisState(),
      from: "2025-02",
      to: "2025-02",
    }));
    return (
      <ThemeProvider theme={theme}>
        <FilteredAnalysis reads={reads} state={state} onState={setState} />
      </ThemeProvider>
    );
  }
  const view = render(<Harness />);
  return {
    calls,
    setConflict: () => {
      conflict = true;
    },
    finish: () => pending.shift()?.(),
    view,
  };
}
it("shows A/B partial and comparable values without summing a page", async () => {
  const user = userEvent.setup();
  const h = harness();
  await screen.findByRole("button", { name: "Appliquer l’analyse" });
  await user.click(
    await screen.findByRole("checkbox", {
      name: "Sélectionner Magasin synthétique 1",
    }),
  );
  await user.click(screen.getByRole("checkbox", { name: /Sélectionner <img/ }));
  await user.click(screen.getByRole("button", { name: "Appliquer l’analyse" }));
  await screen.findByText(/Résultats appliqués/);
  expect(screen.getByText("CA observé — partiel")).toBeVisible();
  expect(screen.getByText(/Somme globale.*20/)).toBeVisible();
  expect(screen.getAllByText(/1 inclus, 1 exclus/).length).toBeGreaterThan(0);
  await user.click(screen.getByRole("switch", { name: /Cohorte comparable/ }));
  expect(screen.getByText("CA observé — cohorte comparable")).toBeVisible();
  expect(h.calls.find((c) => c.route === "summary")?.query).toMatchObject({
    ...fixedWindow,
    scope: "selection",
    store_ids: [syntheticId(1), syntheticId(2)],
    publication_id: publication,
  });
  await user.click(screen.getByRole("tab", { name: "Classement" }));
  await screen.findByRole("region", { name: "Classement filtré exact" });
  expect(screen.queryByRole("img", { name: "x" })).not.toBeInTheDocument();
});
it("retains seven selected stores while paging six comparison series", async () => {
  const user = userEvent.setup();
  harness();
  await screen.findByRole("button", { name: "Appliquer l’analyse" });
  const checks = await screen.findAllByRole("checkbox");
  for (const check of checks) await user.click(check);
  await user.click(screen.getByRole("button", { name: "Appliquer l’analyse" }));
  await screen.findByText(/Résultats appliqués/);
  await user.click(screen.getByRole("tab", { name: "Comparer les magasins" }));
  await screen.findByText(
    /7 magasins dans le total appliqué ; 6 séries visibles/,
  );
  await user.click(screen.getByRole("button", { name: "Séries suivantes" }));
  await screen.findByText(
    /7 magasins dans le total appliqué ; 1 séries visibles/,
  );
  expect(screen.getByText(/7 magasins retenus/)).toBeVisible();
});
it("rejects an empty explicit selection and keeps errors local", async () => {
  const user = userEvent.setup();
  const h = harness({ fail: true });
  await screen.findByRole("button", { name: "Appliquer l’analyse" });
  await user.click(screen.getByRole("combobox", { name: "Périmètre" }));
  await user.click(screen.getByRole("option", { name: "Sélection explicite" }));
  await user.click(screen.getByRole("button", { name: "Appliquer l’analyse" }));
  expect(screen.getByText(/Sélection vide/)).toBeVisible();
  expect(h.calls.some((c) => c.route === "summary")).toBe(false);
  await user.click(
    screen.getByRole("checkbox", {
      name: "Sélectionner Magasin synthétique 1",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Appliquer l’analyse" }));
  await screen.findByText(/Résultats appliqués/);
  await screen.findByText("Accès refusé à ces analyses.");
  expect(screen.getByText(/Somme globale/)).toBeVisible();
});
it("removes every dependent block on 409 without an automatic reload", async () => {
  const user = userEvent.setup();
  const h = harness();
  await screen.findByRole("button", { name: "Appliquer l’analyse" });
  await user.click(screen.getByRole("button", { name: "Appliquer l’analyse" }));
  await screen.findByText(/Résultats appliqués/);
  h.setConflict();
  await user.click(screen.getByRole("tab", { name: "Classement" }));
  await screen.findByText(/La publication a changé/);
  expect(screen.queryByText(/Somme globale/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Résultats appliqués/)).not.toBeInTheDocument();
  const count = h.calls.length;
  await act(() => Promise.resolve());
  expect(h.calls).toHaveLength(count);
});
it("does not display an aborted old response beneath a new context", async () => {
  const user = userEvent.setup();
  const h = harness({ slow: true });
  await screen.findByRole("button", { name: "Appliquer l’analyse" });
  await user.click(screen.getByRole("button", { name: "Appliquer l’analyse" }));
  await waitFor(() =>
    expect(h.calls.some((c) => c.route === "summary")).toBe(true),
  );
  await user.clear(screen.getByLabelText("Début de l’analyse"));
  await user.type(screen.getByLabelText("Début de l’analyse"), "2025-01");
  await user.click(screen.getByRole("button", { name: "Appliquer l’analyse" }));
  await waitFor(() =>
    expect(h.calls.filter((c) => c.route === "summary")).toHaveLength(2),
  );
  await act(async () => {
    h.finish();
    await Promise.resolve();
  });
  expect(
    screen.queryByText(/février 2025 à février 2025/),
  ).not.toBeInTheDocument();
});
it("reapplying the same filters performs a new checked publication read", async () => {
  const user = userEvent.setup();
  const h = harness();
  await screen.findByRole("button", { name: "Appliquer l’analyse" });
  await user.click(screen.getByRole("button", { name: "Appliquer l’analyse" }));
  await screen.findByText(/Résultats appliqués/);
  await user.click(screen.getByRole("button", { name: "Appliquer l’analyse" }));
  await waitFor(() =>
    expect(h.calls.filter((c) => c.route === "summary")).toHaveLength(2),
  );
});
