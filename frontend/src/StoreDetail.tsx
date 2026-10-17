import { DataExplorerEntry as DataExplorer } from "./ExplorerEntry";
import { PublishedDetail } from "./PublishedDetail";
import { publishedContract } from "./published-contract";
import type { Resource } from "./read-api";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import type { StoreHeader } from "./api-validation";
import type { ReadQueries } from "./read-queries";
import { formatMonth } from "./exact-values";
import { MonthlySales } from "./MonthlySales";
import {
  ProductSalesEntry as ProductSales,
  PresenceEntry as Presence,
  ActivityEntry as Activity,
  TypologiesEntry as Typologies,
} from "./ExplorerEntry";
import { SalesComparisons } from "./SalesComparisons";
import { ApiError } from "./read-api";
import { MAX_PERIOD_MONTHS, validatePeriod } from "./month-period";
import type { StoreContext } from "./month-period";
import { storeReference } from "./store-reference";
import type { StoreReference } from "./store-reference";

type ReferenceState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; data: StoreReference };
const shown = (value: string | null) =>
  value === null ? "Indisponible" : value === "" ? "Texte vide" : value;
const tabNames = [
  "Synthèse",
  "Ventes et produits",
  "Présence et linéaire",
  "Activité",
  "Typologies et assortiments",
  "Données détaillées",
];

export function StoreDetail({
  store,
  reads,
  context,
  onContext,
}: {
  store: StoreHeader;
  reads: Pick<ReadQueries, "page" | "status" | "collect"> &
    Partial<Pick<ReadQueries, "resources">>;
  context: StoreContext;
  onContext: (context: StoreContext) => void;
}) {
  const explorerReads = useMemo(
    () =>
      reads.resources
        ? {
            resources: reads.resources.bind(reads),
            page: reads.page.bind(reads),
            status: reads.status.bind(reads),
            collect: reads.collect.bind(reads),
          }
        : undefined,
    [reads],
  );
  const [showCollections, setShowCollections] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [reference, setReference] = useState<ReferenceState>({
    phase: "loading",
  });
  const [validationError, setValidationError] = useState<string>();
  const active = expanded && context.tab === 5;
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void reads
      .page("stores", { id: store.id, limit: 1 }, storeReference, {
        signal: controller.signal,
        refresh: true,
      })
      .then((page) => {
        if (controller.signal.aborted) return;
        const data = page.items[0];
        if (!data) throw new Error("missing");
        if (
          page.items.length !== 1 ||
          page.nextCursor !== null ||
          data.id !== store.id
        )
          throw new ApiError("invalid-response");
        setReference({ phase: "ready", data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setReference({
          phase: "error",
          message:
            error instanceof ApiError && error.code === "forbidden"
              ? "Vous n’avez pas accès au référentiel."
              : "Le référentiel n’a pas pu être chargé. Réessayez.",
        });
      });
    return () => controller.abort();
  }, [active, reads, store.id, revision]);
  const applied = context.applied;
  const changed = context.from !== applied?.from || context.to !== applied?.to;
  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={1}>
          <Typography variant="h2">
            {store.name ?? "Nom indisponible"}
          </Typography>
          <Typography>
            Enseigne actuelle : {shown(store.retailerName)}
          </Typography>
          <Typography>Région actuelle : {shown(store.regionName)}</Typography>
          <Typography>Format actuel : {shown(store.storeFormat)}</Typography>
          <Typography>Ville actuelle : {shown(store.city)}</Typography>
          <Typography>
            Statut actuel : {store.isActive ? "Actif" : "Inactif"}
          </Typography>
        </Stack>
      </Paper>
      <Box
        component="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const result = validatePeriod(context.from, context.to);
          if (!result.valid) {
            setValidationError(result.message);
            return;
          }
          setValidationError(undefined);
          onContext({ ...context, applied: result.period });
        }}
      >
        <Stack spacing={2}>
          <Typography variant="h2">Période mensuelle</Typography>
          <Typography id="month-help">
            Mois de début et de fin inclus. Au maximum {MAX_PERIOD_MONTHS} mois.
            La disponibilité des mois n’est pas connue.
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Mois de début"
              type="month"
              value={context.from}
              onChange={(event) => {
                setValidationError(undefined);
                onContext({ ...context, from: event.target.value });
              }}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: {
                  min: "0001-01",
                  max: "9999-12",
                  "aria-describedby": "month-help",
                },
              }}
            />
            <TextField
              label="Mois de fin"
              type="month"
              value={context.to}
              onChange={(event) => {
                setValidationError(undefined);
                onContext({ ...context, to: event.target.value });
              }}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: {
                  min: "0001-01",
                  max: "9999-12",
                  "aria-describedby": "month-help",
                },
              }}
            />
            <Button type="submit" variant="contained">
              Appliquer
            </Button>
          </Stack>
          {validationError && <Alert severity="error">{validationError}</Alert>}
          <Typography role="status">
            {applied
              ? `Période appliquée : ${formatMonth(applied.from)} à ${formatMonth(applied.to)}, bornes incluses (${applied.months} mois).`
              : "Aucune période appliquée. Choisissez explicitement deux mois."}
          </Typography>
          {changed && applied && (
            <Typography>
              Modifications non appliquées : les résultats restent liés à la
              période appliquée.
            </Typography>
          )}
        </Stack>
      </Box>
      <Tabs
        value={context.tab}
        onChange={(_event, tab: number) => {
          setExpanded(false);
          setShowCollections(false);
          setReference({ phase: "loading" });
          onContext({ ...context, tab });
        }}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        aria-label="Onglets du magasin"
        sx={{ maxWidth: "100%" }}
      >
        {tabNames.map((name, index) => (
          <Tab
            key={name}
            label={name}
            disabled={
              index !== 0 &&
              index !== 1 &&
              index !== 2 &&
              index !== 3 &&
              index !== 4 &&
              index !== 5
            }
            id={`store-tab-${index}`}
            aria-controls={`store-panel-${index}`}
          />
        ))}
      </Tabs>
      <Box
        role="tabpanel"
        tabIndex={0}
        id={`store-panel-${context.tab}`}
        aria-labelledby={`store-tab-${context.tab}`}
      >
        {context.tab === 0 ? (
          applied ? (
            <Stack spacing={3}>
              <MonthlySales
                key={`${store.id}:${applied.from}:${applied.to}`}
                storeId={store.id}
                period={applied}
                reads={reads}
              />
              <SalesComparisons
                key={`comparisons:${store.id}:${applied.from}:${applied.to}`}
                storeId={store.id}
                period={applied}
                reads={reads}
              />
            </Stack>
          ) : (
            <Alert severity="info">
              Appliquez deux mois pour consulter la synthèse. La période choisie
              ne garantit pas la présence de données.
            </Alert>
          )
        ) : context.tab === 1 ? (
          applied && explorerReads ? (
            <ProductSales
              key={`products:${store.id}:${applied.from}:${applied.to}`}
              storeId={store.id}
              period={applied}
              reads={explorerReads}
            />
          ) : (
            <Alert severity="info">
              Appliquez deux mois pour consulter les ventes produit ; le
              catalogue doit permettre cette lecture.
            </Alert>
          )
        ) : context.tab === 2 ? (
          applied && explorerReads ? (
            <Presence
              key={`presence:${store.id}:${applied.from}:${applied.to}`}
              storeId={store.id}
              period={applied}
              reads={explorerReads}
            />
          ) : (
            <Alert severity="info">
              Appliquez deux mois pour consulter la présence et le linéaire ; le
              catalogue doit permettre cette lecture.
            </Alert>
          )
        ) : context.tab === 3 ? (
          applied && explorerReads ? (
            <Activity
              key={`activity:${store.id}:${applied.from}:${applied.to}`}
              storeId={store.id}
              period={applied}
              reads={explorerReads}
            />
          ) : (
            <Alert severity="info">
              Appliquez deux mois pour consulter l’activité ; le catalogue doit
              permettre cette lecture.
            </Alert>
          )
        ) : context.tab === 4 ? (
          applied && explorerReads ? (
            <Typologies
              key={`typologies:${store.id}:${applied.from}:${applied.to}`}
              storeId={store.id}
              period={applied}
              reads={explorerReads}
            />
          ) : (
            <Alert severity="info">
              Appliquez deux mois pour consulter les typologies et assortiments
              ; le catalogue doit permettre cette lecture.
            </Alert>
          )
        ) : (
          <Stack spacing={2}>
            {explorerReads && (
              <>
                <Button
                  aria-expanded={showCollections}
                  onClick={() => setShowCollections((value) => !value)}
                >
                  Autres collections publiées
                </Button>
                {showCollections && (
                  <DataExplorer reads={explorerReads} storeId={store.id} />
                )}
              </>
            )}
            <Typography>
              Référentiel actuel, indépendant de la période appliquée. Les
              personnes et identifiants ci-dessous appartiennent au référentiel,
              pas à la session de connexion.
            </Typography>
            <Button
              variant="outlined"
              aria-expanded={expanded}
              aria-controls="store-reference"
              onClick={() => {
                setExpanded((previous) => !previous);
                setReference({ phase: "loading" });
              }}
            >
              Référentiel complet
            </Button>
            {expanded && (
              <Box id="store-reference">
                {reference.phase === "loading" && (
                  <Typography role="status" aria-busy="true">
                    Chargement du référentiel…
                  </Typography>
                )}
                {reference.phase === "error" && (
                  <Alert
                    severity="error"
                    action={
                      <Button
                        color="inherit"
                        onClick={() => {
                          setReference({ phase: "loading" });
                          setRevision((n) => n + 1);
                        }}
                      >
                        Réessayer
                      </Button>
                    }
                  >
                    {reference.message}
                  </Alert>
                )}
                {reference.phase === "ready" && (
                  <>
                    <Typography>
                      Les chiffres déclaratifs en millions sont distincts du CA
                      mensuel observé. Devise et HT/TTC non confirmés. Les
                      horodatages techniques ne prouvent pas la période métier.
                    </Typography>
                    <PublishedDetail
                      resource={storeResource}
                      row={reference.data}
                    />
                  </>
                )}
              </Box>
            )}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}

const storeResource: Resource = {
  name: "stores",
  path: "/v1/data/stores",
  keys: publishedContract.stores.keys,
  filters: publishedContract.stores.filters,
  columns: Object.keys(publishedContract.stores.fields),
};
