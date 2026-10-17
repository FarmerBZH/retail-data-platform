import { useSyncExternalStore } from "react";
import type { Session, SessionSnapshot } from "./session";

const missing: SessionSnapshot = { phase: "idle", generation: 0 };
const emptySnapshot = () => missing;
const emptySubscription = () => () => {};

export function useSession(session?: Session) {
  return useSyncExternalStore(
    session?.subscribe ?? emptySubscription,
    session?.getSnapshot ?? emptySnapshot,
  );
}
