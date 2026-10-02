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
import { BarChart } from "@mui/x-charts/BarChart";
import { LineChart } from "@mui/x-charts/LineChart";
import { ApiError } from "./read-api";
import type { Freshness, Resource } from "./read-api";
import type {
  ReadQueries,
  ReadOptions,
  Collection,
  ReadPage,
} from "./read-queries";
import type { ResourceName, Query } from "./read-api";
import type { Decoder } from "./api-validation";
import { availableResources, matchesQuery, rowDecoder } from "./published-data";
import type { PublishedRow } from "./published-data";
import { PublishedDetail } from "./PublishedDetail";
import {
  formatExact,
  formatMonth,
  formatPublicationTime,
} from "./exact-values";
import { calendarMonths, periodQuery } from "./month-period";
import type { MonthPeriod } from "./month-period";
import {
  productSale,
  productRows,
  productGrid,
  productGeometry,
  productSalesResource,
} from "./product-sales";
import type { ProductSale } from "./product-sales";

export type ProductReads = Pick<ReadQueries, "resources" | "status"> & {
  page: (
    name: ResourceName,
    query: Query,
    decode: Decoder<PublishedRow>,
    options?: ReadOptions,
  ) => Promise<ReadPage<PublishedRow>>;
  collect: (
    name: ResourceName,
    query: Query,
    decode: Decoder<ProductSale>,
    options?: ReadOptions & { maxItems?: number; maxPages?: number },
  ) => Promise<Collection<ProductSale>>;
};
type State =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | {
      phase: "ready";
      rows: ProductSale[];
      catalog: readonly Resource[];
      freshness: Freshness;
    };
function failure(error: unknown) {
  if (error instanceof ApiError && error.code === "too-large")
    return "Une cellule dépasse la limite de réponse du service et ne peut pas être consultée.";
  return error instanceof ApiError && error.code === "forbidden"
    ? "Accès refusé aux ventes produit."
    : "Les ventes produit n’ont pas pu être chargées. Réessayez.";
}
export function ProductSales({
  storeId,
  period,
  reads,
}: {
  storeId: string;
  period: MonthPeriod;
  reads: ProductReads;
}) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal, refresh: true };
    void (async (): Promise<State> => {
      const catalog = availableResources(await reads.resources(options));
      const resource = catalog.find(
        (r) => r.name === productSalesResource.name,
      );
      if (
        !resource ||
        !["store_id", "period"].every((f) => resource.filters.includes(f)) ||
        productSalesResource.columns.some((f) => !resource.columns.includes(f))
      )
        return {
          phase: "error",
          message:
            "Le catalogue ne permet pas cette consultation des ventes produit.",
        };
      const before = await reads.status(options);
      if (before.state === "uninitialized")
        return {
          phase: "error",
          message:
            "Aucune publication analytique initialisée. Les ventes produit sont indisponibles.",
        };
      const result = await reads.collect(
        productSalesResource.name,
        { store_id: storeId, ...periodQuery(period), limit: 100 },
        productSale,
        { ...options, maxPages: 5, maxItems: 500 },
      );
      if (!result.complete)
        return {
          phase: "error",
          message:
            result.reason === "freshness-changed"
              ? "La publication a changé pendant la lecture. Relisez la période."
              : "Lecture incomplète : aucun tableau ou graphique produit ne peut être confirmé. Réduisez la période ou consultez la collection dans Données.",
        };
      const after = await reads.status(options);
      if (JSON.stringify(before) !== JSON.stringify(after))
        return {
          phase: "error",
          message:
            "La publication a changé pendant la lecture. Relisez la période.",
        };
      return {
        phase: "ready",
        rows: productRows(result.items, storeId, period),
        catalog,
        freshness: after,
      };
    })()
      .then((result) => {
        if (!controller.signal.aborted) setState(result);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({ phase: "error", message: failure(error) });
      });
    return () => controller.abort();
  }, [reads, storeId, period, revision]);
  const retry = (
    <Button
      onClick={() => {
        setState({ phase: "loading" });
        setRevision((n) => n + 1);
      }}
    >
      Relire les ventes produit
    </Button>
  );
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Typography variant="h2">Ventes et produits</Typography>
      <Typography>
        {formatMonth(period.from)} à {formatMonth(period.to)}, bornes incluses.
        Grain magasin/mois/GTIN source, univers observé uniquement. Unité
        monétaire à confirmer ; devise et HT/TTC non confirmés. Les unités
        déclarées ne sont pas des volumes physiques. Aucun total de volumes
        entre produits, aucun total magasin calculé ici.
      </Typography>
      {state.phase === "loading" && (
        <Typography role="status" aria-busy="true">
          Chargement des ventes produit…
        </Typography>
      )}
      {state.phase === "error" && (
        <Alert severity="warning" action={retry}>
          {state.message}
        </Alert>
      )}
      {state.phase === "ready" && (
        <>
          <Alert
            severity={
              state.freshness.state === "stale" ||
              state.freshness.lastAttemptStatus === "failed"
                ? "warning"
                : "info"
            }
          >
            {state.freshness.state === "stale"
              ? "Publication ancienne."
              : "Publication à jour lors de la lecture."}{" "}
            {state.freshness.lastCompletedAt &&
              `Publication réussie : ${formatPublicationTime(state.freshness.lastCompletedAt)}.`}{" "}
            {state.freshness.lastAttemptStatus === "failed" &&
              "La dernière mise à jour a échoué."}{" "}
            Les pages ne constituent pas un instantané garanti ; le référentiel
            et les observations vivants peuvent avoir changé.
          </Alert>
          {state.rows.length ? (
            <ProductViews
              key={revision}
              rows={state.rows}
              catalog={state.catalog}
              period={period}
              reads={reads}
            />
          ) : (
            <Typography>
              Aucune observation de ventes pour cette période. Ce résultat ne
              signifie pas zéro vente.
            </Typography>
          )}
          {retry}
        </>
      )}
    </Stack>
  );
}

function ProductViews({
  rows,
  catalog,
  period,
  reads,
}: {
  rows: ProductSale[];
  catalog: readonly Resource[];
  period: MonthPeriod;
  reads: ProductReads;
}) {
  const theme = useTheme();
  const small = useMediaQuery(theme.breakpoints.down("sm"));
  const [month, setMonth] = useState(period.from);
  const [barPage, setBarPage] = useState(0);
  const [page, setPage] = useState(0);
  const [gtin, setGtin] = useState<string>();
  const [opened, setOpened] = useState<ProductSale>();
  const table = useRef<HTMLDivElement>(null);
  const returnTo = useRef<string>(undefined);
  useEffect(() => {
    if (!opened && returnTo.current)
      (document.getElementById(returnTo.current) ?? table.current)?.focus();
  }, [opened]);
  const monthRows = rows.filter((r) => r.period === `${month}-01`);
  const bars = monthRows.slice(barPage * 20, barPage * 20 + 20);
  const geometry = productGeometry(bars.map((r) => r.revenue));
  const grid = gtin === undefined ? [] : productGrid(rows, gtin, period);
  const line = productGeometry(grid.map((c) => c.row?.revenue ?? null));
  const covered = grid.filter((c) => c.row?.revenue != null).length;
  const controls = (
    index: number,
    count: number,
    update: (n: number) => void,
    label: string,
    size: number,
  ) => (
    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
      <Button
        disabled={index === 0}
        onClick={() => update(index - 1)}
        aria-label={`${label} : page précédente`}
      >
        Précédente
      </Button>
      <Typography>
        Page {index + 1} / {Math.max(1, Math.ceil(count / size))}
      </Typography>
      <Button
        disabled={(index + 1) * size >= count}
        onClick={() => update(index + 1)}
        aria-label={`${label} : page suivante`}
      >
        Suivante
      </Button>
    </Stack>
  );
  return (
    <Stack spacing={2}>
      <Typography>
        {rows.length} cellules publiées sur la période. Les GTIN source non
        rapprochés restent distincts ; leur identité réelle n’est pas présumée.
        Les données du référentiel produit sont actuelles.
      </Typography>
      <TextField
        select
        label="Mois des barres"
        value={month}
        onChange={(e) => {
          setMonth(e.target.value);
          setBarPage(0);
        }}
        sx={{ maxWidth: 320 }}
      >
        {calendarMonths(period).map((m) => (
          <MenuItem key={m} value={m}>
            {formatMonth(m)}
          </MenuItem>
        ))}
      </TextField>
      <Typography id="product-bars-help">
        CA par GTIN source — {formatMonth(month)}. Périmètre explicite :
        cellules {monthRows.length ? barPage * 20 + 1 : 0} à{" "}
        {Math.min((barPage + 1) * 20, monthRows.length)} sur {monthRows.length}{" "}
        du mois, ordre GTIN, aucun classement global. Valeurs non nulles :{" "}
        {bars.filter((r) => r.revenue !== null).length}/{bars.length}. Origine
        zéro commune, négatifs conservés ; table exacte ci-dessous.
      </Typography>
      {geometry.some((v) => v !== null) ? (
        <Box sx={{ minWidth: 0 }}>
          <BarChart
            layout="horizontal"
            skipAnimation
            height={Math.max(240, bars.length * 38 + 90)}
            yAxis={[
              { scaleType: "band", data: bars.map((r) => r.source_gtin) },
            ]}
            series={[
              {
                id: "product-revenue",
                label: `CA par GTIN — univers observé${bars.some((r) => r.revenue === null) ? " — partiel" : ""}`,
                color: theme.palette.primary.main,
                data: geometry,
                valueFormatter: (_v, { dataIndex }) =>
                  `${formatExact(bars[dataIndex]?.revenue ?? null)} · unité monétaire à confirmer · ${bars[dataIndex]?.revenue != null ? 1 : 0}/1 cellule`,
              },
            ]}
            aria-label="CA par GTIN source, barres mensuelles"
            aria-describedby="product-bars-help"
          />
        </Box>
      ) : (
        <Typography>Aucun CA traçable pour ce périmètre de barres.</Typography>
      )}
      {bars.some((r, i) => r.revenue !== null && geometry[i] === null) && (
        <Alert severity="warning">
          Certaines valeurs dépassent les capacités du tracé. Consultez le
          tableau exact.
        </Alert>
      )}
      {controls(barPage, monthRows.length, setBarPage, "Barres", 20)}
      <TableContainer
        ref={table}
        component={Paper}
        variant="outlined"
        role="region"
        tabIndex={0}
        aria-label="Ventes par GTIN et mois, valeurs exactes"
        sx={{ maxWidth: "100%" }}
      >
        <Table sx={{ minWidth: 1000 }}>
          <caption>
            Ventes produit exactes — {rows.length} cellules ; page {page + 1},
            ordre mois/GTIN. Volumes de chaque cellule uniquement, unités
            physiques inconnues.
          </caption>
          <TableHead>
            <TableRow>
              {[
                "Mois",
                "GTIN source",
                "Lien produit à la publication",
                "CA observé",
                "Unités déclarées",
                "Volume — unité inconnue",
                "Qualité",
                "Actions",
              ].map((t) => (
                <TableCell key={t}>{t}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.slice(page * 25, page * 25 + 25).map((row) => (
              <TableRow key={JSON.stringify([row.period, row.source_gtin])}>
                <TableCell component="th" scope="row">
                  {formatMonth(row.period.slice(0, 7))}
                </TableCell>
                <TableCell>{row.source_gtin || "GTIN vide"}</TableCell>
                <TableCell sx={{ overflowWrap: "anywhere" }}>
                  {row.product_id ?? "Lien produit indisponible"}
                </TableCell>
                <TableCell align="right">{formatExact(row.revenue)}</TableCell>
                <TableCell align="right">
                  {formatExact(row.units === null ? null : String(row.units))}
                </TableCell>
                <TableCell align="right">{formatExact(row.volume)}</TableCell>
                <TableCell>
                  Ambiguïté :{" "}
                  {row.ambiguous === null
                    ? "Indisponible"
                    : row.ambiguous
                      ? "Oui"
                      : "Non"}
                  . CA renseigné : {row.revenue_reported_rows ?? "Indisponible"}
                  /{row.source_row_count ?? "Indisponible"} lignes. Unités
                  renseignées : {row.units_reported_rows ?? "Indisponible"}/
                  {row.source_row_count ?? "Indisponible"}. Non rapprochées :{" "}
                  {row.unmatched_product_rows ?? "Indisponible"}.
                </TableCell>
                <TableCell>
                  <Button
                    onClick={() => setGtin(row.source_gtin)}
                    aria-label={`Courbe GTIN ${row.source_gtin}`}
                  >
                    Courbe
                  </Button>
                  <Button
                    id={`product-detail-${JSON.stringify([row.period, row.source_gtin])}`}
                    onClick={() => {
                      returnTo.current = `product-detail-${JSON.stringify([row.period, row.source_gtin])}`;
                      setOpened(row);
                    }}
                    aria-label={`Détail GTIN ${row.source_gtin}, ${row.period.slice(0, 7)}`}
                  >
                    Détail et preuves
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {controls(page, rows.length, setPage, "Tableau produit", 25)}
      {gtin !== undefined && (
        <>
          <Typography variant="h3">
            Courbe du GTIN source {gtin || "vide"}
          </Typography>
          <Typography id="product-line-help">
            CA observé —{" "}
            {covered < grid.length
              ? "série partielle"
              : "valeurs disponibles sur tous les mois choisis"}
            . Couverture : {covered}/{grid.length} mois avec valeur. Trous sans
            interpolation ; absence de cellule distincte de zéro, aucune
            continuité du référentiel produit présumée. Géométrie approximative,
            valeurs exactes dans le tableau.
          </Typography>
          {line.some((v) => v !== null) && (
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
              series={[
                {
                  id: "gtin-revenue",
                  label: `GTIN ${gtin} — CA${covered < grid.length ? " partiel" : ""}`,
                  data: line,
                  color: theme.palette.primary.main,
                  curve: "linear",
                  showMark: true,
                  connectNulls: false,
                  valueFormatter: (_v, { dataIndex }) =>
                    `${formatExact(grid[dataIndex]?.row?.revenue ?? null)} · unité monétaire à confirmer · ${grid[dataIndex]?.row?.revenue != null ? 1 : 0}/1 mois`,
                },
              ]}
              aria-label="CA mensuel du GTIN sélectionné"
              aria-describedby="product-line-help"
            />
          )}
          {grid.some((c, i) => c.row?.revenue != null && line[i] === null) && (
            <Alert severity="warning">
              Certaines valeurs dépassent les capacités du tracé.
            </Alert>
          )}
          <TableContainer
            component={Paper}
            variant="outlined"
            role="region"
            tabIndex={0}
            aria-label="Courbe produit, tableau exact"
            sx={{ maxWidth: "100%" }}
          >
            <Table>
              <caption>Calendrier complet du GTIN source sélectionné</caption>
              <TableHead>
                <TableRow>
                  <TableCell>Mois</TableCell>
                  <TableCell>CA exact</TableCell>
                  <TableCell>État</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {grid.map((c) => (
                  <TableRow key={c.month}>
                    <TableCell component="th" scope="row">
                      {formatMonth(c.month)}
                    </TableCell>
                    <TableCell>{formatExact(c.row?.revenue ?? null)}</TableCell>
                    <TableCell>
                      {!c.row
                        ? "Cellule absente de la publication"
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
      {opened && (
        <SaleEvidence
          key={JSON.stringify([opened.period, opened.source_gtin])}
          row={opened}
          catalog={catalog}
          reads={reads}
          close={() => setOpened(undefined)}
        />
      )}
    </Stack>
  );
}

function SaleEvidence({
  row,
  catalog,
  reads,
  close,
}: {
  row: ProductSale;
  catalog: readonly Resource[];
  reads: ProductReads;
  close: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const [target, setTarget] = useState<{ resource: Resource; id: string }>();
  const proofTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!target && proofTrigger.current) {
      (proofTrigger.current.isConnected
        ? proofTrigger.current
        : heading.current
      )?.focus();
    }
  }, [target]);
  const [page, setPage] = useState(0);
  const observation = catalog.find(
    (r) => r.name === "register_observations" && r.filters.includes("id"),
  );
  const product = catalog.find(
    (r) => r.name === "products" && r.filters.includes("id"),
  );
  const ids = row.observation_ids;
  return (
    <Stack spacing={2}>
      <Typography variant="h3" component="h3" ref={heading} tabIndex={-1}>
        Détail et preuves — GTIN {row.source_gtin}
      </Typography>
      <Button onClick={close}>Fermer le détail produit</Button>
      <Typography>
        Cellule de la publication consultée. Les observations sources et le
        référentiel produit sont vivants ; ils peuvent avoir changé ou disparu
        et ne constituent pas une preuve historique immuable.
      </Typography>
      <PublishedDetail resource={productSalesResource} row={row} />
      {row.product_id && product && (
        <Button
          onClick={(event) => {
            proofTrigger.current = event.currentTarget;
            setTarget({ resource: product, id: row.product_id! });
          }}
        >
          Consulter le produit actuel
        </Button>
      )}
      {row.product_id && !product && (
        <Typography>
          Consultation du produit actuel non disponible au catalogue.
        </Typography>
      )}
      <Typography variant="h3">Observations sources à la demande</Typography>
      {ids === null ? (
        <Typography>Identifiants indisponibles.</Typography>
      ) : ids.length === 0 ? (
        <Typography>Aucune observation liée.</Typography>
      ) : observation ? (
        <>
          <Box component="ul" sx={{ pl: 3 }}>
            {ids.slice(page * 50, page * 50 + 50).map((id, index) => (
              <Box component="li" key={`${id}:${index}`}>
                <Button
                  sx={{ overflowWrap: "anywhere", textAlign: "left" }}
                  onClick={(event) => {
                    proofTrigger.current = event.currentTarget;
                    setTarget({ resource: observation, id });
                  }}
                >
                  Consulter l’observation {id}
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
      ) : (
        <Typography>
          Consultation des observations non disponible au catalogue.
        </Typography>
      )}
      {target && (
        <LiveEvidence
          key={`${target.resource.name}:${target.id}`}
          resource={target.resource}
          id={target.id}
          sale={row}
          reads={reads}
          close={() => setTarget(undefined)}
        />
      )}
    </Stack>
  );
}

function LiveEvidence({
  resource,
  id,
  sale,
  reads,
  close,
}: {
  resource: Resource;
  id: string;
  sale: ProductSale;
  reads: ProductReads;
  close: () => void;
}) {
  const decode = useMemo(() => rowDecoder(resource), [resource]);
  const [state, setState] = useState<
    | { phase: "loading" }
    | { phase: "error"; message: string }
    | { phase: "ready"; row: PublishedRow | undefined; freshness: Freshness }
  >({ phase: "loading" });
  const [revision, setRevision] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal, refresh: true };
    void (async () => {
      const before = await reads.status(options);
      const result = await reads.page(
        resource.name,
        { id, limit: 2 },
        decode,
        options,
      );
      const row = result.items[0];
      if (
        result.nextCursor !== null ||
        result.items.length > 1 ||
        (row && !matchesQuery(resource, row, { id }))
      )
        throw new ApiError("invalid-response");
      if (
        row &&
        resource.name === "register_observations" &&
        (row.store_id !== sale.store_id ||
          row.period !== sale.period ||
          row.source_gtin !== sale.source_gtin)
      )
        throw new ApiError("invalid-response");
      const after = await reads.status(options);
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw new ApiError("invalid-response");
      if (!controller.signal.aborted)
        setState({ phase: "ready", row, freshness: after });
    })().catch((error: unknown) => {
      if (!controller.signal.aborted)
        setState({
          phase: "error",
          message:
            error instanceof ApiError && error.code === "forbidden"
              ? "Accès refusé à cette preuve."
              : "Cette preuve n’a pas pu être vérifiée. Elle peut avoir changé ; réessayez.",
        });
    });
    return () => controller.abort();
  }, [reads, resource, id, sale, decode, revision]);
  return (
    <Stack spacing={2}>
      <Typography variant="h3" component="h3" ref={heading} tabIndex={-1}>
        Consultation{" "}
        {resource.name === "products"
          ? "du produit actuel"
          : "de l’observation source"}
      </Typography>
      <Button onClick={close}>Fermer la preuve</Button>
      {state.phase === "loading" && (
        <Typography role="status">Chargement de la preuve…</Typography>
      )}
      {state.phase === "error" && (
        <Alert
          severity="warning"
          action={
            <Button
              onClick={() => {
                setState({ phase: "loading" });
                setRevision((n) => n + 1);
              }}
            >
              Réessayer la preuve
            </Button>
          }
        >
          {state.message}
        </Alert>
      )}
      {state.phase === "ready" && (
        <>
          <Typography>
            Référentiel/source vivant, indépendant de la publication consultée.
            Fraîcheur analytique : {state.freshness.state}. Aucun instantané
            historique garanti.
          </Typography>
          {state.row ? (
            <PublishedDetail resource={resource} row={state.row} />
          ) : (
            <Typography>
              Cette ligne n’est plus disponible dans la source vivante.
            </Typography>
          )}
        </>
      )}
    </Stack>
  );
}
