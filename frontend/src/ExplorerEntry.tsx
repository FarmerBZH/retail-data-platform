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

const Sales = lazy(() =>
  import("./ProductSales").then((module) => ({ default: module.ProductSales })),
);
export function ProductSalesEntry(
  props: ComponentProps<typeof import("./ProductSales").ProductSales>,
) {
  return (
    <Suspense
      fallback={
        <Typography role="status">Chargement des ventes produit…</Typography>
      }
    >
      <Sales {...props} />
    </Suspense>
  );
}

const PresenceView = lazy(() =>
  import("./Presence").then((module) => ({ default: module.Presence })),
);
export function PresenceEntry(
  props: ComponentProps<typeof import("./Presence").Presence>,
) {
  return (
    <Suspense
      fallback={
        <Typography role="status">
          Chargement de la présence et du linéaire…
        </Typography>
      }
    >
      <PresenceView {...props} />
    </Suspense>
  );
}

const ActivityView = lazy(() =>
  import("./Activity").then((module) => ({ default: module.Activity })),
);
export function ActivityEntry(
  props: ComponentProps<typeof import("./Activity").Activity>,
) {
  return (
    <Suspense
      fallback={
        <Typography role="status">
          Chargement de l’activité commerciale…
        </Typography>
      }
    >
      <ActivityView {...props} />
    </Suspense>
  );
}

const TypologiesView = lazy(() =>
  import("./Typologies").then((module) => ({ default: module.Typologies })),
);
export function TypologiesEntry(
  props: ComponentProps<typeof import("./Typologies").Typologies>,
) {
  return (
    <Suspense
      fallback={
        <Typography role="status">
          Chargement des typologies et assortiments…
        </Typography>
      }
    >
      <TypologiesView {...props} />
    </Suspense>
  );
}
