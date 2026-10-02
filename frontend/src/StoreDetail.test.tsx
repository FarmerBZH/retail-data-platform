import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { syntheticStore } from "../test/store-fixture";
import { storeHeader } from "./api-validation";
import { StoreDetail } from "./StoreDetail";
import { initialStoreContext } from "./month-period";
import { ReadQueries } from "./read-queries";
import { Session } from "./session";

const row = syntheticStore({
  region_name: "Région synthétique",
  store_format: "Format synthétique",
  postal_code: "00123",
  annual_turnover_2025_millions: "1234567890.12",
  checkout_count: 0,
});
const body = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
const services: { reads: ReadQueries; session: Session }[] = [];
function setup(
  request = vi.fn<typeof fetch>(async () =>
    body({ items: [row], next_cursor: null }),
  ),
) {
  const session = new Session();
  session.accept(session.begin(), {
    accessToken: "synthetic",
    expiresAt: Date.now() + 3600_000,
  });
  const reads = new ReadQueries("https://api.example.test", session, request);
  services.push({ reads, session });
  function Screen() {
    const [context, setContext] = useState(initialStoreContext);
    return (
      <StoreDetail
        store={storeHeader(row)}
        reads={reads}
        context={context}
        onContext={setContext}
      />
    );
  }
  render(<Screen />);
  return request;
}
afterEach(() =>
  services.splice(0).forEach(({ reads, session }) => {
    reads.dispose();
    session.end();
  }),
);

it("keeps entered and applied periods separate and invents no observation coverage", async () => {
  const request = setup();
  expect(screen.getByText(/Aucune période appliquée/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("Mois de début"), {
    target: { value: "2025-12" },
  });
  fireEvent.change(screen.getByLabelText("Mois de fin"), {
    target: { value: "2026-02" },
  });
  expect(screen.getByText(/Aucune période appliquée/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Appliquer" }));
  expect(
    screen.getByText(/Période appliquée : 2025-12 à 2026-02/),
  ).toHaveTextContent("3 mois");
  fireEvent.change(screen.getByLabelText("Mois de début"), {
    target: { value: "2026-03" },
  });
  await userEvent.click(screen.getByRole("button", { name: "Appliquer" }));
  expect(screen.getByText(/Le mois de début doit précéder/)).toBeVisible();
  expect(
    screen.getByText(/Période appliquée : 2025-12 à 2026-02/),
  ).toBeVisible();
  expect(screen.getByText(/la période choisie ne garantit pas/)).toBeVisible();
  expect(request).not.toHaveBeenCalled();
});

it("reads the full reference only on explicit expansion and renders every published field", async () => {
  const request = setup();
  await userEvent.click(
    screen.getByRole("tab", { name: "Données détaillées" }),
  );
  expect(request).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Référentiel complet" }),
  );
  expect(await screen.findByText("00123")).toBeVisible();
  expect(screen.getByText("1234567890.12")).toBeVisible();
  expect(document.querySelectorAll("dt")).toHaveLength(Object.keys(row).length);
  const url = new URL(String(request.mock.calls[0]![0]));
  expect([...url.searchParams.keys()].sort()).toEqual(["id", "limit"]);
  expect(url.searchParams.get("id")).toBe(row.id);
  expect(screen.getByRole("tabpanel")).toHaveTextContent("0");
});

it("cancels a reference read when leaving its tab and ignores a late response", async () => {
  let finish: (response: Response) => void = () => {};
  const request = vi.fn<typeof fetch>(
    async () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  setup(request);
  await userEvent.click(
    screen.getByRole("tab", { name: "Données détaillées" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Référentiel complet" }),
  );
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  const signal = request.mock.calls[0]![1]?.signal;
  await userEvent.click(screen.getByRole("tab", { name: "Synthèse" }));
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(body({ items: [row], next_cursor: null })));
  expect(screen.queryByText("00123")).toBeNull();
});

it.each(["forbidden", "invalid"])(
  "fails closed on %s reference responses and permits an explicit retry",
  async (failure) => {
    let attempts = 0;
    const request = vi.fn<typeof fetch>(async () => {
      attempts++;
      if (attempts === 1) {
        return failure === "forbidden"
          ? new Response("{}", {
              status: 403,
              headers: { "content-type": "application/json" },
            })
          : body({
              items: [{ ...row, checkout_count: "private-invalid-value" }],
              next_cursor: null,
            });
      }
      return body({ items: [row], next_cursor: null });
    });
    setup(request);
    await userEvent.click(
      screen.getByRole("tab", { name: "Données détaillées" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Référentiel complet" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      failure === "forbidden"
        ? "Vous n’avez pas accès"
        : "n’a pas pu être chargé",
    );
    expect(screen.queryByText("private-invalid-value")).toBeNull();
    expect(screen.queryByText("00123")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("00123")).toBeVisible();
    expect(request).toHaveBeenCalledTimes(2);
  },
);

it.each([
  { items: [], next_cursor: null },
  {
    items: [syntheticStore({ id: "00000000-0000-4000-8000-000000000002" })],
    next_cursor: null,
  },
  { items: [row], next_cursor: "synthetic-next" },
])(
  "does not display reference values from an inconsistent store lookup",
  async (page) => {
    setup(vi.fn<typeof fetch>(async () => body(page)));
    await userEvent.click(
      screen.getByRole("tab", { name: "Données détaillées" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Référentiel complet" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "n’a pas pu être chargé",
    );
    expect(document.querySelectorAll("dt")).toHaveLength(0);
  },
);

it("lets keyboard users enter the synthesis panel from its selected tab", async () => {
  setup();
  screen.getByRole("tab", { name: "Synthèse" }).focus();
  await userEvent.tab();
  expect(screen.getByRole("tabpanel")).toHaveFocus();
});
