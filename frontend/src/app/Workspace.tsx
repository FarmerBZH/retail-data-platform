import { useState } from "react";
import { Box, Button, Stack } from "@mui/material";
import type { ReadQueries } from "../api/read-queries";
import { FilteredAnalysis } from "../features/analysis/FilteredAnalysis";
import { initialAnalysisState } from "../features/analysis/analysis-state";
import { Network } from "../features/network/Network";
import { initialNetworkContext } from "../features/network/network-data";
import { StoreList } from "../features/stores/Stores";
import { initialStoreNavigation } from "../features/stores/store-navigation";
import {
  DataExplorerEntry as DataExplorer,
  QualityEntry as Quality,
} from "../features/data-explorer/ExplorerEntry";

export function Workspace({ reads }: { reads: ReadQueries }) {
  const [analysisState, setAnalysisState] = useState(initialAnalysisState);
  const [networkContext, setNetworkContext] = useState(initialNetworkContext);
  const [view, setView] = useState("stores");
  const [navigation, setNavigation] = useState(initialStoreNavigation);
  return (
    <Stack spacing={3}>
      <Box component="nav" aria-label="Navigation principale">
        <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Button
            aria-current={view === "network" ? "page" : undefined}
            onClick={() => setView("network")}
          >
            Vue réseau
          </Button>
          <Button
            aria-current={view === "analysis" ? "page" : undefined}
            onClick={() => setView("analysis")}
          >
            Analyses filtrées
          </Button>
          <Button
            aria-current={view === "stores" ? "page" : undefined}
            onClick={() => setView("stores")}
          >
            Magasins
          </Button>
          <Button
            aria-current={view === "data" ? "page" : undefined}
            onClick={() => setView("data")}
          >
            Données
          </Button>
          <Button
            aria-current={view === "quality" ? "page" : undefined}
            onClick={() => setView("quality")}
          >
            Qualité des données
          </Button>
        </Stack>
      </Box>
      {view === "network" ? (
        <Network
          reads={reads}
          context={networkContext}
          onContext={setNetworkContext}
        />
      ) : view === "analysis" ? (
        <FilteredAnalysis
          reads={reads}
          state={analysisState}
          onState={setAnalysisState}
        />
      ) : view === "stores" ? (
        <StoreList
          reads={reads}
          navigation={navigation}
          onNavigation={setNavigation}
        />
      ) : view === "quality" ? (
        <Quality reads={reads} />
      ) : (
        <DataExplorer reads={reads} />
      )}
    </Stack>
  );
}
