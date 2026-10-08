import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import type { ExplorerReads } from "./DataExplorer";
import { PublishedDetail } from "./PublishedDetail";
import type { PublishedRow } from "./published-data";
import { rowDecoder } from "./published-data";
import type { Resource } from "./read-api";
import { qualityResources } from "./quality-data";

export function SourceImports({
  row,
  reads,
}: {
  row: PublishedRow;
  reads: ExplorerReads;
}) {
  const ids = Array.isArray(row.source_run_ids)
    ? (row.source_run_ids as readonly string[])
    : [];
  const [page, setPage] = useState(0),
    [opened, setOpened] = useState<string>();
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
        Imports sources de la publication
      </Typography>
      <Typography>
        Consultation à la demande des audits publiés, selon le catalogue
        autorisé. Références vivantes ; aucune filiation entre une ligne métier
        et un import n’est déduite.
      </Typography>
      <Box component="ul" sx={{ pl: 3 }}>
        {ids.slice(page * 50, (page + 1) * 50).map((id, i) => (
          <Box component="li" key={`${page}:${i}`}>
            <Button
              sx={{ overflowWrap: "anywhere", textAlign: "left" }}
              onClick={(e) => {
                trigger.current = e.currentTarget;
                setOpened(id);
              }}
            >
              Consulter l’import : {id}
            </Button>
          </Box>
        ))}
      </Box>
      {!ids.length && (
        <Typography>Aucun identifiant d’import source consultable.</Typography>
      )}
      {ids.length > 50 && (
        <Stack direction="row" spacing={1}>
          <Button
            disabled={page === 0}
            onClick={() => {
              setOpened(undefined);
              setPage((n) => n - 1);
            }}
          >
            Imports précédents
          </Button>
          <Button
            disabled={(page + 1) * 50 >= ids.length}
            onClick={() => {
              setOpened(undefined);
              setPage((n) => n + 1);
            }}
          >
            Imports suivants
          </Button>
        </Stack>
      )}
      {opened && (
        <ImportReference
          key={opened}
          id={opened}
          reads={reads}
          close={() => setOpened(undefined)}
        />
      )}
    </Stack>
  );
}
type State =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "absent" }
  | { phase: "ready"; row: PublishedRow; resource: Resource };
function ImportReference({
  id,
  reads,
  close,
}: {
  id: string;
  reads: ExplorerReads;
  close: () => void;
}) {
  const [state, setState] = useState<State>({ phase: "loading" }),
    [revision, setRevision] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    const controller = new AbortController(),
      options = { signal: controller.signal, refresh: true };
    void (async () => {
      const resources = qualityResources(await reads.resources(options));
      const resource = resources.find((r) => r.name === "import_runs");
      if (!resource || !resource.filters.includes("id"))
        throw new Error("Unavailable");
      const before = await reads.status(options);
      const page = await reads.page(
        "import_runs",
        { id, limit: 2 },
        rowDecoder(resource),
        options,
      );
      if (
        page.nextCursor !== null ||
        page.items.length > 1 ||
        (page.items[0] && page.items[0].id !== id)
      )
        throw new Error("Invalid response");
      const after = await reads.status(options);
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw new Error("Changed");
      if (!controller.signal.aborted)
        setState(
          page.items[0]
            ? { phase: "ready", row: page.items[0], resource }
            : { phase: "absent" },
        );
    })().catch(() => {
      if (!controller.signal.aborted) setState({ phase: "error" });
    });
    return () => controller.abort();
  }, [id, reads, revision]);
  return (
    <Stack spacing={1}>
      <Typography variant="h3" component="h3" ref={heading} tabIndex={-1}>
        Référence vivante — Import source
      </Typography>
      <Button onClick={close}>Fermer l’import source</Button>
      {state.phase === "loading" && (
        <Typography role="status">Chargement de l’import source…</Typography>
      )}
      {state.phase === "error" && (
        <Alert severity="warning">
          Cet import est indisponible, non autorisé ou n’a pas pu être vérifié.
          La publication reste consultable.
        </Alert>
      )}
      {state.phase === "absent" && (
        <Typography>
          Import source absent ou supprimé ; la publication reste consultable.
        </Typography>
      )}
      {state.phase === "ready" && (
        <PublishedDetail resource={state.resource} row={state.row} />
      )}
      <Button
        onClick={() => {
          setState({ phase: "loading" });
          setRevision((n) => n + 1);
        }}
      >
        Relire l’import source
      </Button>
    </Stack>
  );
}
