import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import { Typography } from "@mui/material";
import type { DataExplorer } from "./DataExplorer";

// Both navigation entries defer explorer code until the user opens it.
const Explorer = lazy(() =>
  import("./DataExplorer").then((module) => ({ default: module.DataExplorer })),
);
export function DataExplorerEntry(props: ComponentProps<typeof DataExplorer>) {
  return (
    <Suspense
      fallback={
        <Typography role="status">Chargement de l’explorateur…</Typography>
      }
    >
      <Explorer {...props} />
    </Suspense>
  );
}

const QualityView = lazy(() =>
  import("./Quality").then((module) => ({ default: module.Quality })),
);
export function QualityEntry(
  props: ComponentProps<typeof import("./Quality").Quality>,
) {
  return (
    <Suspense
      fallback={
        <Typography role="status">Chargement de la qualité…</Typography>
      }
    >
      <QualityView {...props} />
    </Suspense>
  );
}
