import { useEffect, useState } from "react";
import { Alert, Button, Stack, Typography } from "@mui/material";
import type { Freshness } from "./read-api";
import type { ReadQueries } from "./read-queries";
import { formatPublicationTime } from "./exact-values";

export function FreshnessBanner({
  reads,
}: {
  reads: Pick<ReadQueries, "status">;
}) {
  const [value, setValue] = useState<Freshness>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void reads
      .status({ signal: controller.signal, refresh: true })
      .then((result) => {
        if (!controller.signal.aborted) {
          setValue(result);
          setLoading(false);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setFailed(true);
        }
      });
    return () => controller.abort();
  }, [reads, revision]);
  return (
    <Stack spacing={1} sx={{ mb: 3 }}>
      <Typography variant="h2">
        Fraîcheur de la publication analytique
      </Typography>
      {loading && (
        <Typography role="status" aria-busy="true">
          Vérification de la fraîcheur…
        </Typography>
      )}
      {failed && (
        <Alert severity="warning">
          La fraîcheur n’a pas pu être vérifiée.{" "}
          {value
            ? "Le dernier état connu reste affiché ; il ne confirme pas l’état actuel."
            : "État de publication indisponible."}
        </Alert>
      )}
      {value && (
        <Alert severity={value.state === "current" ? "info" : "warning"}>
          {value.state === "current"
            ? "Publication à jour lors du dernier contrôle."
            : value.state === "stale"
              ? "Publication ancienne : les sources ont changé depuis sa mise à jour."
              : "Aucune publication analytique initialisée. Les indicateurs mensuels sont indisponibles."}
          {value.lastCompletedAt && (
            <Typography>
              Dernière publication réussie :{" "}
              {formatPublicationTime(value.lastCompletedAt)}.
            </Typography>
          )}
          {value.lastAttemptStatus === "failed" && (
            <Typography>
              La dernière mise à jour analytique a échoué.{" "}
              {value.lastCompletedAt && value.state !== "uninitialized"
                ? "La publication précédente reste consultable."
                : "Aucune publication analytique consultable n’est confirmée."}
            </Typography>
          )}
          {value.lastAttemptStatus === "running" && (
            <Typography>Une mise à jour analytique est en cours.</Typography>
          )}
        </Alert>
      )}
      <Typography variant="body2">
        La fraîcheur ne mesure pas la couverture des magasins ou des mois. Les
        pages ne constituent pas un instantané garanti. Le référentiel vivant
        est indépendant de cette publication.
      </Typography>
      <Button
        variant="outlined"
        disabled={loading}
        sx={{ alignSelf: "flex-start" }}
        onClick={() => {
          setLoading(true);
          setFailed(false);
          setRevision((n) => n + 1);
        }}
      >
        Vérifier la fraîcheur
      </Button>
    </Stack>
  );
}
