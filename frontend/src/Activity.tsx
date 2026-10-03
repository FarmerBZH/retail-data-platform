import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { LineChart } from "@mui/x-charts/LineChart";
import { ApiError } from "./read-api";
import type { Freshness, Resource, ResourceName, Query } from "./read-api";
import type {
  Collection,
  ReadOptions,
  ReadPage,
  ReadQueries,
} from "./read-queries";
import type { Decoder } from "./api-validation";
import { availableResources } from "./published-data";
import type { PublishedRow } from "./published-data";
import { PublishedDetail } from "./PublishedDetail";
import {
  formatExact,
  formatMonth,
  formatPublicationTime,
} from "./exact-values";
import { periodQuery } from "./month-period";
import type { MonthPeriod } from "./month-period";
import { monthlySale, monthlyGrid } from "./monthly-sales";
import { productGeometry } from "./product-sales";
import {
  activityTypes,
  activityLabels,
  activityResource,
  activityObservationResource,
  activityRow,
  activityGrid,
  activityObservation,
  verifyActivityObservation,
} from "./activity-data";
import type { ActivityRow } from "./activity-data";

export type ActivityReads = Pick<
  ReadQueries,
  "resources" | "status" | "collect"
> & {
  page: (
    name: ResourceName,
    query: Query,
    decode: Decoder<PublishedRow>,
    options?: ReadOptions,
  ) => Promise<ReadPage<PublishedRow>>;
};
type State<T> =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; value: T };
function useBlock<T>(load: (options: ReadOptions) => Promise<T>) {
  const [state, setState] = useState<State<T>>({ phase: "loading" }),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void load({ signal: controller.signal, refresh: true })
      .then((value) => {
        if (!controller.signal.aborted) setState({ phase: "ready", value });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            phase: "error",
            message:
              error instanceof ApiError && error.code === "forbidden"
                ? "Accès refusé à ce bloc."
                : error instanceof ApiError && error.code === "too-large"
                  ? "Une ligne dépasse la limite de réponse du service."
                  : error instanceof BlockError
                    ? error.message
                    : "Ce bloc n’a pas pu être chargé ou vérifié. Réessayez.",
          });
      });
    return () => controller.abort();
  }, [load, revision]);
  return {
    state,
    retry: () => {
      setState({ phase: "loading" });
      setRevision((n) => n + 1);
    },
  };
}
class BlockError extends Error {}
function supported(
  catalog: readonly Resource[],
  resource: Resource,
  filters: string[],
  columns = resource.columns,
) {
  const r = catalog.find((c) => c.name === resource.name);
  if (
    !r ||
    filters.some((f) => !r.filters.includes(f)) ||
    columns.some((f) => !r.columns.includes(f))
  )
    throw new BlockError("Le catalogue ne permet pas cette consultation.");
}
async function collection<T>(
  reads: ActivityReads,
  name: ResourceName,
  query: Query,
  decode: Decoder<T>,
  options: ReadOptions,
  maxItems: number,
) {
  const before = await reads.status(options);
  if (before.state === "uninitialized")
    throw new BlockError(
      "Aucune publication analytique initialisée. Ce bloc est indisponible.",
    );
  const result: Collection<T> = await reads.collect(name, query, decode, {
    ...options,
    maxPages: 5,
    maxItems,
  });
  if (!result.complete)
    throw new BlockError(
      result.reason === "freshness-changed"
        ? "La publication a changé. Relisez ce bloc."
        : "Lecture incomplète : aucune valeur ni absence ne peut être confirmée. Réduisez la période ou consultez Données.",
    );
  const after = await reads.status(options);
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new BlockError("La publication a changé. Relisez ce bloc.");
  return { items: result.items, freshness: after };
}
function Fresh({ value }: { value: Freshness }) {
  return (
    <Alert
      severity={
        value.state === "stale" || value.lastAttemptStatus === "failed"
          ? "warning"
          : "info"
      }
    >
      {value.state === "stale"
        ? "Publication ancienne."
        : "Publication à jour lors de la lecture."}{" "}
      {value.lastCompletedAt &&
        `Publication réussie : ${formatPublicationTime(value.lastCompletedAt)}.`}{" "}
      {value.lastAttemptStatus === "failed" &&
        "La dernière mise à jour a échoué."}{" "}
      Les lectures ne constituent pas un instantané garanti.
    </Alert>
  );
}
export function Activity({
  storeId,
  period,
  reads,
}: {
  storeId: string;
  period: MonthPeriod;
  reads: ActivityReads;
}) {
  const load = useMemo(
    () => async (options: ReadOptions) => {
      const catalog = availableResources(await reads.resources(options));
      supported(catalog, activityResource, ["store_id", "period"]);
      const result = await collection(
        reads,
        activityResource.name,
        { store_id: storeId, ...periodQuery(period), limit: 100 },
        activityRow,
        options,
        360,
      );
      return {
        grid: activityGrid(result.items, storeId, period),
        catalog,
        freshness: result.freshness,
      };
    },
    [reads, storeId, period],
  );
  const { state, retry } = useBlock(load);
  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <Typography variant="h2">Activité commerciale par type</Typography>
      <Typography>
        {formatMonth(period.from)} à {formatMonth(period.to)}, bornes incluses.
        Appels, visites terrain et visites participatives restent distincts,
        sans addition intertypes. L’alignement avec les ventes ne prouve aucun
        effet causal ni retour sur investissement. Les champs de planification
        du référentiel actuel ne sont pas de l’activité observée.
      </Typography>
      <Stack spacing={2}>
        {state.phase === "loading" && (
          <Typography role="status">Chargement de l’activité…</Typography>
        )}
        {state.phase === "error" && (
          <Alert
            severity="warning"
            action={<Button onClick={retry}>Relire l’activité</Button>}
          >
            {state.message}
          </Alert>
        )}
        {state.phase === "ready" && (
          <>
            <Fresh value={state.value.freshness} />
            <ActivityValues value={state.value} reads={reads} />
            <Button onClick={retry}>Relire l’activité</Button>
          </>
        )}
      </Stack>
      <SalesContext
        key={`sales:${storeId}:${period.from}:${period.to}`}
        storeId={storeId}
        period={period}
        reads={reads}
      />
    </Stack>
  );
}
function CalendarChart({
  months,
  values,
  label,
  unit,
  color,
}: {
  months: string[];
  values: (string | null)[];
  label: string;
  unit: string;
  color: string;
}) {
  const theme = useTheme(),
    small = useMediaQuery(theme.breakpoints.down("sm"));
  const geometry = productGeometry(values),
    covered = values.filter((v) => v !== null).length;
  const id = `activity-chart-${label.replaceAll(" ", "-")}`;
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="h3">
        {label}
        {covered < months.length ? " — série partielle" : ""}
      </Typography>
      <Typography id={id}>
        Couverture : {covered}/{months.length} mois avec valeur. {unit}.
        Calendrier commun, échelles propres à chaque mesure ; trous sans
        interpolation, coordonnées approximatives, valeurs exactes dans le
        tableau.
      </Typography>
      {geometry.some((v) => v !== null) ? (
        <LineChart
          height={small ? 240 : 320}
          skipAnimation
          xAxis={[
            { scaleType: "point", data: months, valueFormatter: formatMonth },
          ]}
          series={[
            {
              id,
              label,
              color,
              data: geometry,
              curve: "linear",
              showMark: true,
              connectNulls: false,
              valueFormatter: (_value, { dataIndex }) =>
                `${formatExact(values[dataIndex] ?? null)} · ${unit} · ${formatMonth(months[dataIndex]!)} · ${values[dataIndex] != null ? 1 : 0}/1 mois`,
            },
          ]}
          aria-label={`${label} mensuels`}
          aria-describedby={id}
        />
      ) : (
        <Typography>
          Aucun point traçable pour {label} ; cela ne signifie pas zéro.
        </Typography>
      )}
      {values.some((v, i) => v !== null && geometry[i] === null) && (
        <Alert severity="warning">
          Certaines valeurs dépassent les capacités du tracé. Consultez le
          tableau exact.
        </Alert>
      )}
    </Box>
  );
}
function ActivityValues({
  value,
  reads,
}: {
  value: {
    grid: ReturnType<typeof activityGrid>;
    catalog: readonly Resource[];
    freshness: Freshness;
  };
  reads: ActivityReads;
}) {
  const [opened, setOpened] = useState<ActivityRow>(),
    trigger = useRef<HTMLButtonElement>(null);
  const theme = useTheme();
  useEffect(() => {
    if (!opened) trigger.current?.focus();
  }, [opened]);
  return (
    <Stack spacing={2}>
      {activityTypes.map((type, i) => (
        <CalendarChart
          key={type}
          months={value.grid.map((c) => c.month)}
          values={value.grid.map((c) =>
            c.rows[type]?.activity_count == null
              ? null
              : String(c.rows[type]!.activity_count),
          )}
          label={activityLabels[type]}
          unit="nombre d’activités déclaré"
          color={[theme.palette.primary.main, "#0F766E", "#7E22CE"][i]!}
        />
      ))}
      <TableContainer
        component={Paper}
        variant="outlined"
        role="region"
        aria-label="Activités mensuelles exactes"
        tabIndex={0}
        sx={{ maxWidth: "100%" }}
      >
        <Table sx={{ minWidth: 720 }}>
          <caption>
            Grain magasin/mois/type ; valeur absente, zéro déclaré et ambiguïté
            distincts. Aucune somme entre types.
          </caption>
          <TableHead>
            <TableRow>
              {[
                "Mois",
                "Type",
                "Activité observée",
                "Sources / ambiguïté",
                "Détail",
              ].map((t) => (
                <TableCell key={t}>{t}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {value.grid.flatMap((c) =>
              activityTypes.map((type) => {
                const row = c.rows[type];
                return (
                  <TableRow key={`${c.month}:${type}`}>
                    <TableCell component="th" scope="row">
                      {formatMonth(c.month)}
                    </TableCell>
                    <TableCell>{activityLabels[type]}</TableCell>
                    <TableCell align="right">
                      {formatExact(
                        row?.activity_count == null
                          ? null
                          : String(row.activity_count),
                      )}
                      <Typography variant="body2">
                        {!row
                          ? "Type absent de la publication"
                          : row.ambiguous
                            ? "Ambiguïté"
                            : row.activity_count === null
                              ? "Valeur indisponible"
                              : "Valeur publiée"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {formatExact(
                        row?.source_row_count == null
                          ? null
                          : String(row.source_row_count),
                      )}{" "}
                      /{" "}
                      {row?.ambiguous == null
                        ? "Indisponible"
                        : row.ambiguous
                          ? "Oui"
                          : "Non"}
                    </TableCell>
                    <TableCell>
                      {row && (
                        <Button
                          aria-label={`Détail activité ${activityLabels[type]}, ${c.month}`}
                          onClick={(e) => {
                            trigger.current = e.currentTarget;
                            setOpened(row);
                          }}
                        >
                          Détail et preuves
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              }),
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {opened && (
        <ActivityEvidence
          key={`${opened.period}:${opened.activity_type}`}
          row={opened}
          catalog={value.catalog}
          reads={reads}
          close={() => setOpened(undefined)}
        />
      )}
    </Stack>
  );
}
function ActivityEvidence({
  row,
  catalog,
  reads,
  close,
}: {
  row: ActivityRow;
  catalog: readonly Resource[];
  reads: ActivityReads;
  close: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const [id, setId] = useState<string>(),
    [page, setPage] = useState(0);
  useEffect(() => heading.current?.focus(), []);
  useEffect(() => {
    if (!id && trigger.current)
      (trigger.current.isConnected
        ? trigger.current
        : heading.current
      )?.focus();
  }, [id]);
  const observation = catalog.find(
    (r) =>
      r.name === activityObservationResource.name &&
      r.filters.includes("id") &&
      activityObservationResource.columns.every((f) => r.columns.includes(f)),
  );
  const ids = row.observation_ids;
  return (
    <Stack spacing={2}>
      <Typography variant="h3" component="h3" ref={heading} tabIndex={-1}>
        Détail activité — {activityLabels[row.activity_type]},{" "}
        {formatMonth(row.period.slice(0, 7))}
      </Typography>
      <Button onClick={close}>Fermer le détail activité</Button>
      <PublishedDetail resource={activityResource} row={row} />
      <Typography>
        Observations sources vivantes, à la demande ; elles peuvent avoir changé
        ou disparu. Elles ne constituent pas une preuve historique immuable.
        Plusieurs sources restent ambiguës, sans somme ni choix arbitraire.
      </Typography>
      {ids === null ? (
        <Typography>Identifiants indisponibles.</Typography>
      ) : !ids.length ? (
        <Typography>Aucune observation liée.</Typography>
      ) : !observation ? (
        <Typography>
          Consultation des observations non disponible au catalogue.
        </Typography>
      ) : (
        <>
          <Box component="ul" sx={{ pl: 3 }}>
            {ids.slice(page * 50, page * 50 + 50).map((sourceId) => (
              <Box component="li" key={sourceId}>
                <Button
                  sx={{ overflowWrap: "anywhere", textAlign: "left" }}
                  onClick={(e) => {
                    trigger.current = e.currentTarget;
                    setId(sourceId);
                  }}
                >
                  Consulter l’observation {sourceId}
                </Button>
              </Box>
            ))}
          </Box>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            <Button disabled={page === 0} onClick={() => setPage((n) => n - 1)}>
              Observations précédentes
            </Button>
            <Button
              disabled={(page + 1) * 50 >= ids.length}
              onClick={() => setPage((n) => n + 1)}
            >
              Observations suivantes
            </Button>
          </Stack>
        </>
      )}
      {id && (
        <LiveActivity
          key={id}
          id={id}
          row={row}
          reads={reads}
          close={() => setId(undefined)}
        />
      )}
    </Stack>
  );
}
function LiveActivity({
  id,
  row,
  reads,
  close,
}: {
  id: string;
  row: ActivityRow;
  reads: ActivityReads;
  close: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const load = useMemo(
    () => async (options: ReadOptions) => {
      supported(
        availableResources(await reads.resources(options)),
        activityObservationResource,
        ["id"],
      );
      const before = await reads.status(options);
      if (before.state === "uninitialized")
        throw new BlockError(
          "Aucune publication analytique initialisée. Cette observation ne peut pas être vérifiée dans le contexte publié.",
        );
      const result: ReadPage<PublishedRow> = await reads.page(
        activityObservationResource.name,
        { id, limit: 2 },
        activityObservation,
        options,
      );
      if (result.nextCursor !== null || result.items.length > 1)
        throw new Error("Invalid response");
      const source = result.items[0];
      if (source) verifyActivityObservation(source, id, row);
      const after = await reads.status(options);
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw new BlockError(
          "La publication a changé. Relisez cette observation.",
        );
      return { source, freshness: after };
    },
    [reads, id, row],
  );
  const { state, retry } = useBlock(load);
  return (
    <Stack spacing={2}>
      <Typography variant="h3" component="h3" ref={heading} tabIndex={-1}>
        Observation d’activité vivante
      </Typography>
      <Button onClick={close}>Fermer l’observation activité</Button>
      {state.phase === "loading" && (
        <Typography role="status">Chargement de l’observation…</Typography>
      )}
      {state.phase === "error" && (
        <Alert severity="warning">{state.message}</Alert>
      )}
      {state.phase === "ready" && (
        <>
          <Fresh value={state.value.freshness} />
          {state.value.source ? (
            <PublishedDetail
              resource={activityObservationResource}
              row={state.value.source}
            />
          ) : (
            <Typography>
              Observation absente ou supprimée ; la cellule publiée reste
              consultable.
            </Typography>
          )}
        </>
      )}
      <Button onClick={retry}>Relire l’observation activité</Button>
    </Stack>
  );
}
const salesColumns = [
  "store_id",
  "period",
  "revenue",
  "units",
  "calls",
  "field_visits",
  "crowdsourced_visits",
  "unambiguous_reported_revenue",
  "unambiguous_reported_units",
  "register_product_count",
  "register_ambiguous_products",
  "register_revenue_product_count",
  "register_units_product_count",
  "has_register",
];
function SalesContext({
  storeId,
  period,
  reads,
}: {
  storeId: string;
  period: MonthPeriod;
  reads: ActivityReads;
}) {
  const load = useMemo(
    () => async (options: ReadOptions) => {
      const catalog = availableResources(await reads.resources(options));
      const resource = catalog.find((r) => r.name === "analytics_store_month");
      if (!resource)
        throw new BlockError("Le catalogue ne permet pas cette consultation.");
      supported(catalog, resource, ["store_id", "period"], salesColumns);
      const result = await collection(
        reads,
        resource.name,
        { store_id: storeId, ...periodQuery(period), limit: 50 },
        monthlySale,
        options,
        120,
      );
      const grid = monthlyGrid(result.items, storeId, period);
      return { grid, freshness: result.freshness };
    },
    [reads, storeId, period],
  );
  const { state, retry } = useBlock(load),
    theme = useTheme();
  return (
    <Stack spacing={2}>
      <Typography variant="h2">Ventes sur le même calendrier</Typography>
      <Typography>
        Lecture indépendante de l’activité, sans jointure ni instantané commun
        garanti. Univers produit observé uniquement, devise et HT/TTC non
        confirmés. Aucun lien causal déduit.
      </Typography>
      {state.phase === "loading" && (
        <Typography role="status">Chargement du contexte ventes…</Typography>
      )}
      {state.phase === "error" && (
        <Alert severity="warning">{state.message}</Alert>
      )}
      {state.phase === "ready" && (
        <>
          <Fresh value={state.value.freshness} />
          <CalendarChart
            months={state.value.grid.map((c) => c.month)}
            values={state.value.grid.map((c) => c.row?.revenue ?? null)}
            label="CA observé"
            unit="unité monétaire à confirmer"
            color={theme.palette.primary.main}
          />
          <TableContainer
            component={Paper}
            variant="outlined"
            role="region"
            aria-label="Contexte ventes mensuel exact"
            tabIndex={0}
            sx={{ maxWidth: "100%" }}
          >
            <Table>
              <caption>
                Valeurs exactes alignées sur les mêmes mois, sans addition avec
                l’activité.
              </caption>
              <TableHead>
                <TableRow>
                  <TableCell>Mois</TableCell>
                  <TableCell align="right">CA observé</TableCell>
                  <TableCell>État</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {state.value.grid.map((c) => (
                  <TableRow key={c.month}>
                    <TableCell component="th" scope="row">
                      {formatMonth(c.month)}
                    </TableCell>
                    <TableCell align="right">
                      {formatExact(c.row?.revenue ?? null)}
                    </TableCell>
                    <TableCell>
                      {!c.row
                        ? "Cellule absente"
                        : c.row.ambiguous
                          ? "Ambiguïté"
                          : c.row.revenue === null
                            ? "Valeur indisponible"
                            : "Valeur publiée"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
      <Button onClick={retry}>Relire le contexte ventes</Button>
    </Stack>
  );
}
