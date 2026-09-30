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

export default function App({
  configuration,
  authentication,
  completion,
  oidcInvalid = false,
}: {
  configuration: Configuration;
  authentication?: Authentication | undefined;
  completion?: Promise<boolean> | undefined;
  oidcInvalid?: boolean;
}) {
  const [showAccessDetails, setShowAccessDetails] = useState(false);

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
                completion={completion}
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
