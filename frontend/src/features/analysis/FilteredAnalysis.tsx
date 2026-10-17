import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import type { AnalysisQuery, AnalysisStore } from "../../api/analysis-contract";
import { analysisParameters } from "../../api/analysis-contract";
import type { ReadQueries } from "../../api/read-queries";
import { draftFilters } from "./analysis-state";
import type { AnalysisState } from "./analysis-state";
import { useAnalysis } from "./use-analysis";
import { validatePeriod, shiftMonth } from "../../shared/month-period";
import { AnalysisResults } from "./AnalysisResults";
import { StoreDetail } from "../stores/StoreDetail";
import { storeHeader } from "../../api/api-validation";
import type { StoreHeader } from "../../api/api-validation";
import type { StoreContext } from "../../shared/month-period";

export function FilteredAnalysis({
  reads,
  state,
  onState,
}: {
  reads: ReadQueries;
  state: AnalysisState;
  onState: Dispatch<SetStateAction<AnalysisState>>;
}) {
  const [changed, setChanged] = useState(false);
  const conflict = useCallback(() => setChanged(true), []);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState<AnalysisStore>();
  const [storeContext, setStoreContext] = useState<StoreContext>({
    from: "",
    to: "",
    tab: 0,
  });
  const [header, setHeader] = useState<StoreHeader>();
  const [detailError, setDetailError] = useState("");
  const detailAbort = useRef<AbortController | undefined>(undefined);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const detailHistory = useRef(false);
  const closeDetail = useCallback(() => {
    detailAbort.current?.abort();
    setOpened(undefined);
    setHeader(undefined);
    requestAnimationFrame(() => trigger.current?.focus());
  }, []);
  useEffect(() => {
    const pop = () => {
      if (detailHistory.current) {
        detailHistory.current = false;
        closeDetail();
      }
    };
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      detailAbort.current?.abort();
      if (
        detailHistory.current &&
        window.history.state?.analysisDetail === true
      )
        window.history.replaceState(null, "");
      detailHistory.current = false;
    };
  }, [closeDetail]);
  const update = <K extends keyof AnalysisState>(
    key: K,
    value: AnalysisState[K],
  ) => onState((previous) => ({ ...previous, [key]: value }));
  // Initial unpinned discovery obtains a publication; subsequent reads require it.
  const bootstrap = useAnalysis(
    reads,
    "availability",
    changed
      ? undefined
      : { ...(state.publication ? { publication_id: state.publication } : {}) },
    conflict,
  );
  const pub = state.publication ?? bootstrap.data?.context.publication_id;
  const filters = draftFilters(state);
  const query: AnalysisQuery = {
    ...filters,
    ...(pub ? { publication_id: pub } : {}),
  };
  function open(store: AnalysisStore, button: HTMLButtonElement) {
    detailAbort.current?.abort();
    const c = new AbortController();
    detailAbort.current = c;
    trigger.current = button;
    setHeader(undefined);
    setDetailError("");
    if (!detailHistory.current) {
      window.history.pushState({ analysisDetail: true }, "");
      detailHistory.current = true;
    }
    setOpened(store);
    const p = state.applied;
    const checked = validatePeriod(
      p?.period_from?.slice(0, 7) ?? "",
      p?.period_to?.slice(0, 7) ?? "",
    );
    setStoreContext({
      from: checked.valid ? checked.period.from : "",
      to: checked.valid ? checked.period.to : "",
      ...(checked.valid ? { applied: checked.period } : {}),
      tab: 0,
    });
    void reads
      .page("stores", { id: store.store_id, limit: 1 }, storeHeader, {
        signal: c.signal,
        refresh: true,
      })
      .then((page) => {
        if (!c.signal.aborted) {
          if (page.items[0]) setHeader(page.items[0]);
          else
            setDetailError(
              "Ce magasin n’est plus disponible dans le référentiel actuel.",
            );
        }
      })
      .catch(() => {
        if (!c.signal.aborted)
          setDetailError("La fiche magasin n’a pas pu être chargée.");
      });
  }
  function back() {
    if (detailHistory.current) window.history.back();
    else closeDetail();
  }
  return (
    <Stack spacing={3}>
      {opened && (
        <Stack spacing={2}>
          <Button onClick={back}>Retour à l’analyse filtrée</Button>
          <Typography variant="h1">Fiche magasin</Typography>
          <Alert severity="info">
            La fiche unitaire utilise les collections existantes, sans garantie
            de publication commune avec l’analyse. La période et la sélection
            restent conservées au retour.
          </Alert>
          {detailError ? (
            <Alert severity="warning">{detailError}</Alert>
          ) : header ? (
            <StoreDetail
              store={header}
              reads={reads}
              context={storeContext}
              onContext={setStoreContext}
            />
          ) : (
            <Typography role="status">Chargement de la fiche…</Typography>
          )}
        </Stack>
      )}
      <Box hidden={Boolean(opened)}>
        <Stack spacing={3}>
          <Typography variant="h1">Analyse réseau filtrée</Typography>
          <Typography>
            Ventes observées, unité monétaire et HT/TTC non confirmés. Les
            filtres portent sur le référentiel à la publication ; ils ne
            reconstituent pas un historique économique constant.
          </Typography>
          {changed ? (
            <Alert
              severity="warning"
              action={
                <Button
                  onClick={() => {
                    setChanged(false);
                    bootstrap.retry();
                    onState((previous) => {
                      const copy = { ...previous, applied: null };
                      delete copy.publication;
                      return copy;
                    });
                  }}
                >
                  Relire le contexte
                </Button>
              }
            >
              La publication a changé. Les résultats dépendants ont été retirés.
              Relisez le contexte avant de réappliquer vos filtres.
            </Alert>
          ) : bootstrap.error ? (
            <Alert
              severity="warning"
              action={<Button onClick={bootstrap.retry}>Réessayer</Button>}
            >
              {bootstrap.error}
            </Alert>
          ) : !pub ? (
            <Typography role="status">Chargement de la publication…</Typography>
          ) : (
            <>
              <Typography>
                Contexte de lecture publié. Les modifications ci-dessous sont
                des brouillons jusqu’à « Appliquer l’analyse ».
              </Typography>
              <Box
                component="form"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  const checked = validatePeriod(state.from, state.to);
                  if (!checked.valid) {
                    setError(checked.message);
                    return;
                  }
                  const applied: AnalysisQuery = {
                    ...filters,
                    scope: state.scope,
                    ...(state.scope === "selection"
                      ? { store_ids: state.selected.map((s) => s.store_id) }
                      : {}),
                    period_from: `${state.from}-01`,
                    period_to: `${state.to}-01`,
                    comparison: state.comparison,
                  };
                  try {
                    analysisParameters("summary", applied);
                  } catch {
                    setError(
                      state.scope === "selection" && !state.selected.length
                        ? "Sélection vide : choisissez au moins un magasin ou explicitement tous les magasins."
                        : "Vérifiez les filtres et les bornes de référence.",
                    );
                    return;
                  }
                  setError("");
                  onState((previous) => ({
                    ...previous,
                    publication: pub,
                    applied: { ...applied },
                    revision: previous.revision + 1,
                  }));
                }}
              >
                <Stack spacing={2}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={2}
                    useFlexGap
                    sx={{ flexWrap: "wrap" }}
                  >
                    <TextField
                      label="Début de l’analyse"
                      type="month"
                      value={state.from}
                      onChange={(e) => update("from", e.target.value)}
                      slotProps={{ inputLabel: { shrink: true } }}
                    />
                    <TextField
                      label="Fin de l’analyse"
                      type="month"
                      value={state.to}
                      onChange={(e) => update("to", e.target.value)}
                      slotProps={{ inputLabel: { shrink: true } }}
                    />
                    <TextField
                      label="Période de référence"
                      select
                      value={state.comparison}
                      onChange={(e) =>
                        update(
                          "comparison",
                          e.target.value as AnalysisState["comparison"],
                        )
                      }
                    >
                      <MenuItem value="previous">Période précédente</MenuItem>
                      <MenuItem value="previous_year">
                        Année précédente
                      </MenuItem>
                    </TextField>
                  </Stack>
                  {bootstrap.data?.items.find((d) => d.dataset === "register")
                    ?.last_period && (
                    <Button
                      onClick={() => {
                        const bounds = bootstrap.data!.items.find(
                          (d) => d.dataset === "register",
                        )!;
                        const end = bounds.last_period!.slice(0, 7);
                        const start =
                          shiftMonth(end, -11) ??
                          bounds.first_period!.slice(0, 7);
                        onState((p) => ({
                          ...p,
                          from:
                            start < bounds.first_period!.slice(0, 7)
                              ? bounds.first_period!.slice(0, 7)
                              : start,
                          to: end,
                        }));
                      }}
                    >
                      Choisir les 12 derniers mois observés
                    </Button>
                  )}
                  <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                    {(
                      ["retailer_name", "region_code", "store_format"] as const
                    ).map((field) => (
                      <DimensionPicker
                        key={field}
                        reads={reads}
                        field={field}
                        value={state[field]}
                        query={query}
                        onChange={(v) => update(field, v)}
                        onConflict={conflict}
                      />
                    ))}
                    <TextField
                      label="Statut des magasins"
                      select
                      value={state.activity_status}
                      onChange={(e) =>
                        update(
                          "activity_status",
                          e.target.value as AnalysisState["activity_status"],
                        )
                      }
                    >
                      <MenuItem value="all">Tous les statuts</MenuItem>
                      <MenuItem value="active">Actifs</MenuItem>
                      <MenuItem value="inactive">Inactifs</MenuItem>
                    </TextField>
                  </Stack>
                  <TextField
                    label="Périmètre"
                    select
                    value={state.scope}
                    onChange={(e) =>
                      update("scope", e.target.value as AnalysisState["scope"])
                    }
                  >
                    <MenuItem value="all">Tous les magasins filtrés</MenuItem>
                    <MenuItem value="selection">Sélection explicite</MenuItem>
                  </TextField>
                  <Typography>
                    {state.selected.length} magasins sélectionnés — maximum 100.
                    Les filtres s’appliquent à l’intersection de la sélection.
                    Une sélection vide ne signifie jamais tous.
                  </Typography>
                  <Stack
                    direction="row"
                    useFlexGap
                    sx={{ flexWrap: "wrap", gap: 1 }}
                  >
                    {state.selected.map((s) => (
                      <Chip
                        key={s.store_id}
                        label={s.name ?? s.store_id}
                        onDelete={() =>
                          update(
                            "selected",
                            state.selected.filter(
                              (v) => v.store_id !== s.store_id,
                            ),
                          )
                        }
                      />
                    ))}
                  </Stack>
                  <StoreSearch
                    reads={reads}
                    query={query}
                    selected={state.selected}
                    onSelect={(store) =>
                      onState((p) => ({
                        ...p,
                        scope: "selection",
                        selected: p.selected.some(
                          (s) => s.store_id === store.store_id,
                        )
                          ? p.selected.filter(
                              (s) => s.store_id !== store.store_id,
                            )
                          : p.selected.length < 100
                            ? [...p.selected, store]
                            : p.selected,
                      }))
                    }
                    onConflict={conflict}
                  />
                  {error && <Alert severity="warning">{error}</Alert>}
                  <Button variant="contained" type="submit">
                    Appliquer l’analyse
                  </Button>
                </Stack>
              </Box>
              <Tabs
                value={state.tab}
                onChange={(_, tab: AnalysisState["tab"]) => update("tab", tab)}
                variant="scrollable"
                allowScrollButtonsMobile
                aria-label="Lectures de l’analyse filtrée"
              >
                <Tab value="summary" label="Synthèse filtrée" />
                <Tab value="ranking" label="Classement" />
                <Tab value="compare" label="Comparer les magasins" />
              </Tabs>
              {state.applied ? (
                <AnalysisResults
                  key={`${state.revision}:${JSON.stringify(state.applied)}`}
                  reads={reads}
                  query={{ ...state.applied, publication_id: pub }}
                  tab={state.tab}
                  cohort={state.cohort}
                  onCohort={(v) => update("cohort", v)}
                  onConflict={conflict}
                  onOpen={open}
                />
              ) : (
                <Alert severity="info">
                  Choisissez une période et appliquez les filtres pour lire les
                  résultats.
                </Alert>
              )}
            </>
          )}
        </Stack>
      </Box>
    </Stack>
  );
}
const dimensionLabels = {
  retailer_name: "Enseigne publiée",
  region_code: "Région publiée",
  store_format: "Format publié",
};
function DimensionPicker({
  reads,
  field,
  value,
  query,
  onChange,
  onConflict,
}: {
  reads: ReadQueries;
  field: keyof typeof dimensionLabels;
  value: string | null;
  query: AnalysisQuery;
  onChange: (v: string | null) => void;
  onConflict: () => void;
}) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState<string>();
  const own = { ...query };
  delete own[field];
  const key = JSON.stringify([own, q]);
  const [position, setPosition] = useState(key);
  const cursor = position === key ? page : undefined;
  const result = useAnalysis(
    reads,
    "dimensions",
    {
      ...own,
      dimension: field,
      limit: 20,
      ...(q ? { q } : {}),
      ...(cursor ? { after: cursor } : {}),
    },
    onConflict,
  );
  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 0, flex: 1 }}>
      <Stack spacing={1}>
        <TextField
          label={dimensionLabels[field]}
          select
          value={value === null ? "" : JSON.stringify(value)}
          onChange={(e) =>
            onChange(
              e.target.value === ""
                ? null
                : (JSON.parse(e.target.value) as string),
            )
          }
        >
          <MenuItem value="">Toutes les valeurs</MenuItem>
          {value !== null &&
            !result.data?.items.some((item) => item.value === value) && (
              <MenuItem value={JSON.stringify(value)}>
                {value === "" ? "Texte vide" : value}
              </MenuItem>
            )}
          {result.data?.items.map((item) => (
            <MenuItem value={JSON.stringify(item.value)} key={item.value}>
              {item.value === "" ? "Texte vide" : item.value}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label={`Rechercher — ${dimensionLabels[field]}`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button
          onClick={() => {
            setQ(search);
            setPage(undefined);
          }}
        >
          Chercher des options
        </Button>
        {result.error ? (
          <Alert
            severity="warning"
            action={<Button onClick={result.retry}>Réessayer</Button>}
          >
            {result.error}
          </Alert>
        ) : result.data ? (
          <Typography variant="body2">
            {result.data.missing_store_count} magasins sans cette dimension.
            Options sur cette page uniquement.
          </Typography>
        ) : (
          <Typography role="status">Chargement des options…</Typography>
        )}
        {result.data?.next_cursor && (
          <Button
            onClick={() => {
              setPosition(key);
              setPage(result.data!.next_cursor!);
            }}
          >
            Autres options — {dimensionLabels[field]}
          </Button>
        )}
        {cursor && (
          <Button onClick={() => setPage(undefined)}>
            Premières options — {dimensionLabels[field]}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
function StoreSearch({
  reads,
  query,
  selected,
  onSelect,
  onConflict,
}: {
  reads: ReadQueries;
  query: AnalysisQuery;
  selected: AnalysisStore[];
  onSelect: (s: AnalysisStore) => void;
  onConflict: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [after, setAfter] = useState<string>();
  const context = JSON.stringify([query, q]);
  const [position, setPosition] = useState(context);
  const cursor = position === context ? after : undefined;
  const result = useAnalysis(
    reads,
    "stores",
    {
      ...query,
      limit: 10,
      ...(q ? { q } : {}),
      ...(cursor ? { after: cursor } : {}),
    },
    onConflict,
  );
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography variant="h2">
          Trouver et sélectionner des magasins
        </Typography>
        <TextField
          label="Recherche par nom ou ville"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          onClick={() => {
            setQ(draft);
            setAfter(undefined);
          }}
        >
          Rechercher les magasins
        </Button>
        {result.error ? (
          <Alert
            severity="warning"
            action={<Button onClick={result.retry}>Réessayer</Button>}
          >
            {result.error}
          </Alert>
        ) : !result.data ? (
          <Typography role="status">
            Chargement des magasins publiés…
          </Typography>
        ) : (
          <>
            {!result.data.items.length && (
              <Typography>Aucun magasin sur cette page.</Typography>
            )}
            {result.data.items.map((store) => (
              <Box
                key={store.store_id}
                component="label"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  overflowWrap: "anywhere",
                }}
              >
                <Checkbox
                  checked={selected.some((s) => s.store_id === store.store_id)}
                  disabled={
                    selected.length >= 100 &&
                    !selected.some((s) => s.store_id === store.store_id)
                  }
                  onChange={() => onSelect(store)}
                  slotProps={{
                    input: {
                      "aria-label": `Sélectionner ${store.name ?? store.store_id}`,
                    },
                  }}
                />
                {store.name ?? "Nom indisponible"} ·{" "}
                {store.city ?? "Ville indisponible"} ·{" "}
                {store.is_active ? "Actif" : "Inactif"}
              </Box>
            ))}
            <Typography variant="body2">
              Page de recherche ; {result.data.context.scope.scope_store_count}{" "}
              magasins dans le périmètre de recherche, distinct du total
              analytique appliqué.
            </Typography>
            {result.data.next_cursor && (
              <Button
                onClick={() => {
                  setPosition(context);
                  setAfter(result.data!.next_cursor!);
                }}
              >
                Magasins suivants
              </Button>
            )}
            {cursor && (
              <Button onClick={() => setAfter(undefined)}>
                Premiers magasins
              </Button>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}
