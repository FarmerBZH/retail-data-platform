import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import { Typography } from "@mui/material";

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
