import { Fragment } from "react";
import type { ReactNode } from "react";
import type { Session } from "./session";
import { useSession } from "./use-session";

export function SessionBoundary({
  session,
  children,
}: {
  session: Session;
  children: ReactNode;
}) {
  const snapshot = useSession(session);
  if (snapshot.phase !== "authenticated") return null;
  return <Fragment key={snapshot.generation}>{children}</Fragment>;
}
