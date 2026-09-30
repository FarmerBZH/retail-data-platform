import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { readConfiguration } from "./config";
import { ErrorBoundary } from "./ErrorBoundary";
import { LoadingScreen } from "./LoadingScreen";
import { theme } from "./theme";

const App = lazy(() => import("./App"));
const configuration = readConfiguration(import.meta.env.VITE_API_BASE_URL);
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
          <App configuration={configuration} />
        </Suspense>
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
);
