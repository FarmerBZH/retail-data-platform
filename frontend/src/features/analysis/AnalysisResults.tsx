import { useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  MenuItem,
  Typography,
} from "@mui/material";
import { LineChart } from "@mui/x-charts/LineChart";
import { BarChart } from "@mui/x-charts/BarChart";
import { useTheme } from "@mui/material/styles";
import type {
  AnalysisPoint,
  AnalysisQuery,
  AnalysisStore,
} from "../../api/analysis-contract";
import { labels, measures } from "../../api/analysis-contract";
import { useAnalysis } from "./use-analysis";
import type { AnalysisReads } from "./use-analysis";
import type { AnalysisTab } from "./analysis-state";
import {
  formatExact,
  formatMonth,
  formatPercent,
  formatPublicationTime,
} from "../../shared/exact-values";
import { plotValue } from "../sales/monthly-sales";
import { seriesColors } from "../../app/theme";

const show = (v: string | null) => formatExact(v);
function Pending({
  error,
  retry,
}: {
  error: string | undefined;
  retry: () => void;
}) {
  return error ? (
    <Alert
      severity="warning"
      action={<Button onClick={retry}>Réessayer ce bloc</Button>}
    >
      {error}
    </Alert>
  ) : (
    <Typography role="status" aria-busy="true">
      Chargement de l’analyse…
    </Typography>
  );
}
export function AnalysisDetails({
  value,
  label = "Détails exacts de la réponse",
}: {
  value: unknown;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Accordion
      expanded={open}
      onChange={(_, expanded) => setOpen(expanded)}
      disableGutters
    >
      <AccordionSummary>{label}</AccordionSummary>
      <AccordionDetails>
        {open && (
          <Box
            component="pre"
            sx={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              fontSize: "0.875rem",
              m: 0,
            }}
          >
            {JSON.stringify(value, null, 2)}
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
export function AnalysisResults({
  reads,
  query,
  tab,
  cohort,
  onCohort,
  onConflict,
  onOpen,
}: {
  reads: AnalysisReads;
  query: AnalysisQuery;
  tab: AnalysisTab;
  cohort: boolean;
  onCohort: (v: boolean) => void;
  onConflict: () => void;
  onOpen: (s: AnalysisStore, b: HTMLButtonElement) => void;
}) {
  const summary = useAnalysis(reads, "summary", query, onConflict);
  if (!summary.data)
    return <Pending error={summary.error} retry={summary.retry} />;
  const { context, metrics, revenue_per_unit, revenue_contribution_sum } =
    summary.data;
  const applied = context.window!,
    reference = context.reference!;
  return (
    <Stack spacing={3}>
      <Typography variant="h2">
        Résultats appliqués — {formatMonth(applied.start.slice(0, 7))} à{" "}
        {formatMonth(applied.end.slice(0, 7))}
      </Typography>
      <Typography>
        Référence : {formatMonth(reference.start.slice(0, 7))} à{" "}
        {formatMonth(reference.end.slice(0, 7))}.{" "}
        {context.scope.scope_store_count} magasins retenus ;{" "}
        {context.scope.filtered_out_store_count} écartés par les filtres.
        {context.scope.requested_store_count !== null &&
          ` ${context.scope.requested_store_count} identifiants demandés, ${context.scope.resolved_store_count} reconnus.`}
      </Typography>
      <Alert
        severity={
          context.freshness.state === "stale" ||
          context.freshness.last_attempt_status === "failed"
            ? "warning"
            : "info"
        }
      >
        {context.freshness.state === "stale"
          ? "Publication ancienne."
          : "Publication à jour lors de la lecture."}{" "}
        {formatPublicationTime(context.freshness.last_completed_at)}.{" "}
        {context.freshness.last_attempt_status === "failed" &&
          "La dernière mise à jour a échoué ; la précédente reste consultable."}{" "}
        Référentiel figé à cette publication.
      </Alert>
      <FormControlLabel
        control={
          <Switch
            checked={cohort}
            onChange={(_, checked) => onCohort(checked)}
          />
        }
        label="Cohorte comparable (figée sur les deux fenêtres)"
      />
      <Typography>
        Chaque mesure possède sa cohorte. Une cohorte comparable ne garantit ni
        assortiment ni périmètre économique constant. Les zéros sont mesurés ;
        une absence reste indisponible.
      </Typography>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: {
            xs: "minmax(0,1fr)",
            sm: "repeat(2,minmax(0,1fr))",
            lg: "repeat(3,minmax(0,1fr))",
          },
        }}
      >
        {measures.map((key) => {
          const m = metrics[key],
            c = m.cohort,
            value = cohort ? c.current : m.current.value,
            partial = cohort ? null : m.current.partial,
            delta = cohort ? c.change : m.change;
          return (
            <Paper key={key} variant="outlined" sx={{ p: 2, minWidth: 0 }}>
              <Typography variant="h3">
                {labels[key]} —{" "}
                {cohort
                  ? "cohorte comparable"
                  : value === null
                    ? "partiel"
                    : "complet"}
              </Typography>
              <Typography sx={{ fontSize: "1.75rem" }}>
                {show(value ?? partial)}
              </Typography>
              <Typography>
                {value === null && !cohort
                  ? "Montant partiel sur cellules valides. "
                  : ""}
                Couverture :{" "}
                {cohort ? c.expected_cell_count : m.current.covered_cell_count}/
                {cohort ? c.expected_cell_count : m.current.expected_cell_count}{" "}
                cellules magasin-mois.
                {(cohort
                  ? c.expected_cell_count
                  : m.current.expected_cell_count) === 0 &&
                  " Couverture indéfinie."}
              </Typography>
              <Typography>
                Cohorte : {c.store_count} inclus, {c.excluded_store_count}{" "}
                exclus.
              </Typography>
              <Typography>
                Référence : {show(cohort ? c.reference : m.reference.value)}.
                Variation : {show(delta.difference)} ;{" "}
                {delta.reference_state === "negative"
                  ? "Base négative — pourcentage masqué"
                  : delta.reference_state === "zero"
                    ? "Base zéro — pourcentage indisponible"
                    : formatPercent(delta.ratio)}
                .
              </Typography>
            </Paper>
          );
        })}
      </Box>
      <Typography>
        CA par unité :{" "}
        {show(
          cohort ? revenue_per_unit.cohort_current : revenue_per_unit.current,
        )}{" "}
        ; référence :{" "}
        {show(
          cohort
            ? revenue_per_unit.cohort_reference
            : revenue_per_unit.reference,
        )}
        . Intersection CA/unités : {revenue_per_unit.cohort_store_count}{" "}
        magasins. Unités déclarées, pas des volumes physiques.
      </Typography>
      <Typography>
        Somme globale des contributions sur la cohorte CA :{" "}
        {show(revenue_contribution_sum)}. Calcul serveur indépendant de la page
        de classement.
      </Typography>
      {tab === "summary" ? (
        <SeriesBlock
          reads={reads}
          query={query}
          cohort={cohort}
          onConflict={onConflict}
        />
      ) : tab === "ranking" ? (
        <RankingBlock
          reads={reads}
          query={query}
          onConflict={onConflict}
          onOpen={onOpen}
        />
      ) : (
        <StoreSeriesBlock
          reads={reads}
          query={query}
          cohort={cohort}
          onConflict={onConflict}
          onOpen={onOpen}
        />
      )}
      <AvailabilityBlock reads={reads} query={query} onConflict={onConflict} />
      <AnalysisDetails
        value={summary.data}
        label="Périmètre, mesures et métadonnées exactes"
      />
    </Stack>
  );
}
type BlockProps = {
  reads: AnalysisReads;
  query: AnalysisQuery;
  onConflict: () => void;
};
function TableRegion({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <TableContainer
      component={Paper}
      variant="outlined"
      tabIndex={0}
      role="region"
      aria-label={label}
      sx={{ maxWidth: "100%" }}
    >
      {children}
    </TableContainer>
  );
}
function geometry(values: (string | null)[]) {
  const result = values.map(plotValue);
  const finite = result.filter((v): v is number => v !== null);
  return finite.length &&
    !Number.isFinite(Math.max(...finite) - Math.min(...finite))
    ? result.map(() => null)
    : result;
}
function PointTable({
  points,
  label,
}: {
  points: AnalysisPoint[];
  label: string;
}) {
  return (
    <TableRegion label={label}>
      <Table>
        <caption>
          Valeurs exactes ; mesures complètes et partielles, références et
          couverture indépendantes.
        </caption>
        <TableHead>
          <TableRow>
            <TableCell>Mois et référence</TableCell>
            {measures.map((k) => (
              <TableCell key={k}>{labels[k]} — courant / référence</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {points.map((p) => (
            <TableRow key={p.period}>
              <TableCell component="th" scope="row">
                {formatMonth(p.period.slice(0, 7))} /{" "}
                {formatMonth(p.reference_period.slice(0, 7))}
              </TableCell>
              {measures.map((k) => {
                const m = p.metrics[k];
                return (
                  <TableCell key={k}>
                    {show(m.current.value ?? m.current.partial)} —{" "}
                    {m.current.value === null ? "partiel" : "complet"} ;{" "}
                    {m.current.covered_cell_count}/
                    {m.current.expected_cell_count}
                    <br />
                    Référence : {show(
                      m.reference.value ?? m.reference.partial,
                    )}{" "}
                    — {m.reference.value === null ? "partiel" : "complet"} ;{" "}
                    {m.reference.covered_cell_count}/
                    {m.reference.expected_cell_count}
                    <br />
                    Cohorte {m.cohort_store_count} : {show(m.cohort_current)} /{" "}
                    {show(m.cohort_reference)}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableRegion>
  );
}
function Trend({
  points,
  cohort,
  label,
}: {
  points: AnalysisPoint[];
  cohort: boolean;
  label: string;
}) {
  const theme = useTheme();
  const values = points.map((p) =>
      cohort
        ? p.metrics.revenue.cohort_current
        : p.metrics.revenue.current.value,
    ),
    references = points.map((p) =>
      cohort
        ? p.metrics.revenue.cohort_reference
        : p.metrics.revenue.reference.value,
    );
  if (![...values, ...references].some((v) => v !== null))
    return (
      <Typography>
        Aucune valeur complète à tracer. Les absences restent des trous.
      </Typography>
    );
  return (
    <>
      <Typography>
        CA {cohort ? "de la cohorte figée" : "complet"} : courant continu,
        référence en pointillé. Tracé approximatif, valeurs et couverture
        exactes dans le tableau. Aucune interpolation ni montant partiel tracé
        comme complet.
      </Typography>
      <Box sx={{ minWidth: 0 }}>
        <LineChart
          height={320}
          skipAnimation
          xAxis={[
            {
              scaleType: "point",
              data: points.map((p) => p.period),
              valueFormatter: (v) => formatMonth(String(v).slice(0, 7)),
            },
          ]}
          series={[
            {
              id: "current",
              data: geometry(values),
              label: "Courant",
              color: theme.palette.primary.main,
              curve: "linear",
              connectNulls: false,
              showMark: true,
              valueFormatter: (_, { dataIndex }) =>
                `${show(values[dataIndex] ?? null)} · couverture ${points[dataIndex]!.metrics.revenue.current.covered_cell_count}/${points[dataIndex]!.metrics.revenue.current.expected_cell_count}`,
            },
            {
              id: "reference",
              data: geometry(references),
              label: "Référence",
              color: seriesColors[1],
              curve: "linear",
              connectNulls: false,
              showMark: true,
              valueFormatter: (_, { dataIndex }) =>
                `${show(references[dataIndex] ?? null)} · ${formatMonth(points[dataIndex]!.reference_period.slice(0, 7))}`,
            },
          ]}
          sx={{
            "& .MuiLineElement-series-reference": { strokeDasharray: "6 4" },
          }}
          aria-label={label}
        />
      </Box>
    </>
  );
}
function SeriesBlock({
  reads,
  query,
  cohort,
  onConflict,
}: BlockProps & { cohort: boolean }) {
  const result = useAnalysis(reads, "series", query, onConflict);
  if (!result.data)
    return <Pending error={result.error} retry={result.retry} />;
  return (
    <Stack spacing={2}>
      <Typography variant="h2">Évolution mensuelle filtrée</Typography>
      {!result.data.items.length ? (
        <Alert severity="info">Périmètre vide : aucune série.</Alert>
      ) : (
        <>
          <Trend
            points={result.data.items}
            cohort={cohort}
            label="CA filtré courant et référence"
          />
          <Typography>
            Couverture mensuelle du CA — courant et référence
          </Typography>
          <TableRegion label="Couverture mensuelle filtrée">
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Mois</TableCell>
                  <TableCell>Courant</TableCell>
                  <TableCell>Référence</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.data.items.map((p) => (
                  <TableRow key={p.period}>
                    <TableCell>{formatMonth(p.period.slice(0, 7))}</TableCell>
                    <TableCell>
                      {p.metrics.revenue.current.covered_cell_count}/
                      {p.metrics.revenue.current.expected_cell_count}
                    </TableCell>
                    <TableCell>
                      {p.metrics.revenue.reference.covered_cell_count}/
                      {p.metrics.revenue.reference.expected_cell_count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRegion>
          <PointTable
            points={result.data.items}
            label="Valeurs mensuelles filtrées"
          />
        </>
      )}
      <AnalysisDetails value={result.data} />
    </Stack>
  );
}
function RankingBlock({
  reads,
  query,
  onConflict,
  onOpen,
}: BlockProps & { onOpen: (s: AnalysisStore, b: HTMLButtonElement) => void }) {
  const [sort, setSort] = useState<"revenue" | "revenue_change">("revenue");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [index, setIndex] = useState(0);
  const theme = useTheme();
  const result = useAnalysis(
    reads,
    "ranking",
    {
      ...query,
      sort,
      direction,
      limit: 20,
      ...(cursors[index] ? { after: cursors[index] } : {}),
    },
    onConflict,
  );
  return (
    <Stack spacing={2}>
      <Typography variant="h2">
        Classement global du périmètre filtré
      </Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          label="Trier tout le classement"
          select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as typeof sort);
            setCursors([undefined]);
            setIndex(0);
          }}
        >
          <MenuItem value="revenue">CA courant</MenuItem>
          <MenuItem value="revenue_change">Contribution absolue</MenuItem>
        </TextField>
        <TextField
          label="Sens du classement"
          select
          value={direction}
          onChange={(e) => {
            setDirection(e.target.value as typeof direction);
            setCursors([undefined]);
            setIndex(0);
          }}
        >
          <MenuItem value="desc">Décroissant</MenuItem>
          <MenuItem value="asc">Croissant</MenuItem>
        </TextField>
      </Stack>
      {!result.data ? (
        <Pending error={result.error} retry={result.retry} />
      ) : (
        <>
          <Typography>
            Page {index + 1}. Tri serveur sur tous les magasins retenus. Nulls
            en fin ; égalités départagées par identifiant. La contribution porte
            uniquement sur la cohorte CA, sans pourcentage inventé.
          </Typography>
          {result.data.items.some((r) => r.revenue_change !== null) && (
            <BarChart
              height={Math.max(240, result.data.items.length * 44)}
              layout="horizontal"
              skipAnimation
              yAxis={[
                {
                  scaleType: "band",
                  data: result.data.items.map(
                    (r) => `${r.rank}. ${r.name ?? "Nom indisponible"}`,
                  ),
                },
              ]}
              xAxis={[
                {
                  min: Math.min(
                    0,
                    ...geometry(
                      result.data.items.map((r) => r.revenue_change),
                    ).filter((v): v is number => v !== null),
                  ),
                  max:
                    Math.max(
                      0,
                      ...geometry(
                        result.data.items.map((r) => r.revenue_change),
                      ).filter((v): v is number => v !== null),
                    ) || 1,
                },
              ]}
              series={[
                {
                  data: geometry(
                    result.data.items.map((r) => r.revenue_change),
                  ),
                  label: "Contribution absolue — page affichée",
                  color: theme.palette.primary.main,
                  valueFormatter: (_, { dataIndex }) =>
                    show(result.data!.items[dataIndex]!.revenue_change),
                },
              ]}
              aria-label="Contributions des magasins sur cette page"
            />
          )}
          <TableRegion label="Classement filtré exact">
            <Table>
              <TableHead>
                <TableRow>
                  {[
                    "Rang",
                    "Magasin",
                    "CA courant / référence",
                    "Contribution",
                    "Couverture courante / référence",
                    "Exclusion de cohorte",
                  ].map((h) => (
                    <TableCell key={h}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {result.data.items.map((r) => (
                  <TableRow key={r.store_id}>
                    <TableCell>{r.rank}</TableCell>
                    <TableCell>
                      <Button onClick={(e) => onOpen(r, e.currentTarget)}>
                        {r.name ?? r.store_id}
                      </Button>
                    </TableCell>
                    <TableCell>
                      {show(r.current_revenue)} / {show(r.reference_revenue)}
                      <br />
                      Partiels : {show(r.current_revenue_partial)} /{" "}
                      {show(r.reference_revenue_partial)}
                    </TableCell>
                    <TableCell>{show(r.revenue_change)}</TableCell>
                    <TableCell>
                      {r.current_revenue_covered}/{r.expected_month_count} /{" "}
                      {r.reference_revenue_covered}/{r.expected_month_count}
                    </TableCell>
                    <TableCell>
                      {r.exclusion_reason === null
                        ? "Inclus"
                        : r.exclusion_reason === "missing_month"
                          ? "Mois absent"
                          : r.exclusion_reason === "ambiguous_measure"
                            ? "Ambiguïté connue"
                            : "Mesure manquante"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRegion>
          {!result.data.items.length && (
            <Typography>Aucun magasin dans ce périmètre.</Typography>
          )}
          <Stack direction="row" spacing={2}>
            <Button disabled={!index} onClick={() => setIndex((n) => n - 1)}>
              Classement précédent
            </Button>
            <Button
              disabled={!result.data.next_cursor}
              onClick={() => {
                setCursors([
                  ...cursors.slice(0, index + 1),
                  result.data!.next_cursor!,
                ]);
                setIndex((n) => n + 1);
              }}
            >
              Classement suivant
            </Button>
          </Stack>
          <AnalysisDetails value={result.data} />
        </>
      )}
    </Stack>
  );
}
function StoreSeriesBlock({
  reads,
  query,
  cohort,
  onConflict,
  onOpen,
}: BlockProps & {
  cohort: boolean;
  onOpen: (s: AnalysisStore, b: HTMLButtonElement) => void;
}) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [index, setIndex] = useState(0);
  const result = useAnalysis(
    reads,
    "store-series",
    {
      ...query,
      limit: 6,
      ...(cursors[index] ? { after: cursors[index] } : {}),
    },
    onConflict,
  );
  if (!result.data)
    return <Pending error={result.error} retry={result.retry} />;
  const page = result.data;
  const all = page.items.flatMap((item) =>
    item.points.flatMap((p) => [
      cohort
        ? p.metrics.revenue.cohort_current
        : p.metrics.revenue.current.value,
      cohort
        ? p.metrics.revenue.cohort_reference
        : p.metrics.revenue.reference.value,
    ]),
  );
  const finite = geometry(all).filter((v): v is number => v !== null);
  const min = Math.min(0, ...finite),
    max = Math.max(0, ...finite) || 1;
  return (
    <Stack spacing={2}>
      <Typography variant="h2">
        Comparer les magasins — page {index + 1}
      </Typography>
      <Typography>
        {page.context.scope.scope_store_count} magasins dans le total appliqué ;{" "}
        {page.items.length} séries visibles, au plus six. Échelle absolue
        commune aux magasins de cette page. Les couleurs suivent l’identifiant,
        sans changer après un tri. Tracés approximatifs : courant continu et
        référence en pointillé ; valeurs et couverture exactes dans les
        tableaux.
      </Typography>
      {page.items.map((item) => {
        const values = item.points.map((p) =>
          cohort
            ? p.metrics.revenue.cohort_current
            : p.metrics.revenue.current.value,
        );
        const refs = item.points.map((p) =>
          cohort
            ? p.metrics.revenue.cohort_reference
            : p.metrics.revenue.reference.value,
        );
        const color =
          seriesColors[
            Number.parseInt(
              item.store.store_id.replaceAll("-", "").slice(-6),
              16,
            ) % seriesColors.length
          ]!;
        return (
          <Paper
            variant="outlined"
            sx={{ p: 2, minWidth: 0 }}
            key={item.store.store_id}
          >
            <Stack spacing={2}>
              <Typography variant="h3">
                {item.store.name ?? "Nom indisponible"}
              </Typography>
              <Button onClick={(e) => onOpen(item.store, e.currentTarget)}>
                Ouvrir {item.store.name ?? item.store.store_id}
              </Button>
              {[...values, ...refs].some((v) => v !== null) &&
              finite.length > 0 &&
              Number.isFinite(max - min) ? (
                <LineChart
                  height={240}
                  skipAnimation
                  xAxis={[
                    {
                      scaleType: "point",
                      data: item.points.map((p) => p.period),
                      valueFormatter: (v) => formatMonth(String(v).slice(0, 7)),
                    },
                  ]}
                  yAxis={[{ min, max }]}
                  series={[
                    {
                      id: "current",
                      data: geometry(values),
                      label: "Courant",
                      color,
                      curve: "linear",
                      connectNulls: false,
                      showMark: true,
                      valueFormatter: (_, { dataIndex }) =>
                        show(values[dataIndex] ?? null),
                    },
                    {
                      id: "reference",
                      data: geometry(refs),
                      label: "Référence",
                      color,
                      curve: "linear",
                      connectNulls: false,
                      showMark: true,
                      valueFormatter: (_, { dataIndex }) =>
                        show(refs[dataIndex] ?? null),
                    },
                  ]}
                  sx={{
                    "& .MuiLineElement-series-reference": {
                      strokeDasharray: "6 4",
                    },
                  }}
                  aria-label={`CA comparé — ${item.store.name ?? "magasin"}`}
                />
              ) : (
                <Typography>
                  Aucune valeur complète traçable. Les valeurs hors capacité de
                  tracé restent dans le tableau exact.
                </Typography>
              )}
              <PointTable
                points={item.points}
                label={`Valeurs comparées — ${item.store.name ?? item.store.store_id}`}
              />
            </Stack>
          </Paper>
        );
      })}
      {!page.items.length && (
        <Alert severity="info">Aucun magasin à comparer.</Alert>
      )}
      <Stack direction="row" spacing={2}>
        <Button disabled={!index} onClick={() => setIndex((n) => n - 1)}>
          Séries précédentes
        </Button>
        <Button
          disabled={!page.next_cursor}
          onClick={() => {
            setCursors([...cursors.slice(0, index + 1), page.next_cursor!]);
            setIndex((n) => n + 1);
          }}
        >
          Séries suivantes
        </Button>
      </Stack>
      <AnalysisDetails value={page} />
    </Stack>
  );
}
function AvailabilityBlock({ reads, query, onConflict }: BlockProps) {
  const { comparison: _comparison, ...params } = query;
  void _comparison;
  const result = useAnalysis(reads, "availability", params, onConflict);
  if (!result.data)
    return <Pending error={result.error} retry={result.retry} />;
  return (
    <Stack spacing={2}>
      <Typography variant="h2">
        Disponibilité des observations par source
      </Typography>
      <Typography>
        La présence de lignes ne prouve ni livraison complète ni mesure valide.
        Les bornes excluent les seules absences inférées. Une absence de ligne
        reste sans compteur, pas zéro mesuré.
      </Typography>
      <TableRegion label="Disponibilité par source">
        <Table>
          <TableHead>
            <TableRow>
              {[
                "Domaine et bornes observées",
                "Mois",
                "Lignes rapportées / inférées / sources",
                "Magasins observés",
              ].map((h) => (
                <TableCell key={h}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {result.data.items.flatMap((d) =>
              d.months.map((m) => (
                <TableRow key={`${d.dataset}:${m.period}`}>
                  <TableCell>
                    {d.dataset} · {d.first_period ?? "Indisponible"} à{" "}
                    {d.last_period ?? "Indisponible"}
                  </TableCell>
                  <TableCell>{formatMonth(m.period.slice(0, 7))}</TableCell>
                  <TableCell>
                    {m.has_observation
                      ? `${m.observed_row_count} / ${m.inferred_absence_row_count} / ${m.source_row_count}`
                      : "Aucune observation publiée"}
                  </TableCell>
                  <TableCell>
                    {m.observed_store_count ?? "Indisponible"}
                  </TableCell>
                </TableRow>
              )),
            )}
          </TableBody>
        </Table>
      </TableRegion>
      <AnalysisDetails value={result.data} />
    </Stack>
  );
}
