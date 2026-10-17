import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Session } from "./session";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("memory session lifetime", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function authenticated(session = new Session(), token = "synthetic-first") {
    session.accept(session.begin(), {
      accessToken: token,
      expiresAt: Date.now() + 1000,
    });
    return session;
  }

  it("announces expiry, aborts outstanding work and exposes no credential in snapshots", () => {
    const session = new Session();
    const operation = session.begin();
    session.accept(operation, {
      accessToken: "synthetic-token",
      expiresAt: Date.now() + 1000,
    });
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    expect(Object.keys(session.getSnapshot()).sort()).toEqual([
      "expiresAt",
      "generation",
      "phase",
    ]);
    vi.advanceTimersByTime(1000);
    expect(session.getSnapshot().phase).toBe("expired");
    expect(session.credentials).toBeUndefined();
    expect(operation.signal.aborted).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    session.end();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each(["logout", "expiry", "replacement"])(
    "rejects a late response after %s even when the work ignores abort",
    async (reason) => {
      const session = authenticated();
      const response = deferred<string>();
      let signal!: AbortSignal;
      const work = session.run((_credentials, current) => {
        signal = current;
        return response.promise;
      });
      const rejected = expect(work).rejects.toThrow("Session unavailable");
      if (reason === "expiry") vi.advanceTimersByTime(1000);
      else session.end();
      if (reason === "replacement") authenticated(session, "synthetic-second");
      expect(signal.aborted).toBe(true);
      response.resolve("synthetic-old-business-value");
      await rejected;
      expect(session.credentials?.accessToken).toBe(
        reason === "replacement" ? "synthetic-second" : undefined,
      );
    },
  );

  it("clears credentials before synchronous abort handlers run", () => {
    const session = new Session();
    const operation = session.begin();
    session.accept(operation, {
      accessToken: "synthetic-token",
      expiresAt: Date.now() + 1000,
    });
    let credentialsDuringAbort: unknown = "not-called";
    operation.signal.addEventListener("abort", () => {
      credentialsDuringAbort = session.credentials;
    });
    session.end();
    expect(credentialsDuringAbort).toBeUndefined();
  });

  it.each([NaN, Infinity, -1, 86400_001])(
    "refuses an invalid lifetime %s",
    (duration) => {
      const session = new Session();
      expect(
        session.accept(session.begin(), {
          accessToken: "synthetic-token",
          expiresAt: Date.now() + duration,
        }),
      ).toBe(false);
      expect(session.credentials).toBeUndefined();
    },
  );

  it("checks the deadline before new work and after a suspended timer", async () => {
    const session = authenticated();
    vi.setSystemTime(Date.now() + 2000);
    const work = vi.fn();
    await expect(session.run(work)).rejects.toThrow("Session unavailable");
    expect(work).not.toHaveBeenCalled();
    expect(session.getSnapshot().phase).toBe("expired");
  });

  it("accepts current results and rejects stale login operations", async () => {
    const session = authenticated();
    expect(await session.run(async () => "synthetic-current")).toBe(
      "synthetic-current",
    );
    const old = session.begin();
    session.end();
    expect(
      session.accept(old, {
        accessToken: "synthetic-stale",
        expiresAt: Date.now() + 1000,
      }),
    ).toBe(false);
    expect(session.credentials).toBeUndefined();
    expect(new Session().credentials).toBeUndefined();
  });
});
