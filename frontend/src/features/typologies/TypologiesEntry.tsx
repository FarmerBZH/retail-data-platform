import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import { Typography } from "@mui/material";

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
