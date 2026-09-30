import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { readConfiguration } from "./config";
import { ErrorBoundary } from "./ErrorBoundary";
import { LoadingScreen } from "./LoadingScreen";
import { theme } from "./theme";
import {
  Authentication,
  captureCallback,
  REDIRECT_KEY,
} from "./authentication";
import { readOidcConfiguration } from "./oidc-config";

const callback = captureCallback(window.location, window.history);
const App = lazy(() => import("./App"));
const configuration = readConfiguration(import.meta.env.VITE_API_BASE_URL);
const oidc = readOidcConfiguration(
  {
    issuer: import.meta.env.VITE_OIDC_ISSUER,
    clientId: import.meta.env.VITE_OIDC_CLIENT_ID,
    redirectUri: import.meta.env.VITE_OIDC_REDIRECT_URI,
  },
  window.location.origin,
);
let authentication: Authentication | undefined;
try {
  if (configuration.status === "configured" && oidc.status === "ready") {
    authentication = new Authentication(
      oidc.settings,
      window.sessionStorage,
      (url) => window.location.assign(url),
    );
  } else {
    window.sessionStorage.removeItem(REDIRECT_KEY);
  }
} catch {
  /* Storage unavailable: sign-in remains disabled, with no fallback. */
}
// One exchange per document, outside React StrictMode's repeated effects.
const completion = callback
  ? (authentication?.complete(callback).then(
      () => true,
      () => false,
    ) ?? Promise.resolve(false))
  : undefined;
const root = document.getElementById("root");
if (!root) throw new Error("Application root unavailable");

createRoot(root, {
  // Never forward exception objects or component props to logs/telemetry.
  onCaughtError: () => undefined,
}).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary>
        <Suspense fallback={<LoadingScreen />}>
          <App
            configuration={configuration}
            authentication={authentication}
            completion={completion}
            oidcInvalid={oidc.status === "invalid"}
          />
        </Suspense>
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
);
