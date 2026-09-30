import { CssBaseline, ThemeProvider } from "@mui/material";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";
import { readConfiguration } from "./config";
import { ErrorBoundary } from "./ErrorBoundary";
import { LoadingScreen } from "./LoadingScreen";
import { theme } from "./theme";

describe("unauthenticated shell", () => {
  it("keeps sign-in unavailable and explains access using the keyboard", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App configuration={readConfiguration(undefined)} />
      </ThemeProvider>,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Accès à la plateforme" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Se connecter" })).toBeDisabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.getByText(/configuration du service n’est pas encore renseignée/),
    ).toBeVisible();
    await user.tab();
    const details = screen.getByRole("button", { name: "Comprendre l’accès" });
    expect(details).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Aucun mot de passe/)).toBeVisible();
    await user.keyboard("{Enter}");
    expect(details).toHaveAttribute("aria-expanded", "false");
  });

  it("does not display rejected configuration values", () => {
    render(
      <App
        configuration={readConfiguration(
          "https://api.example.test?secret=synthetic",
        )}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /configuration du service doit être corrigée/,
    );
    expect(document.body).not.toHaveTextContent("synthetic");
  });

  it("does not imply a configured origin enables authentication", () => {
    render(
      <App configuration={readConfiguration("https://api.example.test")} />,
    );
    expect(
      screen.getByText(/connexion personnelle n’est pas encore disponible/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Se connecter" })).toBeDisabled();
  });

  it("announces real loading without a placeholder business value", () => {
    render(<LoadingScreen />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Chargement de la plateforme…",
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  it("replaces a failed render with a generic recovery action", () => {
    function BrokenScreen(): never {
      throw new Error("synthetic-private-diagnostic");
    }
    render(
      <ErrorBoundary>
        <BrokenScreen />
      </ErrorBoundary>,
      { onCaughtError: () => undefined },
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "La plateforme n’a pas pu s’ouvrir",
    );
    expect(document.body).not.toHaveTextContent("synthetic-private-diagnostic");
    expect(
      screen.getByRole("button", { name: "Recharger la page" }),
    ).toBeVisible();
  });
});
