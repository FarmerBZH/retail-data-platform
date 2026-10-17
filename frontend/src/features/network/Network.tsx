import { initialNetworkContext } from "./network-data";
import type { NetworkContext } from "./network-data";
import { useEffect, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
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
import {
  loadNetwork,
  NetworkError,
  networkMeasures,
  amount,
  count,
} from "./network-data";
import type {
  NetworkMode,
  NetworkReads,
  NetworkSelection,
} from "./network-data";
import {
  formatExact,
  formatMonth,
  formatPercent,
  formatPublicationTime,
} from "../../shared/exact-values";
import { calendarMonths, validatePeriod } from "../../shared/month-period";
import { fieldLabel } from "../data-explorer/published-data";
import { PublishedDetail } from "../data-explorer/PublishedDetail";
import { plotValue } from "../sales/monthly-sales";

type Result = Awaited<ReturnType<typeof loadNetwork>>;
export function Network({
  reads,
  context,
  onContext,
}: {
  reads: NetworkReads;
  context?: NetworkContext;
  onContext?: (context: NetworkContext) => void;
}) {
  const [local, setLocal] = useState(initialNetworkContext);
  const current = context ?? local;
  const update = onContext ?? setLocal;
  const { mode, from, to, applied } = current;
  const setMode = (mode: NetworkMode) => update({ ...current, mode });
  const setFrom = (from: string) => update({ ...current, from });
  const setTo = (to: string) => update({ ...current, to });
  const setApplied = (applied: NetworkSelection) =>
    update({ ...current, applied });
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  return (
    <Stack spacing={3}>
      <Typography variant="h1">Vue réseau</Typography>
      <Typography>
        Tous les magasins du référentiel publié, actifs et inactifs. Univers
        produit observé uniquement, sans garantie de CA exhaustif. Unité
        monétaire à confirmer ; devise et HT/TTC non confirmés.
      </Typography>
      <Alert severity="info">
        Les classements, contributions, cohortes comparables et totaux
        multi-magasins sont accessibles dans « Analyses filtrées ». Ces
        synthèses globales conservent leur périmètre propre. Les attributs
        actuels des magasins ne définissent pas un historique économique
        constant.
      </Alert>
      <Box
        component="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const checked = validatePeriod(from, to);
          if (mode !== "overview" && !checked.valid) {
            setError(checked.message);
            return;
          }
          setError("");
          if (mode === "overview") setApplied({ mode });
          else if (checked.valid) setApplied({ mode, period: checked.period });
          setRevision((n) => n + 1);
        }}
      >
        <Stack
          spacing={2}
          direction={{ xs: "column", sm: "row" }}
          sx={{ flexWrap: "wrap" }}
          useFlexGap
        >
          <TextField
            select
            label="Lecture réseau"
            value={mode}
            onChange={(e) => setMode(e.target.value as NetworkMode)}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="overview">Ensemble du calendrier</MenuItem>
            <MenuItem value="month">Par mois</MenuItem>
            <MenuItem value="year">Par année</MenuItem>
          </TextField>
          {mode !== "overview" && (
            <>
              <TextField
                type="month"
                label="Mois de début"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                type="month"
                label="Mois de fin"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </>
          )}
          <Button variant="contained" type="submit">
            Appliquer
          </Button>
        </Stack>
        <Typography sx={{ mt: 1 }}>
          Au maximum 120 mois. La lecture annuelle inclut les années des deux
          bornes, sans découper leurs totaux. L’ensemble du calendrier ignore la
          période saisie. Aucun total de fenêtre arbitraire n’est calculé.
        </Typography>
        {error && <Alert severity="warning">{error}</Alert>}
      </Box>
      <NetworkResults
        key={`${JSON.stringify(applied)}:${revision}`}
        reads={reads}
        selection={applied}
        onRetry={() => setRevision((n) => n + 1)}
      />
    </Stack>
  );
}

function NetworkResults({
  reads,
  selection,
  onRetry,
}: {
  reads: NetworkReads;
  selection: NetworkSelection;
  onRetry: () => void;
}) {
  const [state, setState] = useState<{ result?: Result; error?: string }>({});
  const theme = useTheme();
  const small = useMediaQuery(theme.breakpoints.down("sm"));
  useEffect(() => {
    const controller = new AbortController();
    void loadNetwork(reads, selection, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setState({ result });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            error:
              error instanceof NetworkError
                ? error.message
                : "Lecture réseau impossible. Vérifiez vos droits ou réessayez.",
          });
      });
    return () => controller.abort();
  }, [reads, selection]);
  const retry = <Button onClick={onRetry}>Relire les résultats</Button>;
  if (state.error)
    return (
      <Alert severity="warning" action={retry}>
        {state.error}
      </Alert>
    );
  if (!state.result)
    return (
      <Typography role="status" aria-busy="true">
        Chargement du réseau…
      </Typography>
    );
  const { rows, resource, freshness, changes, comparisonError } = state.result;
  const latest = rows.at(-1);
  const label = (row: Result["rows"][number]) =>
    selection.mode === "overview"
      ? "Ensemble du calendrier disponible"
      : selection.mode === "year"
        ? `Année ${String(row.period).slice(0, 4)}`
        : formatMonth(String(row.period).slice(0, 7));
  const months =
    selection.mode === "month" ? calendarMonths(selection.period!) : [];
  let geometry = months.map((m) =>
    plotValue(
      amount(
        rows.find((r) => r.period === `${m}-01`) ?? { revenue: null },
        "revenue",
      ),
    ),
  );
  const points = geometry.filter((p): p is number => p !== null);
  if (
    points.length &&
    !Number.isFinite(Math.max(...points) - Math.min(...points))
  )
    geometry = geometry.map(() => null);
  return (
    <Stack spacing={2}>
      <Typography variant="h2">
        {selection.mode === "overview"
          ? "Ensemble du calendrier disponible"
          : selection.mode === "year"
            ? `Années ${selection.period!.from.slice(0, 4)} à ${selection.period!.to.slice(0, 4)}`
            : `${formatMonth(selection.period!.from)} à ${formatMonth(selection.period!.to)}`}
      </Typography>
      <Alert
        severity={
          freshness.state === "stale" ||
          freshness.lastAttemptStatus === "failed"
            ? "warning"
            : "info"
        }
      >
        {freshness.state === "stale"
          ? "Publication ancienne."
          : "Publication à jour lors de la lecture."}{" "}
        {freshness.lastCompletedAt &&
          formatPublicationTime(freshness.lastCompletedAt)}
        .{" "}
        {freshness.lastAttemptStatus === "failed" &&
          "La dernière mise à jour a échoué."}{" "}
        Les lectures ne constituent pas un instantané garanti.
      </Alert>
      {!latest ? (
        <Alert severity="info">
          Aucune observation publiée pour cette période. Aucun zéro n’est
          déduit.
        </Alert>
      ) : (
        <>
          <Typography variant="h3">Indicateurs — {label(latest)}</Typography>
          <Typography>
            {count(latest, "store_count")} magasins distincts ;{" "}
            {count(latest, "month_count")} mois publiés, de{" "}
            {latest.first_period
              ? formatMonth(String(latest.first_period).slice(0, 7))
              : "date indisponible"}{" "}
            à{" "}
            {latest.last_period
              ? formatMonth(String(latest.last_period).slice(0, 7))
              : "date indisponible"}
            . Une année peut être incomplète.
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
            {networkMeasures.map((metric) => (
              <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }} key={metric}>
                <Typography variant="h3">
                  {fieldLabel(metric)} —{" "}
                  {latest[metric] === null
                    ? "partiel"
                    : "complet sur l’univers observé"}
                </Typography>
                <Typography
                  sx={{ fontSize: "1.75rem", overflowWrap: "anywhere" }}
                >
                  {formatExact(
                    amount(latest, metric) ??
                      amount(latest, `${metric}_partial`),
                  )}
                </Typography>
                <Typography>
                  Couverture : {count(latest, `${metric}_covered_cell_count`)}/
                  {count(latest, "expected_cell_count")} cellules magasin-mois.{" "}
                  {count(latest, "expected_cell_count") === 0 &&
                    "Couverture indéfinie."}
                </Typography>
              </Paper>
            ))}
          </Box>
          <Typography>
            CA par unité : {formatExact(amount(latest, "revenue_per_unit"))}.
            Valeur serveur sur cellules complètes ; unités déclarées, pas des
            volumes physiques.
          </Typography>
        </>
      )}
      {months.length > 0 && (
        <>
          <Typography id="network-chart-help">
            CA observé complet par mois. Les montants partiels restent dans le
            tableau ; trous sans interpolation. Tracé approximatif, valeurs
            exactes et couverture dans le tableau. Les valeurs hors capacité de
            tracé restent consultables.
          </Typography>
          {geometry.some((p) => p !== null) && (
            <Box sx={{ minWidth: 0 }}>
              <LineChart
                height={small ? 240 : 320}
                skipAnimation
                xAxis={[
                  {
                    scaleType: "point",
                    data: months,
                    valueFormatter: formatMonth,
                  },
                ]}
                series={[
                  {
                    data: geometry,
                    label: "CA observé complet",
                    color: theme.palette.primary.main,
                    curve: "linear",
                    connectNulls: false,
                    showMark: true,
                    valueFormatter: (_v, { dataIndex }) => {
                      const row = rows.find(
                        (r) => r.period === `${months[dataIndex]}-01`,
                      );
                      return row
                        ? `${formatExact(amount(row, "revenue"))} · unité monétaire à confirmer · couverture ${count(row, "revenue_covered_cell_count")}/${count(row, "expected_cell_count")}`
                        : "Indisponible";
                    },
                  },
                ]}
                aria-label="CA réseau mensuel"
                aria-describedby="network-chart-help"
              />
            </Box>
          )}
          {months
            .filter((m) => !rows.some((r) => r.period === `${m}-01`))
            .map((m) => (
              <Typography key={m}>
                {formatMonth(m)} — mois absent de la publication
              </Typography>
            ))}
        </>
      )}
      <TableContainer
        component={Paper}
        variant="outlined"
        tabIndex={0}
        role="region"
        aria-label="Valeurs réseau exactes"
        sx={{ maxWidth: "100%" }}
      >
        <Table>
          <caption>
            Montants serveur et couverture par indicateur ; aucun cumul des
            lignes. Null reste distinct de zéro.
          </caption>
          <TableHead>
            <TableRow>
              <TableCell>Période publiée</TableCell>
              {networkMeasures.map((m) => (
                <TableCell key={m}>{fieldLabel(m)} ; couverture</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={String(row.period ?? row.scope)}>
                <TableCell component="th" scope="row">
                  {label(row)} — {count(row, "month_count")} mois
                </TableCell>
                {networkMeasures.map((m) => (
                  <TableCell key={m} sx={{ overflowWrap: "anywhere" }}>
                    {formatExact(amount(row, m) ?? amount(row, `${m}_partial`))}{" "}
                    — {row[m] === null ? "partiel" : "complet"} ;{" "}
                    {count(row, `${m}_covered_cell_count`)}/
                    {count(row, "expected_cell_count")}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {comparisonError && <Alert severity="warning">{comparisonError}</Alert>}
      {changes && (
        <>
          <Typography variant="h2">
            Comparaisons calendaires du CA complet
          </Typography>
          <Typography>
            M−1 et N−1 calculés avant le filtre de période. Couverture manquante
            : comparaison indisponible. Base zéro : pourcentage indisponible.
            Base négative : variation absolue uniquement. Aucun calcul de
            cohorte comparable.
          </Typography>
          <TableContainer
            component={Paper}
            variant="outlined"
            tabIndex={0}
            role="region"
            aria-label="Comparaisons réseau exactes"
          >
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Mois</TableCell>
                  <TableCell>Référence</TableCell>
                  <TableCell>CA de référence</TableCell>
                  <TableCell>Variation absolue</TableCell>
                  <TableCell>Variation relative</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {changes.rows.flatMap((row) =>
                  (["month", "year"] as const).map((ref) => {
                    const previous = amount(
                      row,
                      ref === "month"
                        ? "revenue_previous_month"
                        : "revenue_previous_year",
                    );
                    const negative =
                      previous !== null &&
                      formatExact(previous).startsWith("-");
                    return (
                      <TableRow key={`${String(row.period)}:${ref}`}>
                        <TableCell>
                          {formatMonth(String(row.period).slice(0, 7))}
                        </TableCell>
                        <TableCell>{ref === "month" ? "M−1" : "N−1"}</TableCell>
                        <TableCell>{formatExact(previous)}</TableCell>
                        <TableCell>
                          {formatExact(amount(row, `revenue_${ref}_change`))}
                        </TableCell>
                        <TableCell>
                          {negative
                            ? "Base négative"
                            : formatPercent(
                                amount(row, `revenue_${ref}_change_ratio`),
                              )}
                        </TableCell>
                      </TableRow>
                    );
                  }),
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
      {rows.map((row) => (
        <Accordion key={String(row.period ?? row.scope)} disableGutters>
          <AccordionSummary>
            {label(row)} — tous les champs publiés
          </AccordionSummary>
          <AccordionDetails>
            <PublishedDetail resource={resource} row={row} />
          </AccordionDetails>
        </Accordion>
      ))}
      {retry}
    </Stack>
  );
}
