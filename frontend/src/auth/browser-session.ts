import { flushSync } from "react-dom";
import type { Authentication } from "./authentication";

export function bindBrowserSession(
  authentication: Authentication,
  browser: Window,
): () => void {
  const check = () => flushSync(() => authentication.sessions.checkExpiry());
  const hide = () => flushSync(() => authentication.leaveDocument());
  const show = (event: PageTransitionEvent) => {
    if (event.persisted) flushSync(() => authentication.logout());
    else check();
  };
  browser.addEventListener("pagehide", hide);
  browser.addEventListener("pageshow", show);
  browser.addEventListener("focus", check);
  browser.document.addEventListener("visibilitychange", check);
  return () => {
    browser.removeEventListener("pagehide", hide);
    browser.removeEventListener("pageshow", show);
    browser.removeEventListener("focus", check);
    browser.document.removeEventListener("visibilitychange", check);
  };
}
