import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { LineChart } from "@mui/x-charts/LineChart";
import { ApiError } from "./read-api";
import type { Freshness, Query, ResourceName } from "./read-api";
import type { Collection, ReadOptions, ReadQueries } from "./read-queries";
import type { Decoder } from "./api-validation";
import { availableResources } from "./published-data";
import { PublishedDetail } from "./PublishedDetail";
import {
  formatExact,
  formatMonth,
  formatPercent,
  formatPublicationTime,
} from "./exact-values";
import { periodQuery } from "./month-period";
import type { MonthPeriod } from "./month-period";
import { productGeometry } from "./product-sales";
import {
  presenceResources,
  presenceDecoders,
  presenceRows,
  categoryGrid,
} from "./presence-data";
import type { PresenceName, PresenceRow } from "./presence-data";

export type PresenceReads = Pick<ReadQueries, "resources" | "status"> & {
  collect: (
    name: ResourceName,
    query: Query,
    decode: Decoder<PresenceRow>,
    options?: ReadOptions & { maxPages?: number; maxItems?: number },
  ) => Promise<Collection<PresenceRow>>;
};
type State =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; rows: PresenceRow[]; freshness: Freshness };
async function load(
  name: PresenceName,
  storeId: string,
  period: MonthPeriod,
  reads: PresenceReads,
  signal: AbortSignal,
  category?: string,
): Promise<State> {
  const options = { signal, refresh: true };
  const catalog = availableResources(await reads.resources(options));
  const resource = catalog.find((r) => r.name === name);
  if (
    !resource ||
    ![
      "store_id",
      "period",
      ...(category !== undefined ? ["category_code"] : []),
    ].every((f) => resource.filters.includes(f)) ||
    presenceResources[name].columns.some((f) => !resource.columns.includes(f))
  )
    return {
      phase: "error",
      message: "Le catalogue ne permet pas cette consultation.",
    };
  const before = await reads.status(options);
  if (before.state === "uninitialized")
    return {
      phase: "error",
      message:
        "Aucune publication analytique initialisée. Présence et linéaire indisponibles.",
    };
  const result = await reads.collect(
    name,
    {
      store_id: storeId,
      ...periodQuery(period),
      ...(category !== undefined ? { category_code: category } : {}),
      limit: 100,
    },
    presenceDecoders[name],
    { ...options, maxPages: 5, maxItems: 500 },
  );
  if (!result.complete)
    return {
      phase: "error",
      message:
        result.reason === "freshness-changed"
          ? "La publication a changé. Relisez ce bloc."
          : "Lecture incomplète : aucun ratio ni absence ne peut être confirmé. Réduisez la période ou consultez Données.",
    };
  const after = await reads.status(options);
  if (JSON.stringify(before) !== JSON.stringify(after))
    return {
      phase: "error",
      message: "La publication a changé. Relisez ce bloc.",
    };
  return {
    phase: "ready",
    rows: presenceRows(name, result.items, storeId, period, category),
    freshness: after,
  };
}
function message(error: unknown) {
  if (error instanceof ApiError && error.code === "forbidden")
    return "Accès refusé à ce bloc.";
  if (error instanceof ApiError && error.code === "too-large")
    return "Une ligne dépasse la limite de réponse du service.";
  return "Ce bloc n’a pas pu être chargé ou vérifié. Réessayez.";
}
function usePresence(
  name: PresenceName,
  storeId: string,
  period: MonthPeriod,
  reads: PresenceReads,
  category?: string,
) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void load(name, storeId, period, reads, controller.signal, category)
      .then((result) => {
        if (!controller.signal.aborted) setState(result);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({ phase: "error", message: message(error) });
      });
    return () => controller.abort();
  }, [name, storeId, period, reads, category, revision]);
  return {
    state,
    retry: () => {
      setState({ phase: "loading" });
      setRevision((n) => n + 1);
    },
    revision,
  };
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
export function Presence({
  storeId,
  period,
  reads,
}: {
  storeId: string;
  period: MonthPeriod;
  reads: PresenceReads;
}) {
  const { state, retry, revision } = usePresence(
    "analytics_store_category_month",
    storeId,
    period,
    reads,
  );
  const action = <Button onClick={retry}>Relire la synthèse catégorie</Button>;
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Typography variant="h2">Présence et linéaire par catégorie</Typography>
      <Typography>
        {formatMonth(period.from)} à {formatMonth(period.to)}, bornes incluses.
        Présence sur les clés produit observées, absences inférées incluses ; ni
        distribution réseau ni conformité d’assortiment. Linéaire : unités
        physiques inconnues, catégories non présumées comparables. Aucun total,
        moyenne de ratios ou plafonnement à 100 %.
      </Typography>
      {state.phase === "loading" && (
        <Typography role="status">
          Chargement de la synthèse catégorie…
        </Typography>
      )}
      {state.phase === "error" && (
        <Alert severity="warning" action={action}>
          {state.message}
        </Alert>
      )}
      {state.phase === "ready" && (
        <>
          <Fresh value={state.freshness} />
          {state.rows.length ? (
            <Categories
              key={revision}
              rows={state.rows}
              storeId={storeId}
              period={period}
              reads={reads}
            />
          ) : (
            <Typography>
              Aucune catégorie publiée pour ces mois ; cela ne signifie pas
              absence mesurée.
            </Typography>
          )}
          {action}
        </>
      )}
    </Stack>
  );
}
const number = (value: unknown) =>
  formatExact(value == null ? null : String(value));
const percent = (value: unknown) =>
  formatPercent(value == null ? null : String(value));
function Categories({
  rows,
  storeId,
  period,
  reads,
}: {
  rows: PresenceRow[];
  storeId: string;
  period: MonthPeriod;
  reads: PresenceReads;
}) {
  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category_code))].sort(),
    [rows],
  );
  const [category, setCategory] = useState(categories[0]!);
  return (
    <Stack spacing={2}>
      <TextField
        select
        label="Catégorie publiée"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        sx={{ maxWidth: "100%" }}
      >
        {categories.map((c) => (
          <MenuItem key={c} value={c}>
            {c || "Code catégorie vide"}
          </MenuItem>
        ))}
      </TextField>
      <Category
        key={category}
        category={category}
        rows={rows}
        storeId={storeId}
        period={period}
        reads={reads}
      />
    </Stack>
  );
}
function Category({
  category,
  rows,
  storeId,
  period,
  reads,
}: {
  category: string;
  rows: PresenceRow[];
  storeId: string;
  period: MonthPeriod;
  reads: PresenceReads;
}) {
  const grid = categoryGrid(rows, category, period);
  const [details, setDetails] = useState<PresenceName>();
  const [opened, setOpened] = useState<PresenceRow>();
  const collectionTrigger = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!opened && trigger.current) trigger.current.focus();
  }, [opened]);
  useEffect(() => {
    if (opened) heading.current?.focus();
  }, [opened]);
  return (
    <Stack spacing={2}>
      <Typography sx={{ overflowWrap: "anywhere" }}>
        Catégorie source : {category || "code vide"}. Code conservé sans
        inventer de libellé ou de rapprochement. Choix local parmi les
        catégories de la lecture complète.
      </Typography>
      <RatioChart
        grid={grid}
        field="observed_presence_rate"
        label="Présence observée"
        category={category}
      />
      <RatioChart
        grid={grid}
        field="shelf_share"
        label="Part de linéaire"
        category={category}
      />
      <TableContainer
        component={Paper}
        variant="outlined"
        tabIndex={0}
        role="region"
        aria-label="Ratios et dénominateurs par catégorie"
        sx={{ maxWidth: "100%" }}
      >
        <Table sx={{ minWidth: 1050 }}>
          <caption>
            Valeurs exactes par catégorie et mois ; dénominateurs publiés,
            unités de linéaire inconnues.
          </caption>
          <TableHead>
            <TableRow>
              {[
                "Mois",
                "Présence",
                "Présents / clés observées",
                "Ambigus / non rapprochés",
                "Absences inférées — lignes",
                "Part de linéaire",
                "Entreprise / total — unités inconnues",
                "Linéaire — sources / ambiguïté",
                "Détail",
              ].map((t) => (
                <TableCell key={t}>{t}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {grid.map(({ month, row }) => (
              <TableRow key={month}>
                <TableCell component="th" scope="row">
                  {formatMonth(month)}
                  {!row && " — cellule absente"}
                </TableCell>
                <TableCell>{percent(row?.observed_presence_rate)}</TableCell>
                <TableCell>
                  {number(row?.present_products)} /{" "}
                  {number(row?.distribution_product_count)}
                </TableCell>
                <TableCell>
                  {number(row?.distribution_ambiguous_products)} /{" "}
                  {number(row?.distribution_unmatched_products)}
                </TableCell>
                <TableCell>{number(row?.inferred_absence_rows)}</TableCell>
                <TableCell>{percent(row?.shelf_share)}</TableCell>
                <TableCell>
                  {number(row?.shelf_company_value)} /{" "}
                  {number(row?.shelf_total_value)}
                </TableCell>
                <TableCell>
                  {number(row?.shelf_source_row_count)} /{" "}
                  {row?.shelf_ambiguous == null
                    ? "Indisponible"
                    : row.shelf_ambiguous
                      ? "Oui"
                      : "Non"}
                </TableCell>
                <TableCell>
                  {row && (
                    <Button
                      onClick={(e) => {
                        trigger.current = e.currentTarget;
                        setOpened(row);
                      }}
                      aria-label={`Détail catégorie ${category}, ${month}`}
                    >
                      Détail complet
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {opened && (
        <>
          <Typography variant="h3" component="h3" ref={heading} tabIndex={-1}>
            Détail catégorie publié
          </Typography>
          <Button onClick={() => setOpened(undefined)}>
            Fermer le détail catégorie
          </Button>
          <PublishedDetail
            resource={presenceResources.analytics_store_category_month}
            row={opened}
          />
        </>
      )}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <Button
          onClick={(e) => {
            collectionTrigger.current = e.currentTarget;
            setDetails("analytics_distribution_product_month");
          }}
        >
          Consulter les produits de présence
        </Button>
        <Button
          onClick={(e) => {
            collectionTrigger.current = e.currentTarget;
            setDetails("analytics_shelf_category_month");
          }}
        >
          Consulter les dénominateurs du linéaire
        </Button>
      </Stack>
      {details && (
        <>
          <Button
            onClick={() => {
              setDetails(undefined);
              collectionTrigger.current?.focus();
            }}
          >
            Fermer la collection catégorie
          </Button>
          <CategoryCollection
            key={details}
            name={details}
            storeId={storeId}
            category={category}
            period={period}
            reads={reads}
          />
        </>
      )}
    </Stack>
  );
}
function RatioChart({
  grid,
  field,
  label,
  category,
}: {
  grid: ReturnType<typeof categoryGrid>;
  field: string;
  label: string;
  category: string;
}) {
  const theme = useTheme(),
    small = useMediaQuery(theme.breakpoints.down("sm"));
  const values = grid.map(
    (c) => (c.row?.[field] as string | null | undefined) ?? null,
  );
  const geometry = productGeometry(values),
    covered = values.filter((v) => v !== null).length;
  const id = `category-${field}`;
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="h3">
        {label} — catégorie {category || "code vide"}
      </Typography>
      <Typography id={id}>
        {covered < grid.length
          ? "Série partielle"
          : "Valeurs disponibles sur tous les mois choisis"}
        . Couverture : {covered}/{grid.length} mois avec valeur. Coordonnées
        approximatives, étiquettes exactes ; trous sans interpolation.{" "}
        {field === "shelf_share"
          ? "Numérateur et dénominateur consultables, unités inconnues ; les ratios supérieurs à 100 % restent visibles."
          : "Dénominateur : clés produit observées, sans garantie de couverture exhaustive."}
      </Typography>
      {geometry.some((v) => v !== null) ? (
        <LineChart
          height={small ? 240 : 320}
          skipAnimation
          xAxis={[
            {
              scaleType: "point",
              data: grid.map((c) => c.month),
              valueFormatter: formatMonth,
            },
          ]}
          yAxis={[{ valueFormatter: (v: number) => formatPercent(String(v)) }]}
          series={[
            {
              id: field,
              label: `${label}${covered < grid.length ? " — partiel" : ""}`,
              color: theme.palette.primary.main,
              data: geometry,
              curve: "linear",
              showMark: true,
              connectNulls: false,
              valueFormatter: (_v, { dataIndex }) =>
                `${formatPercent(values[dataIndex] ?? null)} · ${formatMonth(grid[dataIndex]!.month)} · ${values[dataIndex] !== null ? 1 : 0}/1 mois`,
            },
          ]}
          aria-label={`${label} mensuelle par catégorie`}
          aria-describedby={id}
        />
      ) : (
        <Typography>
          Aucun ratio traçable ; les valeurs exactes restent dans le tableau.
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
function CategoryCollection({
  name,
  storeId,
  category,
  period,
  reads,
}: {
  name: PresenceName;
  storeId: string;
  category: string;
  period: MonthPeriod;
  reads: PresenceReads;
}) {
  const { state, retry } = usePresence(name, storeId, period, reads, category);
  const [page, setPage] = useState(0),
    [opened, setOpened] = useState<PresenceRow>();
  const trigger = useRef<HTMLButtonElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    table = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (opened) heading.current?.focus();
    else if (trigger.current)
      (trigger.current.isConnected ? trigger.current : table.current)?.focus();
  }, [opened]);
  const action = (
    <Button
      onClick={() => {
        setOpened(undefined);
        setPage(0);
        retry();
      }}
    >
      Relire la collection catégorie
    </Button>
  );
  const presence = name === "analytics_distribution_product_month";
  return (
    <Stack spacing={2}>
      <Typography variant="h3">
        {presence ? "Produits de présence" : "Linéaire publié"} —{" "}
        {category || "code vide"}
      </Typography>
      {state.phase === "loading" && (
        <Typography role="status">
          Chargement de la collection catégorie…
        </Typography>
      )}
      {state.phase === "error" && (
        <Alert severity="warning" action={action}>
          {state.message}
        </Alert>
      )}
      {state.phase === "ready" && (
        <>
          <Fresh value={state.freshness} />
          <Typography>
            Lecture indépendante de la synthèse, sans jointure ni instantané
            commun garanti. Les identifiants sources sont consultables sans
            lectures automatiques.{" "}
            {presence
              ? "Clés produit source conservées ; absence inférée distincte d’absence de cellule."
              : "Valeurs au grain catégorie/mois, sans agrégation entre unités inconnues."}
          </Typography>
          <TableContainer
            ref={table}
            component={Paper}
            variant="outlined"
            role="region"
            tabIndex={0}
            aria-label={
              presence
                ? "Produits de présence publiés"
                : "Dénominateurs de linéaire publiés"
            }
            sx={{ maxWidth: "100%" }}
          >
            <Table sx={{ minWidth: 750 }}>
              <caption>
                {state.rows.length} lignes publiées ; page {page + 1},
                pagination locale.
              </caption>
              <TableHead>
                <TableRow>
                  <TableCell>Mois</TableCell>
                  <TableCell>
                    {presence ? "Clé produit" : "Entreprise / total"}
                  </TableCell>
                  <TableCell>
                    {presence
                      ? "Présence / absences inférées"
                      : "Part de linéaire"}
                  </TableCell>
                  <TableCell>Sources / ambiguïté</TableCell>
                  <TableCell>Détail</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {state.rows.slice(page * 25, page * 25 + 25).map((row) => (
                  <TableRow
                    key={JSON.stringify(
                      presenceResources[name].keys.map((k) => row[k]),
                    )}
                  >
                    <TableCell component="th" scope="row">
                      {formatMonth(row.period.slice(0, 7))}
                    </TableCell>
                    <TableCell sx={{ overflowWrap: "anywhere", maxWidth: 240 }}>
                      {presence
                        ? String(row.product_key)
                        : `${number(row.company_value)} / ${number(row.total_value)}`}
                    </TableCell>
                    <TableCell>
                      {presence
                        ? `${number(row.presence_value)} / ${number(row.inferred_absence_rows)}`
                        : percent(row.shelf_share)}
                    </TableCell>
                    <TableCell>
                      {number(row.source_row_count)} /{" "}
                      {row.ambiguous == null
                        ? "Indisponible"
                        : row.ambiguous
                          ? "Oui"
                          : "Non"}
                    </TableCell>
                    <TableCell>
                      <Button
                        onClick={(e) => {
                          trigger.current = e.currentTarget;
                          setOpened(row);
                        }}
                        aria-label={`Détail ${presence ? String(row.product_key) : "linéaire"}, ${row.period.slice(0, 7)}`}
                      >
                        Ouvrir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {!state.rows.length && (
            <Typography>
              Aucune ligne publiée pour cette catégorie/période ; aucun zéro
              inféré.
            </Typography>
          )}
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            <Button disabled={page === 0} onClick={() => setPage((n) => n - 1)}>
              Lignes précédentes
            </Button>
            <Button
              disabled={(page + 1) * 25 >= state.rows.length}
              onClick={() => setPage((n) => n + 1)}
            >
              Lignes suivantes
            </Button>
          </Stack>
          {opened && (
            <>
              <Typography
                variant="h3"
                component="h3"
                ref={heading}
                tabIndex={-1}
              >
                Détail de la collection catégorie
              </Typography>
              <Button onClick={() => setOpened(undefined)}>
                Fermer la ligne catégorie
              </Button>
              <PublishedDetail
                resource={presenceResources[name]}
                row={opened}
              />
            </>
          )}
          {action}
        </>
      )}
    </Stack>
  );
}
