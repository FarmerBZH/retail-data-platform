import { useEffect, useState } from "react";
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
import type { ReadQueries, ReadOptions, Collection } from "./read-queries";
import type { ResourceName, Query } from "./read-api";
import { ApiError } from "./read-api";
import type { Decoder } from "./api-validation";
import type { Freshness } from "./read-api";
import type { MonthPeriod } from "./month-period";
import { periodQuery } from "./month-period";
import {
  formatExact,
  formatMonth,
  formatPublicationTime,
} from "./exact-values";
import {
  monthlySale,
  monthlyGrid,
  monthlySummary,
  measures,
} from "./monthly-sales";
import type { MonthlySale, MonthCell } from "./monthly-sales";

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | ({ phase: "ready"; grid: MonthCell[]; freshness: Freshness } & ReturnType<
      typeof monthlySummary
    >);
const formatCount = (value: number | null | undefined) =>
  formatExact(value == null ? null : String(value));
const labels = {
  revenue: "CA observé",
  units: "Unités vendues",
  calls: "Appels",
  field_visits: "Visites terrain",
  crowdsourced_visits: "Visites participatives",
};
export function MonthlySales({
  storeId,
  period,
  reads,
}: {
  storeId: string;
  period: MonthPeriod;
  reads: {
    status: ReadQueries["status"];
    collect: (
      name: ResourceName,
      query: Query,
      decode: Decoder<MonthlySale>,
      options?: ReadOptions & { maxItems?: number; maxPages?: number },
    ) => Promise<Collection<MonthlySale>>;
  };
}) {
  const theme = useTheme();
  const smallScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [state, setState] = useState<State>({ phase: "loading" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal, refresh: true };
    void (async () => {
      const before = await reads.status(options);
      if (before.state === "uninitialized")
        return {
          phase: "error",
          message:
            "Aucune publication analytique initialisée. Les indicateurs mensuels sont indisponibles.",
        } as const;
      const result = await reads.collect(
        "analytics_store_month",
        { store_id: storeId, ...periodQuery(period), limit: 50 },
        monthlySale,
        { ...options, maxItems: 120, maxPages: 5 },
      );
      if (!result.complete)
        return {
          phase: "error",
          message:
            result.reason === "freshness-changed"
              ? "La publication a changé pendant la lecture. Relisez la période."
              : "Lecture incomplète : aucun indicateur ni mois absent ne peut être confirmé. Réessayez.",
        } as const;
      const after = await reads.status(options);
      if (JSON.stringify(before) !== JSON.stringify(after))
        return {
          phase: "error",
          message:
            "La publication a changé pendant la lecture. Relisez la période.",
        } as const;
      const grid = monthlyGrid(result.items, storeId, period);
      return {
        phase: "ready",
        grid,
        ...monthlySummary(grid),
        freshness: after,
      } as const;
    })()
      .then((result) => {
        if (!controller.signal.aborted) setState(result);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            phase: "error",
            message:
              error instanceof ApiError && error.code === "forbidden"
                ? "Accès refusé à la synthèse mensuelle. Vérifiez vos droits auprès de la personne responsable de la plateforme."
                : "La synthèse mensuelle n’a pas pu être chargée. Réessayez.",
          });
      });
    return () => controller.abort();
  }, [reads, storeId, period, revision]);
  if (state.phase === "loading")
    return (
      <Typography role="status" aria-busy="true">
        Chargement de la synthèse mensuelle…
      </Typography>
    );
  const retry = (
    <Button
      onClick={() => {
        setState({ phase: "loading" });
        setRevision((n) => n + 1);
      }}
    >
      Relire la période
    </Button>
  );
  if (state.phase === "error")
    return (
      <Alert severity="warning" action={retry}>
        {state.message}
      </Alert>
    );
  const { grid, freshness, totals, unitRevenue, geometry } = state;
  const revenueTotal = totals[0]!;
  const partialRevenue = revenueTotal.covered < revenueTotal.expected;
  const hasGeometry = geometry.some((v) => v !== null);
  return (
    <Stack spacing={2}>
      <Typography variant="h2">Synthèse mensuelle</Typography>
      <Typography>
        {formatMonth(period.from)} à {formatMonth(period.to)}, bornes incluses.
        Unité monétaire à confirmer ; devise et HT/TTC non confirmés. Univers
        produit observé uniquement, sans garantie de CA exhaustif.
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
          `Publication réussie : ${formatPublicationTime(freshness.lastCompletedAt)}.`}{" "}
        {freshness.lastAttemptStatus === "failed" &&
          "La dernière mise à jour a échoué ; la publication précédente reste consultable."}{" "}
        Les pages ne constituent pas un instantané garanti.
      </Alert>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: {
            xs: "minmax(0, 1fr)",
            sm: "repeat(2, minmax(0, 1fr))",
            lg: "repeat(4, minmax(0, 1fr))",
          },
        }}
      >
        {totals.map((total) => {
          const { measure } = total;
          return (
            <Paper key={measure} variant="outlined" sx={{ p: 2, minWidth: 0 }}>
              <Typography variant="h3">
                {labels[measure]}{" "}
                {total.covered < total.expected
                  ? "— partiel"
                  : "— complet sur les mois choisis"}
              </Typography>
              <Typography
                sx={{
                  fontSize: { xs: "1.75rem", sm: "2rem" },
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  overflowWrap: "anywhere",
                }}
              >
                {formatExact(total.value)}
              </Typography>
              <Typography>
                Couverture : {total.covered}/{total.expected} mois avec valeur.{" "}
                {measure === "units" &&
                  "Unités déclarées, pas des volumes physiques."}
              </Typography>
            </Paper>
          );
        })}
      </Box>
      <Typography>
        CA par unité : {formatExact(unitRevenue)}. Division arrondie à 6
        décimales ; mêmes mois complets pour CA et unités requis, base nulle
        indisponible. Les activités sont séparées.
      </Typography>
      {grid.every(
        ({ row }) => !row || measures.every((measure) => row[measure] === null),
      ) && (
        <Alert severity="info">
          Aucune mesure disponible pour les mois choisis. Modifiez les filtres
          pour examiner une autre période.
        </Alert>
      )}
      <Typography id="sales-chart-help">
        Courbe du CA observé
        {partialRevenue
          ? " — série partielle"
          : " — série complète sur les mois choisis"}
        . Couverture : {revenueTotal.covered}/{revenueTotal.expected} mois avec
        valeur. Points marqués, segments droits et trous sans interpolation ;
        coordonnées de tracé approximatives. Le tableau fournit les valeurs
        exactes et les diagnostics.
      </Typography>
      {hasGeometry ? (
        <Box sx={{ minWidth: 0 }}>
          <LineChart
            height={smallScreen ? 240 : 320}
            skipAnimation
            xAxis={[
              {
                scaleType: "point",
                data: grid.map(({ month }) => month),
                valueFormatter: formatMonth,
              },
            ]}
            series={[
              {
                id: "revenue",
                label: partialRevenue
                  ? "CA observé — série partielle"
                  : "CA observé",
                color: theme.palette.primary.main,
                curve: "linear",
                showMark: true,
                data: geometry,
                connectNulls: false,
                valueFormatter: (_value, { dataIndex }) =>
                  `${formatExact(grid[dataIndex]?.row?.revenue ?? null)} · unité monétaire à confirmer · couverture ${grid[dataIndex]?.row?.revenue != null ? 1 : 0}/1 mois`,
              },
            ]}
            aria-label="CA observé mensuel, valeurs exactes dans le tableau"
            aria-describedby="sales-chart-help"
          />
        </Box>
      ) : (
        <Typography>
          Aucun point traçable. Les valeurs exactes restent consultables dans le
          tableau.
        </Typography>
      )}
      <TableContainer
        component={Paper}
        variant="outlined"
        tabIndex={0}
        role="region"
        aria-label="Valeurs mensuelles exactes, défilement horizontal"
        sx={{ maxWidth: "100%" }}
      >
        <Table sx={{ minWidth: 1100 }}>
          <caption>
            Valeurs exactes — univers observé ; mois sans valeur distincts de
            zéro. Les diagnostics rapportés sont toujours partiels.
          </caption>
          <TableHead>
            <TableRow>
              <TableCell>Mois</TableCell>
              {measures.map((m) => (
                <TableCell key={m} align="right">
                  {labels[m]}
                </TableCell>
              ))}
              <TableCell>Ventes observées</TableCell>
              <TableCell align="right">Produits ambigus</TableCell>
              <TableCell align="right">Produits avec CA / observés</TableCell>
              <TableCell align="right">
                CA non ambigu rapporté — partiel
              </TableCell>
              <TableCell align="right">
                Unités non ambiguës rapportées — partiel
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {grid.map(({ month, row }) => (
              <TableRow key={month}>
                <TableCell component="th" scope="row">
                  {formatMonth(month)}
                  {!row && " — mois absent de la publication"}
                </TableCell>
                {measures.map((m) => (
                  <TableCell key={m} align="right">
                    {formatExact(row?.[m] ?? null)}
                  </TableCell>
                ))}
                <TableCell>
                  {row ? (row.hasRegister ? "Oui" : "Non") : "Indisponible"}
                </TableCell>
                <TableCell align="right">
                  {formatCount(row?.ambiguous)}
                </TableCell>
                <TableCell align="right">
                  {formatCount(row?.revenueProducts)} /{" "}
                  {formatCount(row?.products)}
                </TableCell>
                <TableCell align="right">
                  {formatExact(row?.reportedRevenue ?? null)}
                </TableCell>
                <TableCell align="right">
                  {formatExact(row?.reportedUnits ?? null)} (
                  {formatCount(row?.unitsProducts)} /{" "}
                  {formatCount(row?.products)} produits)
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {grid.some(
        ({ row }, i) =>
          row?.revenue !== null &&
          row?.revenue !== undefined &&
          geometry[i] === null,
      ) && (
        <Alert severity="warning">
          Certaines valeurs dépassent les capacités du tracé. Consultez leurs
          valeurs exactes dans le tableau.
        </Alert>
      )}
      {retry}
    </Stack>
  );
}
