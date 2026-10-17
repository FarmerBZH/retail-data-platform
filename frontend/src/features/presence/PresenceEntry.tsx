import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import { Typography } from "@mui/material";

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
