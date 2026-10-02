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
