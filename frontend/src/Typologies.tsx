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
} from "@mui/material";
import { ApiError } from "./read-api";
import type { Freshness, Resource, ResourceName } from "./read-api";
import type { ReadOptions, ReadQueries } from "./read-queries";
import type { PublishedRow } from "./published-data";
import {
  availableResources,
  fieldLabel,
  resourceLabels,
  rowDecoder,
  rowKey,
} from "./published-data";
import { PublishedDetail, PublishedValue } from "./PublishedDetail";
import { publishedContract } from "./published-contract";
import { calendarMonths, periodQuery } from "./month-period";
import type { MonthPeriod } from "./month-period";
import { formatMonth, formatPublicationTime } from "./exact-values";
import {
  typologyCalendar,
  typologyConflict,
  typologyDecoder,
  typologyLinks,
  typologyNames,
  typologyResource,
  verifyTypologyLink,
} from "./typology-data";
import type { TypologyLink, TypologyName } from "./typology-data";
export type TypologyReads = Pick<
  ReadQueries,
  "resources" | "status" | "collect" | "page"
>;
class BlockError extends Error {}
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
              error instanceof BlockError
                ? error.message
                : error instanceof ApiError && error.code === "forbidden"
                  ? "Accès refusé à ce bloc."
                  : error instanceof ApiError && error.code === "too-large"
                    ? "Une ligne dépasse la limite de réponse du service."
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
function supported(
  catalog: readonly Resource[],
  name: ResourceName,
  filters: string[],
) {
  const expected = typologyResource(name),
    actual = catalog.find((r) => r.name === name);
  if (
    !actual ||
    filters.some((f) => !actual.filters.includes(f)) ||
    expected.columns.some((c) => !actual.columns.includes(c))
  )
    throw new BlockError("Le catalogue ne permet pas cette consultation.");
  return expected;
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
export function Typologies({
  storeId,
  period,
  reads,
}: {
  storeId: string;
  period: MonthPeriod;
  reads: TypologyReads;
}) {
  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <Typography variant="h2">Typologies et assortiments</Typography>
      <Typography>
        {formatMonth(period.from)} à {formatMonth(period.to)}, bornes incluses.
        Les valeurs appartiennent à leur mois observé, sans report vers un mois
        absent. Candidats exacts et contexte enseigne restent séparés. Ni une
        absence ni un nombre de lignes ne prouvent la conformité ou une liste de
        produits obligatoires.
      </Typography>
      {typologyNames.map((name) => (
        <MonthlyBlock
          key={`${name}:${storeId}:${period.from}:${period.to}`}
          name={name}
          storeId={storeId}
          period={period}
          reads={reads}
        />
      ))}
    </Stack>
  );
}
const columns: Record<TypologyName, string[]> = {
  analytics_typology_month: [
    "period",
    "category_key",
    "category_name",
    "typology_value",
    "snapshot_id",
    "rank_candidate_count",
    "mapping_issue",
  ],
  analytics_assortment_candidates: [
    "period",
    "assortment_id",
    "product_id",
    "gtin",
    "typology_rank_rule_id",
  ],
  analytics_retailer_assortment_month: [
    "period",
    "assortment_id",
    "gtin",
    "product_match_status",
    "typology_match_status",
  ],
};
function MonthlyBlock({
  name,
  storeId,
  period,
  reads,
}: {
  name: TypologyName;
  storeId: string;
  period: MonthPeriod;
  reads: TypologyReads;
}) {
  const load = useMemo(
    () => async (options: ReadOptions) => {
      const catalog = availableResources(await reads.resources(options)),
        resource = supported(catalog, name, ["store_id", "period"]);
      const before = await reads.status(options);
      if (before.state === "uninitialized")
        throw new BlockError(
          "Aucune publication analytique initialisée. Ce bloc est indisponible.",
        );
      const result = await reads.collect(
        name,
        { store_id: storeId, ...periodQuery(period), limit: 100 },
        typologyDecoder(resource),
        { ...options, maxPages: 5, maxItems: 500 },
      );
      if (!result.complete)
        throw new BlockError(
          "Lecture incomplète : aucune valeur ni absence ne peut être confirmée. Réduisez la période ou consultez Données.",
        );
      const grid = typologyCalendar(resource, result.items, storeId, period);
      const after = await reads.status(options);
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw new BlockError("La publication a changé. Relisez ce bloc.");
      return { rows: result.items, grid, resource, catalog, freshness: after };
    },
    [name, storeId, period, reads],
  );
  const { state, retry } = useBlock(load);
  return (
    <Stack spacing={2}>
      <Typography variant="h2">{resourceLabels[name]}</Typography>
      {state.phase === "loading" && (
        <Typography role="status">
          Chargement de {resourceLabels[name]}…
        </Typography>
      )}
      {state.phase === "error" && (
        <Alert severity="warning">{state.message}</Alert>
      )}
      {state.phase === "ready" && (
        <>
          <Fresh value={state.value.freshness} />
          <Typography>
            Lecture complète : {state.value.rows.length} lignes,{" "}
            {state.value.grid.filter((c) => c.rows.length).length}/
            {calendarMonths(period).length} mois avec lignes. Ce nombre ne
            mesure pas la complétude métier ni des produits distincts.
          </Typography>
          <Typography>
            Mois sans ligne publiée :{" "}
            {state.value.grid
              .filter((c) => !c.rows.length)
              .map((c) => formatMonth(c.month))
              .join(", ") || "aucun"}
            . Aucun zéro, valeur reportée ou conformité déduits.
          </Typography>
          <Rows
            key={String(state.value.freshness.lastCompletedAt)}
            name={name}
            value={state.value}
            reads={reads}
          />
        </>
      )}
      <Button onClick={retry}>Relire {resourceLabels[name]}</Button>
    </Stack>
  );
}
function Rows({
  name,
  value,
  reads,
}: {
  name: TypologyName;
  value: {
    rows: readonly PublishedRow[];
    resource: Resource;
    catalog: readonly Resource[];
  };
  reads: TypologyReads;
}) {
  const [page, setPage] = useState(0),
    [opened, setOpened] = useState<PublishedRow>();
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!opened) trigger.current?.focus();
  }, [opened]);
  return (
    <Stack spacing={2}>
      <TableContainer
        component={Paper}
        variant="outlined"
        role="region"
        aria-label={resourceLabels[name]}
        tabIndex={0}
        sx={{ maxWidth: "100%" }}
      >
        <Table sx={{ minWidth: 720 }}>
          <caption>
            Page locale {page + 1} ; toutes les lignes du lot complet restent
            consultables. Sources contradictoires conservées sans gagnant
            arbitraire.
          </caption>
          <TableHead>
            <TableRow>
              {columns[name].map((c) => (
                <TableCell key={c}>{fieldLabel(c)}</TableCell>
              ))}
              <TableCell>Qualification</TableCell>
              <TableCell>Détail</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {value.rows.slice(page * 50, page * 50 + 50).map((row) => (
              <TableRow key={rowKey(value.resource, row)}>
                {columns[name].map((c) => (
                  <TableCell key={c} sx={{ overflowWrap: "anywhere" }}>
                    <PublishedValue
                      value={row[c]!}
                      node={publishedContract[name].fields[c]!}
                    />
                  </TableCell>
                ))}
                <TableCell>
                  {name === "analytics_typology_month" ? (
                    <>
                      {typologyConflict(row, value.rows) && (
                        <Typography>
                          Valeurs contradictoires pour le même mois/catégorie.
                        </Typography>
                      )}
                      {row.mapping_issue === true && (
                        <Typography>
                          Correspondance ambiguë ou erronée.
                        </Typography>
                      )}
                      {typeof row.rank_candidate_count === "number" &&
                        row.rank_candidate_count > 1 && (
                          <Typography>Plusieurs règles candidates.</Typography>
                        )}
                      Aucun rang choisi automatiquement.
                    </>
                  ) : name === "analytics_assortment_candidates" ? (
                    "Candidat exact publié ; aucune obligation déduite."
                  ) : (
                    "Contexte enseigne ; ne remplace pas un candidat exact."
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    aria-label={`Détail ${resourceLabels[name]}, ${rowKey(value.resource, row)}`}
                    onClick={(event) => {
                      trigger.current = event.currentTarget;
                      setOpened(row);
                    }}
                  >
                    Détail et liens
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Stack direction="row" spacing={1}>
        <Button
          disabled={page === 0}
          onClick={() => {
            setOpened(undefined);
            setPage((n) => n - 1);
          }}
        >
          Lignes précédentes
        </Button>
        <Button
          disabled={(page + 1) * 50 >= value.rows.length}
          onClick={() => {
            setOpened(undefined);
            setPage((n) => n + 1);
          }}
        >
          Lignes suivantes
        </Button>
      </Stack>
      {opened && (
        <Detail
          key={rowKey(value.resource, opened)}
          resource={value.resource}
          row={opened}
          catalog={value.catalog}
          reads={reads}
          close={() => setOpened(undefined)}
        />
      )}
    </Stack>
  );
}
function Detail({
  resource,
  row,
  catalog,
  reads,
  close,
}: {
  resource: Resource;
  row: PublishedRow;
  catalog: readonly Resource[];
  reads: TypologyReads;
  close: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <Stack spacing={2}>
      <Typography variant="h3" component="h3" tabIndex={-1} ref={heading}>
        Détail — {resourceLabels[resource.name]}
      </Typography>
      <Button onClick={close}>Fermer le détail typologies</Button>
      <PublishedDetail resource={resource} row={row} />
      <Typography>
        Références vivantes, à la demande ; elles peuvent changer ou disparaître
        et ne constituent pas une preuve historique immuable.
      </Typography>
      <Links
        name={resource.name}
        row={row}
        catalog={catalog}
        reads={reads}
        depth={0}
      />
    </Stack>
  );
}
function Links({
  name,
  row,
  catalog,
  reads,
  depth,
}: {
  name: ResourceName;
  row: PublishedRow;
  catalog: readonly Resource[];
  reads: TypologyReads;
  depth: number;
}) {
  const links = typologyLinks(name, row),
    [page, setPage] = useState(0),
    [opened, setOpened] = useState<TypologyLink>();
  const trigger = useRef<HTMLButtonElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!opened && trigger.current)
      (trigger.current.isConnected
        ? trigger.current
        : heading.current
      )?.focus();
  }, [opened]);
  return (
    <Stack spacing={1}>
      <Typography variant="h3" component="h3" tabIndex={-1} ref={heading}>
        Liens de consultation
      </Typography>
      <Box component="ul" sx={{ pl: 3 }}>
        {links.slice(page * 50, page * 50 + 50).map((link) => (
          <Box component="li" key={`${link.name}:${link.id}`}>
            <Button
              sx={{ overflowWrap: "anywhere", textAlign: "left" }}
              disabled={
                !catalog.some(
                  (r) =>
                    r.name === link.name &&
                    r.filters.includes("id") &&
                    typologyResource(link.name).columns.every((c) =>
                      r.columns.includes(c),
                    ),
                )
              }
              onClick={(event) => {
                trigger.current = event.currentTarget;
                setOpened(link);
              }}
            >
              Consulter {resourceLabels[link.name]} : {link.id}
            </Button>
          </Box>
        ))}
      </Box>
      {links.length > 50 && (
        <Stack direction="row" spacing={1}>
          <Button disabled={page === 0} onClick={() => setPage((n) => n - 1)}>
            Liens précédents
          </Button>
          <Button
            disabled={(page + 1) * 50 >= links.length}
            onClick={() => setPage((n) => n + 1)}
          >
            Liens suivants
          </Button>
        </Stack>
      )}
      {!links.length && (
        <Typography>Aucun identifiant de référence consultable.</Typography>
      )}
      {opened && (
        <Live
          key={`${opened.name}:${opened.id}`}
          link={opened}
          reads={reads}
          depth={depth}
          close={() => setOpened(undefined)}
        />
      )}
    </Stack>
  );
}
function Live({
  link,
  reads,
  depth,
  close,
}: {
  link: TypologyLink;
  reads: TypologyReads;
  depth: number;
  close: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const load = useMemo(
    () => async (options: ReadOptions) => {
      const catalog = availableResources(await reads.resources(options)),
        resource = supported(catalog, link.name, ["id"]);
      const before = await reads.status(options);
      if (before.state === "uninitialized")
        throw new BlockError(
          "Aucune publication analytique initialisée. Cette référence ne peut pas être vérifiée.",
        );
      const result = await reads.page(
        link.name,
        { id: link.id, limit: 2 },
        rowDecoder(resource),
        options,
      );
      if (result.nextCursor !== null || result.items.length > 1)
        throw new Error("Invalid response");
      const source = result.items[0];
      if (source) verifyTypologyLink(link, source);
      const after = await reads.status(options);
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw new BlockError(
          "La publication a changé. Relisez cette référence.",
        );
      return { source, resource, catalog, freshness: after };
    },
    [link, reads],
  );
  const { state, retry } = useBlock(load);
  return (
    <Stack spacing={2}>
      <Typography variant="h3" component="h3" tabIndex={-1} ref={heading}>
        Référence vivante — {resourceLabels[link.name]}
      </Typography>
      <Button onClick={close}>Fermer la référence</Button>
      {state.phase === "loading" && (
        <Typography role="status">Chargement de la référence…</Typography>
      )}
      {state.phase === "error" && (
        <Alert severity="warning">{state.message}</Alert>
      )}
      {state.phase === "ready" && (
        <>
          <Fresh value={state.value.freshness} />
          {state.value.source ? (
            <>
              <PublishedDetail
                resource={state.value.resource}
                row={state.value.source}
              />
              {depth < 1 && (
                <Links
                  name={link.name}
                  row={state.value.source}
                  catalog={state.value.catalog}
                  reads={reads}
                  depth={depth + 1}
                />
              )}
            </>
          ) : (
            <Typography>
              Référence absente ou supprimée ; la ligne publiée reste
              consultable.
            </Typography>
          )}
        </>
      )}
      <Button onClick={retry}>Relire la référence</Button>
    </Stack>
  );
}
