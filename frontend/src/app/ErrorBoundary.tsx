import { Component } from "react";
import type { ReactNode } from "react";
import { Alert, AlertTitle, Box, Button, Stack } from "@mui/material";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <Box component="main" sx={{ maxWidth: 640, mx: "auto", p: 3, pt: 6 }}>
          <Stack spacing={3}>
            <Alert severity="error">
              <AlertTitle>La plateforme n’a pas pu s’ouvrir</AlertTitle>
              Réessayez de charger la page. Si le problème persiste, contactez
              la personne responsable de la plateforme.
            </Alert>
            <Button variant="outlined" onClick={() => window.location.reload()}>
              Recharger la page
            </Button>
          </Stack>
        </Box>
      );
    }
    return this.props.children;
  }
}
