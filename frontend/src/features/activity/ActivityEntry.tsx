import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import { Typography } from "@mui/material";

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
