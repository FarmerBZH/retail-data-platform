import { useEffect, useState } from "react";
import { Alert, AlertTitle, Button } from "@mui/material";
import type { Authentication } from "./authentication";

export function SignIn({
  authentication,
  completion,
  invalid,
}: {
  authentication?: Authentication | undefined;
  completion?: Promise<boolean> | undefined;
  invalid: boolean;
}) {
  const [phase, setPhase] = useState<"idle" | "pending" | "success" | "error">(
    completion ? "pending" : "idle",
  );
  useEffect(() => {
    let active = true;
    void completion?.then((ok) => {
      if (active) setPhase(ok ? "success" : "error");
    });
    return () => {
      active = false;
    };
  }, [completion]);

  async function signIn() {
    if (!authentication) return;
    setPhase("pending");
    try {
      await authentication.signIn();
    } catch {
      setPhase("error");
    }
  }

  return (
    <>
      <Alert
        severity={
          phase === "error" || invalid
            ? "error"
            : phase === "success"
              ? "success"
              : "info"
        }
      >
        <AlertTitle>
          {phase === "success"
            ? "Connexion vérifiée"
            : phase === "error"
              ? "Connexion interrompue"
              : phase === "pending"
                ? "Connexion en cours"
                : authentication
                  ? "Connexion personnelle"
                  : "Connexion indisponible"}
        </AlertTitle>
        {phase === "success"
          ? "Votre connexion a été vérifiée. Les écrans de consultation seront disponibles dans une prochaine étape."
          : phase === "error"
            ? "La connexion n’a pas pu être vérifiée. Réessayez une nouvelle connexion."
            : phase === "pending"
              ? "Vérification auprès du service d’identité…"
              : invalid
                ? "La configuration du service doit être corrigée. Contactez la personne responsable de la plateforme."
                : authentication
                  ? "Vous allez vous authentifier auprès du service d’identité de votre organisation."
                  : "La configuration de connexion n’est pas encore renseignée. Contactez la personne responsable de la plateforme."}
      </Alert>
      <Button
        variant="contained"
        disabled={!authentication || phase === "pending" || phase === "success"}
        fullWidth
        onClick={() => {
          void signIn();
        }}
      >
        Se connecter
      </Button>
    </>
  );
}
