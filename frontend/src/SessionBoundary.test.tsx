import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Session } from "./session";
import { SessionBoundary } from "./SessionBoundary";
import { SignIn } from "./SignIn";
import { Authentication } from "./authentication";
import { bindBrowserSession } from "./browser-session";

const settings = {
  issuer: "https://identity.example.test",
  clientId: "synthetic-web",
  redirectUri: "https://app.example.test/oidc/callback",
};
function accept(session: Session) {
  session.accept(session.begin(), {
    accessToken: "synthetic-token",
    expiresAt: Date.now() + 1000,
  });
}
function ProtectedContent() {
  const [value, setValue] = useState("synthetic-default");
  return (
    <button onClick={() => setValue("synthetic-old-filter")}>{value}</button>
  );
}

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});
describe("protected component lifetime", () => {
  it("never mounts without credentials and resets local state for the next session", async () => {
    const session = new Session();
    render(
      <SessionBoundary session={session}>
        <ProtectedContent />
      </SessionBoundary>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    act(() => accept(session));
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("synthetic-old-filter")).toBeVisible();
    act(() => session.end());
    expect(screen.queryByRole("button")).toBeNull();
    act(() => accept(session));
    expect(screen.getByText("synthetic-default")).toBeVisible();
    expect(screen.queryByText("synthetic-old-filter")).toBeNull();
    act(() => session.end());
  });

  it("replaces expired content with an announced reconnection action and restores focus", () => {
    vi.useFakeTimers();
    const auth = new Authentication(settings, sessionStorage, () => {});
    accept(auth.sessions);
    render(<SignIn authentication={auth} invalid={false} />);
    expect(screen.getByText("Connexion vérifiée")).toBeVisible();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByText("Connexion vérifiée")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Session expirée");
    expect(screen.getByRole("button", { name: "Se connecter" })).toHaveFocus();
  });

  it("logout removes content and requires an explicit new login", async () => {
    const auth = new Authentication(settings, sessionStorage, () => {});
    accept(auth.sessions);
    render(<SignIn authentication={auth} invalid={false} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Se déconnecter" }),
    );
    expect(screen.queryByText("Connexion vérifiée")).toBeNull();
    expect(screen.getByText("Session terminée")).toBeVisible();
    expect(auth.session).toBeUndefined();
    expect(screen.getByRole("button", { name: "Se connecter" })).toHaveFocus();
  });

  it("offers cancellation while an authentication exchange is pending", async () => {
    const auth = new Authentication(settings, sessionStorage, () => {});
    const operation = auth.sessions.begin();
    render(<SignIn authentication={auth} invalid={false} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Annuler la connexion" }),
    );
    expect(operation.signal.aborted).toBe(true);
    expect(screen.getByText("Session terminée")).toBeVisible();
    expect(screen.getByRole("button", { name: "Se connecter" })).toBeEnabled();
  });

  it("clears authority before page caching and on persisted restoration", () => {
    const auth = new Authentication(settings, sessionStorage, () => {});
    accept(auth.sessions);
    render(
      <>
        <SignIn authentication={auth} invalid={false} />
        <SessionBoundary session={auth.sessions}>
          <ProtectedContent />
        </SessionBoundary>
      </>,
    );
    const cleanup = bindBrowserSession(auth, window);
    act(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pagehide", { persisted: true }),
      ),
    );
    expect(screen.queryByText("synthetic-default")).toBeNull();
    expect(auth.session).toBeUndefined();
    act(() => accept(auth.sessions));
    act(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      ),
    );
    expect(screen.queryByText("Connexion vérifiée")).toBeNull();
    cleanup();
  });

  it.each(["focus", "visibilitychange", "pageshow"])(
    "checks expiry on %s even when the timer was suspended",
    (event) => {
      vi.useFakeTimers();
      const auth = new Authentication(settings, sessionStorage, () => {});
      accept(auth.sessions);
      render(<SignIn authentication={auth} invalid={false} />);
      const cleanup = bindBrowserSession(auth, window);
      vi.setSystemTime(Date.now() + 2000);
      act(() => {
        if (event === "visibilitychange")
          document.dispatchEvent(new Event(event));
        else window.dispatchEvent(new PageTransitionEvent(event));
      });
      expect(screen.getByText("Session expirée")).toBeVisible();
      expect(auth.session).toBeUndefined();
      cleanup();
    },
  );
});
