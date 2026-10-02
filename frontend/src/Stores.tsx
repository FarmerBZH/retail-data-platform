import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { storeSummary } from "./api-validation";
import type { StoreSummary } from "./api-validation";
import { ApiError } from "./read-api";
import type { ReadQueries } from "./read-queries";
import type { ReadPage } from "./read-queries";

type Reads = Pick<ReadQueries, "page">;
type State =
  | { phase: "loading" }
  | { phase: "error"; message: string; request: string }
  | { phase: "ready"; page: ReadPage<StoreSummary>; request: string };

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "forbidden")
      return "Vous n’avez pas accès à ces magasins.";
    if (error.code === "too-large")
      return "La réponse dépasse la limite de lecture du service.";
    if (error.code === "invalid-response")
      return "La réponse du service ne peut pas être utilisée.";
  }
  return "Les magasins n’ont pas pu être chargés. Réessayez.";
}
const label = (store: StoreSummary) => store.name ?? "Nom indisponible";
const value = (text: string | null) => text ?? "Indisponible";

export function StoreList({ reads }: { reads: Reads }) {
  const [position, setPosition] = useState({
    index: 0,
    cursors: [undefined] as (string | undefined)[],
  });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [opened, setOpened] = useState<string>();
  const [sort, setSort] = useState("api");
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State>({ phase: "loading" });
  const heading = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<string | undefined>(undefined);
  const cursor = position.cursors[position.index];
  const request = `${opened ? `detail:${opened}` : `page:${cursor ?? ""}`}:${revision}`;
  const current =
    state.phase !== "loading" && state.request === request
      ? state
      : { phase: "loading" as const };

  useEffect(() => {
    const controller = new AbortController();
    void reads
      .page(
        "stores",
        opened
          ? { id: opened, limit: 1 }
          : { limit: 25, ...(cursor ? { after: cursor } : {}) },
        storeSummary,
        {
          signal: controller.signal,
          refresh: revision > 0 || opened !== undefined,
        },
      )
      .then((page) => {
        if (controller.signal.aborted) return;
        if (
          new Set(page.items.map((item) => item.id)).size !==
            page.items.length ||
          (opened !== undefined &&
            (page.nextCursor !== null ||
              page.items.some((item) => item.id !== opened))) ||
          (page.nextCursor !== null &&
            (!page.nextCursor ||
              !page.items.length ||
              position.cursors
                .slice(0, position.index + 1)
                .includes(page.nextCursor)))
        )
          throw new ApiError("invalid-response");
        setState({ phase: "ready", page, request });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({ phase: "error", message: errorMessage(error), request });
      });
    return () => controller.abort();
  }, [
    reads,
    cursor,
    opened,
    revision,
    position.cursors,
    position.index,
    request,
  ]);

  useEffect(() => {
    if (state.phase !== "ready" || state.request !== request) return;
    if (returnTo.current && opened === undefined) {
      (
        document.getElementById(`open-${returnTo.current}`) ?? heading.current
      )?.focus();
      returnTo.current = undefined;
    }
  }, [opened, state, request]);

  function open(id: string) {
    returnTo.current = id;
    setOpened(id);
    heading.current?.focus();
  }
  const page = current.phase === "ready" ? current.page : undefined;
  const items = [...(page?.items ?? [])];
  if (sort !== "api")
    items.sort((a, b) => {
      const order =
        label(a).localeCompare(label(b), "fr") || a.id.localeCompare(b.id);
      return sort === "asc" ? order : -order;
    });
  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <Typography variant="h1" ref={heading} tabIndex={-1}>
        {opened ? "Magasin" : "Magasins"}
      </Typography>
      <Typography color="text.secondary">
        Référentiel actuel : les attributs ne décrivent pas l’historique des
        magasins. Les pages ne constituent pas un instantané garanti.
      </Typography>
      <Typography role="status">
        {selected.size} magasin{selected.size > 1 ? "s" : ""} sélectionné
        {selected.size > 1 ? "s" : ""}
      </Typography>
      {!selected.size && (
        <Typography>
          Sélection vide. Aucun périmètre « tous les magasins » n’est appliqué.
        </Typography>
      )}
      <Button
        variant="outlined"
        disabled={!selected.size}
        onClick={() => setSelected(new Set())}
        sx={{ alignSelf: "flex-start" }}
      >
        Vider la sélection
      </Button>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <Button disabled>Vue réseau</Button>
          <Button disabled>Comparer la sélection</Button>
        </Stack>
        <Typography variant="body2">
          Les analyses réseau et la comparaison nécessitent des agrégations
          serveur encore indisponibles.
        </Typography>
      </Paper>
      {opened && (
        <Button
          variant="outlined"
          onClick={() => setOpened(undefined)}
          sx={{ alignSelf: "flex-start" }}
        >
          Retour aux magasins
        </Button>
      )}
      {current.phase === "loading" && (
        <Typography role="status" aria-busy="true">
          Chargement des magasins…
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
      {page &&
        opened &&
        (page.items[0] ? (
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Stack spacing={2}>
              <Typography variant="h2">{label(page.items[0])}</Typography>
              <Typography>
                Enseigne actuelle : {value(page.items[0].retailerName)}
              </Typography>
              <Typography>
                Ville actuelle : {value(page.items[0].city)}
              </Typography>
              <Typography>
                Statut actuel : {page.items[0].isActive ? "Actif" : "Inactif"}
              </Typography>
              <Box component="details">
                <Box component="summary">Identité du magasin</Box>
                <Typography sx={{ overflowWrap: "anywhere" }}>
                  {page.items[0].id}
                </Typography>
              </Box>
              <Typography color="text.secondary">
                Le référentiel complet et les analyses mensuelles seront
                disponibles dans une prochaine étape.
              </Typography>
            </Stack>
          </Paper>
        ) : (
          <Alert severity="info">
            Ce magasin n’est plus disponible dans le référentiel actuel.
          </Alert>
        ))}
      {page && !opened && (
        <>
          <FormControl sx={{ width: "100%", maxWidth: 320 }}>
            <InputLabel id="page-sort">Trier cette page</InputLabel>
            <Select
              labelId="page-sort"
              label="Trier cette page"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <MenuItem value="api">Ordre du service</MenuItem>
              <MenuItem value="asc">Nom croissant</MenuItem>
              <MenuItem value="desc">Nom décroissant</MenuItem>
            </Select>
          </FormControl>
          {!items.length ? (
            <Alert severity="info">Aucun magasin sur cette page.</Alert>
          ) : (
            <TableContainer
              component={Paper}
              variant="outlined"
              tabIndex={0}
              role="region"
              aria-label="Liste des magasins, défilement horizontal"
              sx={{ maxWidth: "100%" }}
            >
              <Table sx={{ minWidth: 640, tableLayout: "fixed" }}>
                <caption>
                  Attributs actuels — page {position.index + 1} ; {items.length}{" "}
                  ligne{items.length !== 1 ? "s" : ""}. Aucun total réseau
                  disponible.
                </caption>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 64 }}>Choix</TableCell>
                    <TableCell sx={{ width: "36%" }}>Magasin</TableCell>
                    <TableCell>Enseigne actuelle</TableCell>
                    <TableCell>Ville actuelle</TableCell>
                    <TableCell>Statut actuel</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((store) => (
                    <TableRow key={store.id} selected={selected.has(store.id)}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(store.id)}
                          slotProps={{
                            input: {
                              "aria-label": `Sélectionner ${label(store)}`,
                            },
                          }}
                          onChange={() =>
                            setSelected((previous) => {
                              const next = new Set(previous);
                              if (next.has(store.id)) next.delete(store.id);
                              else next.add(store.id);
                              return next;
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          id={`open-${store.id}`}
                          onClick={() => open(store.id)}
                          sx={{
                            textAlign: "left",
                            justifyContent: "flex-start",
                            overflowWrap: "anywhere",
                            maxWidth: "100%",
                          }}
                        >
                          {label(store)}
                        </Button>
                      </TableCell>
                      <TableCell>{value(store.retailerName)}</TableCell>
                      <TableCell>{value(store.city)}</TableCell>
                      <TableCell>
                        <Chip
                          label={store.isActive ? "Actif" : "Inactif"}
                          size="small"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}
      {!opened && (
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: "center", flexWrap: "wrap" }}
          useFlexGap
        >
          <Button
            disabled={position.index === 0}
            onClick={() => setPosition((p) => ({ ...p, index: p.index - 1 }))}
          >
            Page précédente
          </Button>
          <Typography>Page {position.index + 1}</Typography>
          <Button
            disabled={!page || page.nextCursor === null}
            onClick={() => {
              const nextCursor = page?.nextCursor;
              if (!nextCursor) return;
              setPosition((p) => ({
                index: p.index + 1,
                cursors: [...p.cursors.slice(0, p.index + 1), nextCursor],
              }));
            }}
          >
            Page suivante
          </Button>
        </Stack>
      )}
    </Stack>
  );
}
