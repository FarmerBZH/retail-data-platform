import { useState } from "react";
import {
  Box,
  Button,
  Collapse,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import type { Configuration } from "./config";
import type { Authentication } from "./authentication";
import { SignIn } from "./SignIn";
import { SessionBoundary } from "./SessionBoundary";
import { FreshnessBanner } from "./FreshnessBanner";
import { StoreList } from "./Stores";
import { initialStoreNavigation } from "./store-navigation";
import type { ReadQueries } from "./read-queries";
import { DataExplorerEntry as DataExplorer } from "./ExplorerEntry";
import { useSession } from "./use-session";

export default function App({
  configuration,
  authentication,
  oidcInvalid = false,
  reads,
}: {
  configuration: Configuration;
  authentication?: Authentication | undefined;
  oidcInvalid?: boolean;
  reads?: ReadQueries | undefined;
}) {
  const [showAccessDetails, setShowAccessDetails] = useState(false);
  const session = useSession(authentication?.sessions);

  if (
    authentication &&
    session.phase === "authenticated" &&
    configuration.status === "configured"
  ) {
    return (
      <SessionBoundary session={authentication.sessions}>
        <Box
          component="header"
          sx={{
            bgcolor: "background.paper",
            borderBottom: 1,
            borderColor: "divider",
            px: { xs: 2, sm: 3, lg: 4 },
            py: 2,
          }}
        >
          <Typography variant="h3" component="p">
            Plateforme analytique
          </Typography>
          <SignIn authentication={authentication} invalid={false} />
        </Box>
        <Box
          component="main"
          sx={{
            maxWidth: 1600,
            mx: "auto",
            px: { xs: 2, sm: 3, lg: 4 },
            py: 4,
          }}
        >
          {reads ? (
            <>
              <FreshnessBanner reads={reads} />
              <Workspace reads={reads} />
            </>
          ) : (
            <Typography role="status">
              La consultation des magasins est indisponible.
            </Typography>
          )}
        </Box>
      </SessionBoundary>
    );
  }

  return (
    <Box sx={{ minHeight: "100dvh" }}>
      <Box
        component="header"
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Box
          sx={{
            maxWidth: 1600,
            mx: "auto",
            px: { xs: 2, sm: 3, lg: 4 },
            py: 2,
          }}
        >
          <Typography variant="h3" component="p">
            Plateforme analytique
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Analyse commerciale
          </Typography>
        </Box>
      </Box>

      <Box
        component="main"
        sx={{
          maxWidth: 640,
          mx: "auto",
          px: { xs: 2, sm: 3, lg: 4 },
          py: { xs: 4, sm: 6 },
        }}
      >
        <Stack spacing={4}>
          <Stack spacing={1}>
            <Typography variant="h1">Accès à la plateforme</Typography>
            <Typography color="text.secondary">
              Un accès personnel pour consulter les données publiées de votre
              organisation.
            </Typography>
          </Stack>

          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack spacing={3}>
              <Stack spacing={1}>
                <Typography variant="h2">Connexion personnelle</Typography>
                <Typography color="text.secondary">
                  La connexion ouvrira le service d’identité de votre
                  organisation.
                </Typography>
              </Stack>

              <SignIn
                authentication={authentication}
                invalid={configuration.status === "invalid" || oidcInvalid}
              />
              <Divider />
              <Box>
                <Button
                  aria-expanded={showAccessDetails}
                  aria-controls="access-details"
                  onClick={() => setShowAccessDetails((previous) => !previous)}
                >
                  Comprendre l’accès
                </Button>
                <Collapse in={showAccessDetails}>
                  <Typography
                    id="access-details"
                    color="text.secondary"
                    sx={{ pt: 1 }}
                  >
                    L’accès est réservé aux personnes autorisées de
                    l’organisation. Les données seront consultables en lecture
                    seule. Aucun mot de passe ne vous sera demandé sur cette
                    page.
                  </Typography>
                </Collapse>
              </Box>
            </Stack>
          </Paper>

          <Typography variant="body2" color="text.secondary">
            Aucune donnée commerciale n’est chargée sur cet écran.
          </Typography>
        </Stack>
      </Box>
    </Box>
  );
}

function Workspace({ reads }: { reads: ReadQueries }) {
  const [view, setView] = useState("stores");
  const [navigation, setNavigation] = useState(initialStoreNavigation);
  return (
    <Stack spacing={3}>
      <Box component="nav" aria-label="Navigation principale">
        <Stack direction="row" spacing={2}>
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
        </Stack>
      </Box>
      {view === "stores" ? (
        <StoreList
          reads={reads}
          navigation={navigation}
          onNavigation={setNavigation}
        />
      ) : (
        <DataExplorer reads={reads} />
      )}
    </Stack>
  );
}
