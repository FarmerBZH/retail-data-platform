import { useEffect, useRef } from "react";
import { Alert, AlertTitle, Button } from "@mui/material";
import type { Authentication } from "./authentication";
import { SessionBoundary } from "./SessionBoundary";
import { useSession } from "./use-session";

export function SignIn({
  authentication,
  invalid,
}: {
  authentication?: Authentication | undefined;
  invalid: boolean;
}) {
  const snapshot = useSession(authentication?.sessions);
  const phase = snapshot.phase;
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (phase === "expired" || phase === "signed-out") button.current?.focus();
  }, [phase, snapshot.generation]);
  const expired = phase === "expired";
  const ended = phase === "signed-out";
  const pending = phase === "pending";
  const success = phase === "authenticated";
  return (
    <>
      {authentication && (
        <SessionBoundary session={authentication.sessions}>
          <Alert severity="success">
            <AlertTitle>Connexion vérifiée</AlertTitle>
            Votre connexion personnelle a été vérifiée.
          </Alert>
          <Button
            variant="outlined"
            fullWidth
            onClick={() => authentication.logout()}
          >
            Se déconnecter
          </Button>
        </SessionBoundary>
      )}
      {!success && (
        <>
          <Alert
            severity={
              phase === "error" || invalid
                ? "error"
                : expired
                  ? "warning"
                  : "info"
            }
          >
            <AlertTitle>
              {expired
                ? "Session expirée"
                : ended
                  ? "Session terminée"
                  : phase === "error"
                    ? "Connexion interrompue"
                    : pending
                      ? "Connexion en cours"
                      : authentication
                        ? "Connexion personnelle"
                        : "Connexion indisponible"}
            </AlertTitle>
            {expired
              ? "Votre session a expiré. Connectez-vous à nouveau pour poursuivre."
              : ended
                ? "Votre session est terminée. Une nouvelle connexion est nécessaire."
                : phase === "error"
                  ? "La connexion n’a pas pu être vérifiée. Réessayez une nouvelle connexion."
                  : pending
                    ? "Vérification auprès du service d’identité…"
                    : invalid
                      ? "La configuration du service doit être corrigée. Contactez la personne responsable de la plateforme."
                      : authentication
                        ? "Vous allez vous authentifier auprès du service d’identité de votre organisation."
                        : "La configuration de connexion n’est pas encore renseignée. Contactez la personne responsable de la plateforme."}
          </Alert>
          <Button
            ref={button}
            variant="contained"
            disabled={!authentication || pending}
            fullWidth
            onClick={() => {
              void authentication?.signIn().catch(() => undefined);
            }}
          >
            Se connecter
          </Button>
          {pending && (
            <Button
              variant="outlined"
              fullWidth
              onClick={() => authentication?.logout()}
            >
              Annuler la connexion
            </Button>
          )}
        </>
      )}
    </>
  );
}
