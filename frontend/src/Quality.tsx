import { useEffect, useState } from "react";
import { Alert, Button, Stack, Typography } from "@mui/material";
import type { Resource } from "./read-api";
import { CollectionExplorer } from "./DataExplorer";
import type { ExplorerReads } from "./DataExplorer";
import { resourceLabels } from "./published-data";
import { qualityColumns, qualityNames, qualityResources } from "./quality-data";
import { SourceImports } from "./SourceImports";
import type { QualityName } from "./quality-data";

type CatalogState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; resources: readonly Resource[] };
export function Quality({ reads }: { reads: ExplorerReads }) {
  const [selected, setSelected] = useState<QualityName>();
  const [revision, setRevision] = useState(0);
  const [returnTo, setReturnTo] = useState<QualityName>();
  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <Typography variant="h1">Qualité des données</Typography>
      <Alert severity="info">
        Périmètre réseau de l’organisation : la qualité d’attribution n’est pas
        filtrée par magasin et ne reprend pas la sélection de magasins. Les
        nombres comptent des lignes sources, sans montant de CA perdu déduit, ni
        total calculé sur une page. La fraîcheur ne mesure pas la couverture.
      </Alert>
      <Typography>
        Les audits d’import et de publication nécessitent le droit opérations
        accordé par le service. La connexion aux opérations demande ce droit,
        sans le garantir. Seuls les champs publiés sont consultables ; aucun
        fichier, empreinte ou diagnostic privé n’est exposé.
      </Typography>
      {selected && (
        <Button onClick={() => setSelected(undefined)}>
          Retour à la qualité
        </Button>
      )}
      <Catalog
        key={`${selected ?? "menu"}:${revision}`}
        reads={reads}
        selected={selected}
        returnTo={returnTo}
        choose={(name) => {
          setReturnTo(name);
          setSelected(name);
        }}
        retry={() => setRevision((n) => n + 1)}
      />
    </Stack>
  );
}
function Catalog({
  reads,
  selected,
  choose,
  retry,
  returnTo,
}: {
  reads: ExplorerReads;
  selected: QualityName | undefined;
  choose: (name: QualityName) => void;
  returnTo: QualityName | undefined;
  retry: () => void;
}) {
  const [state, setState] = useState<CatalogState>({ phase: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    void reads
      .resources({ signal: controller.signal, refresh: true })
      .then(qualityResources)
      .then((resources) => {
        if (!controller.signal.aborted) setState({ phase: "ready", resources });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ phase: "error" });
      });
    return () => controller.abort();
  }, [reads]);
  useEffect(() => {
    if (state.phase === "ready" && !selected && returnTo)
      document.getElementById(`quality-${returnTo}`)?.focus();
  }, [state.phase, selected, returnTo]);
  if (state.phase === "loading")
    return (
      <Typography role="status">
        Vérification des collections autorisées…
      </Typography>
    );
  if (state.phase === "error")
    return (
      <Alert severity="warning">
        Le catalogue de qualité n’a pas pu être vérifié.{" "}
        <Button onClick={retry}>Réessayer le catalogue</Button>
      </Alert>
    );
  const resource = state.resources.find((r) => r.name === selected);
  if (selected)
    return resource ? (
      <CollectionExplorer
        reads={reads}
        resource={resource}
        summaryColumns={qualityColumns[selected]}
        renderRelated={(row) =>
          selected === "analytics_refresh_runs" ? (
            <SourceImports key={String(row.id)} row={row} reads={reads} />
          ) : null
        }
      />
    ) : (
      <Alert severity="warning">
        Cette collection est indisponible ou non autorisée pour cette session.
        Aucun audit n’est demandé.{" "}
        <Button onClick={retry}>Vérifier les droits</Button>
      </Alert>
    );
  return (
    <Stack spacing={2}>
      <Typography variant="h2">Attribution mensuelle du réseau</Typography>
      {state.resources.some((r) => r.name === qualityNames[0]) ? (
        <Button
          sx={{ alignSelf: "flex-start" }}
          id={`quality-${qualityNames[0]}`}
          onClick={() => choose(qualityNames[0])}
        >
          {resourceLabels[qualityNames[0]]}
        </Button>
      ) : (
        <Typography>
          La qualité d’attribution est indisponible dans le catalogue.
        </Typography>
      )}
      <Typography variant="h2">Opérations</Typography>
      {qualityNames.slice(1).map(
        (name) =>
          state.resources.some((r) => r.name === name) && (
            <Button
              key={name}
              sx={{ alignSelf: "flex-start" }}
              id={`quality-${name}`}
              onClick={() => choose(name)}
            >
              {resourceLabels[name]}
            </Button>
          ),
      )}
      {!state.resources.some((r) => r.name !== qualityNames[0]) && (
        <Typography>
          Les audits sont indisponibles ou non autorisés pour cette session. La
          qualité réseau reste consultable selon le catalogue.
        </Typography>
      )}
      <Button sx={{ alignSelf: "flex-start" }} onClick={retry}>
        Vérifier les collections autorisées
      </Button>
    </Stack>
  );
}
