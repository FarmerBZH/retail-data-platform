import { useEffect, useState } from "react";
import {
  Alert,
  Button,
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
} from "@mui/material";
import { ApiError } from "./read-api";
import type { Freshness } from "./read-api";
import type { ReadQueries } from "./read-queries";
import { periodQuery } from "./month-period";
import type { MonthPeriod } from "./month-period";
import {
  formatExact,
  formatMonth,
  formatPercent,
  formatPublicationTime,
} from "./exact-values";
import { monthlySale } from "./monthly-sales";
import {
  comparisonSummary,
  ComparisonConflictError,
  monthlyChange,
  referencePeriod,
} from "./sales-comparisons";
import type { ComparisonMode, salesVariation } from "./sales-comparisons";

type Props = {
  storeId: string;
  period: MonthPeriod;
  reads: Pick<ReadQueries, "collect" | "status">;
};
type State =
  | { phase: "idle" | "loading" }
  | { phase: "error"; message: string }
  | {
      phase: "ready";
      data: ReturnType<typeof comparisonSummary>;
      freshness: Freshness;
    };
const periodLabel = (period: MonthPeriod) =>
  `${formatMonth(period.from)} à ${formatMonth(period.to)}`;
const monthLabel = (month: string | undefined) =>
  month ? formatMonth(month) : "Hors calendrier pris en charge";
function deltaLabel(value: string | null) {
  const text = formatExact(value);
  return value !== null && text !== "0" && !text.startsWith("-")
    ? `+${text}`
    : text;
}
function Relative({
  variation,
}: {
  variation: ReturnType<typeof salesVariation>;
}) {
  return (
    <>
      {variation.base === "negative"
        ? "Non interprétée — base négative"
        : variation.base === "zero"
          ? "Indisponible — base nulle"
          : formatPercent(variation.relative)}
    </>
  );
}

export function SalesComparisons(props: Props) {
  const [mode, setMode] = useState<ComparisonMode>("previous");
  return (
    <Stack spacing={2} sx={{ mt: 3 }}>
      <Typography variant="h2">Comparaisons du CA observé</Typography>
      <Typography>
        Périmètre sélectionné : un seul magasin, {periodLabel(props.period)}.
        Univers produit observé, potentiellement différent entre périodes ;
        aucune garantie de CA exhaustif ou d’assortiment constant. Unité
        monétaire à confirmer ; devise et HT/TTC non confirmés.
      </Typography>
      <TextField
        select
        label="Référence de la fenêtre"
        value={mode}
        onChange={(event) =>
          setMode(event.target.value === "year" ? "year" : "previous")
        }
        slotProps={{ select: { native: true } }}
      >
        <option value="previous">
          Les {props.period.months} mois immédiatement précédents
        </option>
        <option value="year">La même période un an auparavant</option>
      </TextField>
      <ComparisonRead key={mode} {...props} mode={mode} />
    </Stack>
  );
}

function ComparisonRead({
  storeId,
  period,
  reads,
  mode,
}: Props & { mode: ComparisonMode }) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const [revision, setRevision] = useState(0);
  const reference = referencePeriod(period, mode);
  useEffect(() => {
    if (!revision) return;
    const controller = new AbortController();
    const options = { signal: controller.signal, refresh: true };
    void (async (): Promise<State> => {
      const before = await reads.status(options);
      if (before.state === "uninitialized")
        return {
          phase: "error",
          message:
            "Aucune publication analytique initialisée. Les comparaisons sont indisponibles.",
        };
      const changes = await reads.collect(
        "analytics_store_month_changes",
        { store_id: storeId, ...periodQuery(period), limit: 50 },
        monthlyChange,
        { ...options, maxPages: 5, maxItems: 120 },
      );
      if (!changes.complete)
        return {
          phase: "error",
          message:
            changes.reason === "freshness-changed"
              ? "La publication a changé pendant la lecture. Relisez les comparaisons."
              : "Lecture incomplète : aucune comparaison ne peut être confirmée. Relisez les comparaisons.",
        };
      const baseline = referencePeriod(period, mode);
      const referenceRows = baseline
        ? await reads.collect(
            "analytics_store_month",
            { store_id: storeId, ...periodQuery(baseline), limit: 50 },
            monthlySale,
            { ...options, maxPages: 5, maxItems: 120 },
          )
        : undefined;
      if (referenceRows && !referenceRows.complete)
        return {
          phase: "error",
          message:
            referenceRows.reason === "freshness-changed"
              ? "La publication a changé pendant la lecture. Relisez les comparaisons."
              : "Lecture incomplète : aucune comparaison ne peut être confirmée. Relisez les comparaisons.",
        };
      const after = await reads.status(options);
      if (JSON.stringify(before) !== JSON.stringify(after))
        return {
          phase: "error",
          message:
            "La publication a changé pendant la lecture. Relisez les comparaisons.",
        };
      return {
        phase: "ready",
        data: comparisonSummary(
          changes.items,
          referenceRows?.items ?? [],
          storeId,
          period,
          mode,
        ),
        freshness: after,
      };
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
                ? "Accès refusé aux comparaisons. Vérifiez vos droits auprès de la personne responsable de la plateforme."
                : error instanceof ComparisonConflictError
                  ? "Les montants publiés sont incohérents entre les mois ou collections. Relisez les comparaisons."
                  : "Les comparaisons n’ont pas pu être chargées. Réessayez.",
          });
      });
    return () => controller.abort();
  }, [storeId, period, reads, mode, revision]);
  return (
    <Stack spacing={2}>
      <Typography>
        Fenêtre courante : {periodLabel(period)} ({period.months} mois).
        Référence :{" "}
        {reference
          ? `${periodLabel(reference)} (${reference.months} mois)`
          : "hors calendrier pris en charge"}
        . Bornes incluses.
      </Typography>
      <Button
        variant="outlined"
        disabled={state.phase === "loading"}
        onClick={() => {
          setState({ phase: "loading" });
          setRevision((n) => n + 1);
        }}
      >
        {state.phase === "idle"
          ? "Charger les comparaisons"
          : "Relire les comparaisons"}
      </Button>
      {state.phase === "idle" && (
        <Typography>
          Chargement à la demande. Changer de référence efface les anciens
          résultats.
        </Typography>
      )}
      {state.phase === "loading" && (
        <Typography role="status" aria-busy="true">
          Chargement des comparaisons…
        </Typography>
      )}
      {state.phase === "error" && (
        <Alert severity="warning">{state.message}</Alert>
      )}
      {state.phase === "ready" && (
        <ComparisonResult data={state.data} freshness={state.freshness} />
      )}
    </Stack>
  );
}

function ComparisonResult({
  data,
  freshness,
}: {
  data: ReturnType<typeof comparisonSummary>;
  freshness: Freshness;
}) {
  return (
    <Stack spacing={2}>
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
        Les collections ne constituent pas un instantané garanti, y compris avec
        la synthèse affichée au-dessus.
      </Alert>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h3">
          Comparaison de fenêtres — périmètre sélectionné
        </Typography>
        <Typography>
          CA courant complet : {formatExact(data.window.current)}. CA de
          référence complet : {formatExact(data.window.reference)}.
        </Typography>
        <Typography>
          Couverture courante : {data.current.covered}/{data.current.expected}{" "}
          mois ; référence : {data.referenceTotal.covered}/
          {data.referenceTotal.expected} mois.
        </Typography>
        <Typography>
          Variation absolue de la fenêtre : {deltaLabel(data.window.absolute)}.
          Variation relative de la fenêtre :{" "}
          <Relative variation={data.window} />.
        </Typography>
        {!data.reference && (
          <Typography>
            La référence dépasse les bornes du calendrier ; aucune lecture de
            cette fenêtre n’a été lancée.
          </Typography>
        )}
        {(data.current.covered !== data.current.expected ||
          data.referenceTotal.covered !== data.referenceTotal.expected) && (
          <Alert severity="warning">
            Fenêtre incomplète : variation indisponible. Toutes les cellules des
            deux périodes sont requises.
          </Alert>
        )}
      </Paper>
      <Typography>
        Montants exacts ; divisions arrondies à six décimales avant conversion
        en pourcentage. Une base zéro ou manquante rend le pourcentage
        indisponible ; une base négative privilégie la variation absolue, sans
        interprétation du pourcentage. Aucune variation n’est présentée comme
        une amélioration automatique.
      </Typography>
      <TableContainer
        component={Paper}
        variant="outlined"
        role="region"
        tabIndex={0}
        aria-label="Comparaisons mensuelles exactes, défilement horizontal"
        sx={{ maxWidth: "100%" }}
      >
        <Table sx={{ minWidth: 1000 }}>
          <caption>
            CA observé — M-1 et N-1 calendaires, indépendants de la référence
            choisie pour la fenêtre. Mois absents distincts de zéro.
          </caption>
          <TableHead>
            <TableRow>
              <TableCell>Mois courant</TableCell>
              <TableCell align="right">CA courant</TableCell>
              <TableCell>Mois M-1</TableCell>
              <TableCell align="right">CA M-1</TableCell>
              <TableCell align="right">Variation absolue M-1</TableCell>
              <TableCell align="right">Variation relative M-1</TableCell>
              <TableCell>Mois N-1</TableCell>
              <TableCell align="right">CA N-1</TableCell>
              <TableCell align="right">Variation absolue N-1</TableCell>
              <TableCell align="right">Variation relative N-1</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.monthly.map((row) => (
              <TableRow key={row.month}>
                <TableCell component="th" scope="row">
                  {formatMonth(row.month)}
                  {row.missing && " — mois absent de la publication"}
                </TableCell>
                <TableCell align="right">
                  {formatExact(row.monthVariation.current)}
                </TableCell>
                <TableCell>{monthLabel(row.previousMonth)}</TableCell>
                <TableCell align="right">
                  {formatExact(row.monthVariation.reference)}
                </TableCell>
                <TableCell align="right">
                  {deltaLabel(row.monthVariation.absolute)}
                </TableCell>
                <TableCell align="right">
                  <Relative variation={row.monthVariation} />
                </TableCell>
                <TableCell>{monthLabel(row.previousYear)}</TableCell>
                <TableCell align="right">
                  {formatExact(row.yearVariation.reference)}
                </TableCell>
                <TableCell align="right">
                  {deltaLabel(row.yearVariation.absolute)}
                </TableCell>
                <TableCell align="right">
                  <Relative variation={row.yearVariation} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
