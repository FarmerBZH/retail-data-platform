import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoreList } from "./Stores";
import { ReadQueries } from "./read-queries";
import { Session } from "./session";
import { SessionBoundary } from "./SessionBoundary";

const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const first = {
  id,
  name: "Magasin synthétique A",
  retailer_name: null,
  city: null,
  is_active: false,
};
const second = {
  ...first,
  id: other,
  name: "Magasin synthétique B",
  is_active: true,
};
const body = (items: unknown[], next_cursor: string | null = null) =>
  new Response(JSON.stringify({ items, next_cursor }), {
    headers: { "content-type": "application/json" },
  });
const services: { reads: ReadQueries; session: Session }[] = [];
function setup(request: typeof fetch) {
  const session = new Session();
  session.accept(session.begin(), {
    accessToken: "synthetic-token",
    expiresAt: Date.now() + 3600_000,
  });
  const reads = new ReadQueries("https://api.example.test", session, request);
  services.push({ reads, session });
  render(
    <SessionBoundary session={session}>
      <StoreList reads={reads} />
    </SessionBoundary>,
  );
  return { session };
}
afterEach(() => {
  services.splice(0).forEach(({ reads, session }) => {
    reads.dispose();
    session.end();
  });
});

describe("store navigation", () => {
  it("rejects an empty cursor instead of repeating the first page", async () => {
    setup(async () => body([first], ""));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ne peut pas être utilisée",
    );
    expect(screen.queryByText(first.name)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Page suivante" }),
    ).toBeDisabled();
  });

  it("allows returning during a slow page read and ignores its late result", async () => {
    let finish: (response: Response) => void = () => {};
    const request = vi.fn<typeof fetch>(async (input) => {
      if (new URL(String(input)).searchParams.has("after"))
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return body([first], "synthetic-next");
    });
    setup(request);
    await screen.findByRole("button", { name: first.name });
    await userEvent.click(
      screen.getByRole("button", { name: "Page suivante" }),
    );
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(first.name)).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Page précédente" }),
    );
    await screen.findByRole("button", { name: first.name });
    await act(async () => finish(body([second])));
    expect(screen.queryByText(second.name)).toBeNull();
  });

  it("keeps the previous page reachable after a page failure", async () => {
    setup(async (input) => {
      if (new URL(String(input)).searchParams.has("after"))
        throw new Error("Synthetic failure");
      return body([first], "synthetic-next");
    });
    await screen.findByRole("button", { name: first.name });
    await userEvent.click(
      screen.getByRole("button", { name: "Page suivante" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Réessayez");
    await userEvent.click(
      screen.getByRole("button", { name: "Page précédente" }),
    );
    expect(
      await screen.findByRole("button", { name: first.name }),
    ).toBeVisible();
  });

  it("keeps selection, page and local sorting through detail and back without aggregation", async () => {
    const request = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v1/data/stores");
      if (url.searchParams.has("id")) return body([second]);
      return url.searchParams.has("after")
        ? body([second])
        : body([first], "synthetic-next");
    });
    setup(request);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("checkbox", {
        name: `Sélectionner ${first.name}`,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Page suivante" }));
    await user.click(
      await screen.findByRole("checkbox", {
        name: `Sélectionner ${second.name}`,
      }),
    );
    expect(screen.getByText("2 magasins sélectionnés")).toBeVisible();
    await user.click(
      screen.getByRole("combobox", { name: "Trier cette page" }),
    );
    await user.click(screen.getByRole("option", { name: "Nom décroissant" }));
    await user.click(screen.getByRole("button", { name: second.name }));
    expect(
      await screen.findByRole("heading", { level: 2, name: second.name }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Retour aux magasins" }),
    );
    expect(
      await screen.findByRole("checkbox", {
        name: `Sélectionner ${second.name}`,
      }),
    ).toBeChecked();
    expect(screen.getByRole("combobox")).toHaveTextContent("Nom décroissant");
    expect(screen.getByRole("button", { name: second.name })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Page précédente" }));
    expect(
      await screen.findByRole("checkbox", {
        name: `Sélectionner ${first.name}`,
      }),
    ).toBeChecked();
    expect(screen.getByText("Inactif")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Vider la sélection" }),
    );
    expect(screen.getByText("0 magasin sélectionné")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Comparer la sélection" }),
    ).toBeDisabled();
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("announces a disappeared ID rather than reusing the listed store", async () => {
    setup(async (input) =>
      body(new URL(String(input)).searchParams.has("id") ? [] : [first]),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: first.name }),
    );
    expect(
      await screen.findByText(/Ce magasin n’est plus disponible/),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { level: 2, name: first.name }),
    ).toBeNull();
  });

  it("refuses a detail response for another ID", async () => {
    setup(async (input) =>
      body([new URL(String(input)).searchParams.has("id") ? second : first]),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: first.name }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ne peut pas être utilisée",
    );
    expect(screen.queryByText(second.name)).toBeNull();
  });

  it("allows a manual recovery after a network error without exposing diagnostics", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("synthetic-hidden-diagnostic"))
      .mockResolvedValueOnce(body([first]));
    setup(request);
    expect(await screen.findByRole("alert")).toHaveTextContent("Réessayez");
    expect(document.body).not.toHaveTextContent("synthetic-hidden-diagnostic");
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(
      await screen.findByRole("button", { name: first.name }),
    ).toBeVisible();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("ignores a late detail response after returning to the list", async () => {
    let finish: (response: Response) => void = () => {};
    const request = vi.fn<typeof fetch>(async (input) => {
      if (new URL(String(input)).searchParams.has("id"))
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return body([first]);
    });
    setup(request);
    await userEvent.click(
      await screen.findByRole("button", { name: first.name }),
    );
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await userEvent.click(
      screen.getByRole("button", { name: "Retour aux magasins" }),
    );
    await screen.findByRole("button", { name: first.name });
    await act(async () =>
      finish(body([{ ...first, name: "Late synthetic name" }])),
    );
    expect(screen.queryByText("Late synthetic name")).toBeNull();
  });

  it("removes rows and selection at logout and starts the next session empty", async () => {
    const { session } = setup(async () => body([first]));
    await userEvent.click(
      await screen.findByRole("checkbox", {
        name: `Sélectionner ${first.name}`,
      }),
    );
    act(() => session.end());
    expect(screen.queryByText(first.name)).toBeNull();
    act(() =>
      session.accept(session.begin(), {
        accessToken: "synthetic-new",
        expiresAt: Date.now() + 3600_000,
      }),
    );
    await screen.findByRole("button", { name: first.name });
    expect(screen.getByText("0 magasin sélectionné")).toBeVisible();
  });

  it("rejects a repeated pagination cursor", async () => {
    setup(async (input) =>
      new URL(String(input)).searchParams.has("after")
        ? body([second], "synthetic-next")
        : body([first], "synthetic-next"),
    );
    await screen.findByRole("button", { name: first.name });
    await userEvent.click(
      screen.getByRole("button", { name: "Page suivante" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ne peut pas être utilisée",
    );
    expect(screen.queryByText(second.name)).toBeNull();
  });
});
