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
  TextField,
  Typography,
} from "@mui/material";
import type { ReadPage, ReadQueries } from "./read-queries";
import { ApiError } from "./read-api";
import type { Freshness, Query, Resource, ResourceName } from "./read-api";
import {
  availableResources,
  detailQuery,
  fieldLabel,
  filterQuery,
  matchesQuery,
  resourceGroup,
  resourceLabels,
  rowDecoder,
  rowKey,
} from "./published-data";
import type { PublishedRow } from "./published-data";
import { PublishedDetail } from "./PublishedDetail";

export type ExplorerReads = Pick<ReadQueries, "resources" | "page" | "status">;
function message(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "forbidden")
      return "Vous n’avez pas accès à cette collection.";
    if (error.code === "too-large")
      return "Une ligne dépasse la limite de réponse du service et ne peut pas être consultée.";
    if (error.code === "invalid-request")
      return "Le service a refusé les filtres ou le curseur. Vérifiez les filtres ou repartez de la première page.";
    if (error.code === "invalid-response")
      return "La réponse publiée ne respecte pas le contrat de consultation.";
  }
  return "Les données n’ont pas pu être chargées. Réessayez.";
}

export function DataExplorer({
  reads,
  storeId,
}: {
  reads: ExplorerReads;
  storeId?: string;
}) {
  const [catalog, setCatalog] = useState<readonly Resource[]>();
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<ResourceName>();
  const [returnTo, setReturnTo] = useState<ResourceName>();
  useEffect(() => {
    if (!selected && returnTo)
      document.getElementById(`collection-${returnTo}`)?.focus();
  }, [selected, returnTo]);
  useEffect(() => {
    const controller = new AbortController();
    void reads
      .resources({ signal: controller.signal, refresh: revision > 0 })
      .then(availableResources)
      .then((resources) => {
        if (!controller.signal.aborted) setCatalog(resources);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [reads, revision]);
  const resource = catalog?.find((entry) => entry.name === selected);
  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <Typography variant={storeId ? "h2" : "h1"}>Données publiées</Typography>
      <Typography>
        Consultation au grain natif, sans total global. Le catalogue détermine
        les collections et filtres disponibles. Les audits opérationnels seront
        proposés dans Qualité.
      </Typography>
      {storeId && (
        <Typography>
          Les collections acceptant le filtre magasin sont limitées à ce
          magasin. Les autres restent globales.
        </Typography>
      )}
      {!catalog && !failed && (
        <Typography role="status">Chargement du catalogue…</Typography>
      )}
      {failed && (
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              onClick={() => {
                setFailed(false);
                setRevision((n) => n + 1);
              }}
            >
              Réessayer
            </Button>
          }
        >
          Le catalogue n’a pas pu être chargé.
        </Alert>
      )}
      {catalog && !catalog.length && (
        <Typography>Aucune collection disponible.</Typography>
      )}
      {resource ? (
        <>
          <Button onClick={() => setSelected(undefined)}>
            Retour aux collections
          </Button>
          <CollectionExplorer
            key={`${resource.name}:${storeId ?? "global"}`}
            reads={reads}
            fixedQuery={
              storeId && resource.filters.includes("store_id")
                ? { store_id: storeId }
                : {}
            }
            resource={resource}
          />
        </>
      ) : (
        catalog &&
        ["Référentiels", "Observations", "Analyses mensuelles"].map((group) => (
          <Paper key={group} variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h2">{group}</Typography>
            <Stack sx={{ alignItems: "flex-start" }}>
              {catalog
                .filter((entry) => resourceGroup(entry.name) === group)
                .map((entry) => (
                  <Button
                    key={entry.name}
                    id={`collection-${entry.name}`}
                    onClick={() => {
                      setReturnTo(entry.name);
                      setSelected(entry.name);
                    }}
                  >
                    {resourceLabels[entry.name]}
                  </Button>
                ))}
            </Stack>
          </Paper>
        ))
      )}
    </Stack>
  );
}
type State =
  | { phase: "loading" }
  | { phase: "error"; message: string; request: string }
  | {
      phase: "ready";
      page: ReadPage<PublishedRow>;
      freshness: Freshness;
      request: string;
    };
export function CollectionExplorer({
  reads,
  resource,
  fixedQuery = {},
}: {
  reads: Pick<ReadQueries, "page" | "status">;
  resource: Resource;
  fixedQuery?: Query;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [query, setQuery] = useState<Query>(fixedQuery);
  const [validation, setValidation] = useState(false);
  const [position, setPosition] = useState({
    index: 0,
    cursors: [undefined] as (string | undefined)[],
  });
  const [opened, setOpened] = useState<PublishedRow>();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State>({ phase: "loading" });
  const heading = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<string | undefined>(undefined);
  useEffect(() => {
    heading.current?.focus();
  }, [resource.name]);
  const decode = useMemo(() => rowDecoder(resource), [resource]);
  const after = position.cursors[position.index];
  const request = JSON.stringify([
    query,
    after,
    opened ? rowKey(resource, opened) : null,
    revision,
  ]);
  const current =
    state.phase !== "loading" && state.request === request
      ? state
      : { phase: "loading" as const };
  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal, refresh: true };
    void (async () => {
      const before = await reads.status(options);
      if (
        resource.name.startsWith("analytics_") &&
        before.state === "uninitialized"
      )
        throw new Error("uninitialized");
      const page = await reads.page(
        resource.name,
        opened
          ? detailQuery(resource, opened)
          : { ...query, limit: 25, ...(after ? { after } : {}) },
        decode,
        options,
      );
      if (
        page.items.some(
          (row) =>
            !matchesQuery(
              resource,
              row,
              opened ? detailQuery(resource, opened) : query,
            ),
        )
      )
        throw new ApiError("invalid-response");
      const keys = page.items.map((row) => rowKey(resource, row));
      if (
        new Set(keys).size !== keys.length ||
        (page.nextCursor !== null &&
          (!page.nextCursor ||
            !page.items.length ||
            position.cursors
              .slice(0, position.index + 1)
              .includes(page.nextCursor))) ||
        (opened &&
          (page.nextCursor !== null ||
            page.items.length > 1 ||
            (page.items.length === 1 && keys[0] !== rowKey(resource, opened))))
      )
        throw new ApiError("invalid-response");
      const freshness = await reads.status(options);
      if (JSON.stringify(before) !== JSON.stringify(freshness))
        throw new Error("changed");
      if (!controller.signal.aborted)
        setState({ phase: "ready", request, page, freshness });
    })().catch((error: unknown) => {
      if (!controller.signal.aborted)
        setState({
          phase: "error",
          request,
          message:
            error instanceof Error && error.message === "changed"
              ? "La publication a changé. Rechargez les données."
              : error instanceof Error && error.message === "uninitialized"
                ? "Les analyses ne sont pas initialisées."
                : message(error),
        });
    });
    return () => controller.abort();
  }, [
    reads,
    resource,
    decode,
    query,
    after,
    opened,
    revision,
    request,
    position.cursors,
    position.index,
  ]);
  useEffect(() => {
    if (current.phase === "ready" && returnTo.current && !opened) {
      (document.getElementById(returnTo.current) ?? heading.current)?.focus();
      returnTo.current = undefined;
    }
  }, [current.phase, opened]);
  const page = current.phase === "ready" ? current.page : undefined;
  const filters = resource.filters
    .filter((field) => !Object.hasOwn(fixedQuery, field))
    .flatMap((field) =>
      field === "period" ? ["period_from", "period_to"] : [field],
    );
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Typography variant="h2" tabIndex={-1} ref={heading}>
        {resourceLabels[resource.name]}
      </Typography>
      <Box component="details">
        <Box component="summary" sx={{ cursor: "pointer", py: 1 }}>
          Description de la collection
        </Box>
        <Typography sx={{ overflowWrap: "anywhere" }}>
          Collection : {resource.name}. Route : {resource.path}. Clé complète :{" "}
          {resource.keys.join(", ")}. Champs : {resource.columns.join(", ")}.
          Filtres autorisés : {resource.filters.join(", ")}.
        </Typography>
      </Box>
      <Typography>
        Les pages et fiches ne forment pas un instantané garanti. Une fiche est
        relue à la demande ; les références sources vivantes ne constituent pas
        une preuve historique immuable. Devise, HT/TTC et unités physiques non
        confirmés.
      </Typography>
      {!opened && (
        <Box
          component="form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const applied = {
                ...filterQuery(resource, draft),
                ...fixedQuery,
              };
              setQuery(applied);
              setPosition({ index: 0, cursors: [undefined] });
              setRevision((n) => n + 1);
              setValidation(false);
            } catch {
              setValidation(true);
            }
          }}
        >
          <Stack
            direction="row"
            useFlexGap
            sx={{ flexWrap: "wrap" }}
            spacing={2}
          >
            {filters.map((key) => (
              <TextField
                key={key}
                label={
                  key === "period_from"
                    ? "Mois de début"
                    : key === "period_to"
                      ? "Mois de fin"
                      : `${fieldLabel(key)} (${key})`
                }
                type={key.startsWith("period_") ? "month" : "text"}
                value={draft[key] ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, [key]: event.target.value })
                }
                slotProps={{
                  inputLabel: { shrink: true },
                  htmlInput: key.startsWith("period_")
                    ? { min: "0001-01", max: "9999-12" }
                    : {},
                }}
                sx={{ maxWidth: "100%" }}
              />
            ))}
            <Button type="submit" variant="outlined">
              Appliquer les filtres
            </Button>
          </Stack>
          {validation && (
            <Alert severity="error">
              Filtres invalides : vérifiez les identifiants et les mois.
            </Alert>
          )}
          <Typography sx={{ overflowWrap: "anywhere" }}>
            Filtres appliqués :{" "}
            {Object.entries(query)
              .filter(([key]) => key !== "limit" && key !== "after")
              .map(([key, value]) => `${fieldLabel(key)} : ${value}`)
              .join(" ; ") || "aucun"}
            .
          </Typography>
        </Box>
      )}
      {opened && (
        <Button onClick={() => setOpened(undefined)}>
          Retour à la page de collection
        </Button>
      )}
      {current.phase === "loading" && (
        <Typography role="status" aria-busy="true">
          Chargement des données…
        </Typography>
      )}
      {current.phase === "error" && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" onClick={() => setRevision((n) => n + 1)}>
              Réessayer
            </Button>
          }
        >
          {current.message}
        </Alert>
      )}
      {current.phase === "ready" && (
        <Typography role="status">
          {current.freshness.state === "stale"
            ? "Publication périmée"
            : "Fraîcheur analytique"}{" "}
          :{" "}
          {current.freshness.lastCompletedAt ?? "aucune publication analytique"}
          . Dernière tentative :{" "}
          {current.freshness.lastAttemptStatus ?? "indisponible"}.
        </Typography>
      )}
      {page && !page.items.length && (
        <Typography>
          {opened
            ? "Cette ligne n’est plus disponible."
            : "Aucune ligne pour ces filtres."}
        </Typography>
      )}
      {page && opened && page.items[0] && (
        <PublishedDetail resource={resource} row={page.items[0]} />
      )}
      {!opened && position.index > 0 && current.phase === "error" && (
        <Button
          onClick={() => {
            setPosition({ index: 0, cursors: [undefined] });
            setRevision((n) => n + 1);
          }}
        >
          Recharger depuis la première page
        </Button>
      )}
      {page && !opened && (
        <>
          <TableContainer
            component={Paper}
            variant="outlined"
            role="region"
            aria-label="Lignes de la collection"
            tabIndex={0}
            sx={{ maxWidth: "100%" }}
          >
            <Table>
              <caption>
                Page {position.index + 1}, {page.items.length} lignes ; ordre du
                service, aucun total global.
              </caption>
              <TableHead>
                <TableRow>
                  {resource.keys.map((key) => (
                    <TableCell key={key}>
                      {fieldLabel(key)} ({key})
                    </TableCell>
                  ))}
                  <TableCell>Détail</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {page.items.map((row, index) => (
                  <TableRow key={rowKey(resource, row)}>
                    {resource.keys.map((key) => (
                      <TableCell key={key} sx={{ overflowWrap: "anywhere" }}>
                        {String(row[key])}
                      </TableCell>
                    ))}
                    <TableCell>
                      <Button
                        id={`published-row-${resource.name}-${rowKey(resource, row)}`}
                        aria-label={`Ouvrir la ligne ${index + 1}`}
                        onClick={() => {
                          returnTo.current = `published-row-${resource.name}-${rowKey(resource, row)}`;
                          setOpened(row);
                          heading.current?.focus();
                        }}
                      >
                        Ouvrir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Stack direction="row" spacing={2}>
            <Button
              disabled={position.index === 0}
              onClick={() =>
                setPosition({ ...position, index: position.index - 1 })
              }
            >
              Page précédente
            </Button>
            <Button
              disabled={!page.nextCursor}
              onClick={() => {
                const cursor = page.nextCursor;
                if (cursor)
                  setPosition({
                    index: position.index + 1,
                    cursors: [
                      ...position.cursors.slice(0, position.index + 1),
                      cursor,
                    ],
                  });
              }}
            >
              Page suivante
            </Button>
          </Stack>
          <Button
            onClick={() => {
              setPosition({ index: 0, cursors: [undefined] });
              setRevision((n) => n + 1);
            }}
          >
            Recharger depuis la première page
          </Button>
        </>
      )}
    </Stack>
  );
}
