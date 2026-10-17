export type SessionPhase =
  "idle" | "pending" | "authenticated" | "error" | "expired" | "signed-out";
export type SessionSnapshot = Readonly<{
  phase: SessionPhase;
  generation: number;
  expiresAt?: number;
}>;
export type AccessSession = Readonly<{
  accessToken: string;
  expiresAt: number;
}>;
export type SessionOperation = Readonly<{
  signal: AbortSignal;
  isCurrent: () => boolean;
}>;

export class SessionUnavailableError extends Error {
  constructor() {
    super("Session unavailable");
  }
}

// Snapshots contain no credentials. Each generation owns one cancellation signal.
export class Session {
  #snapshot: SessionSnapshot = { phase: "idle", generation: 0 };
  #credentials: AccessSession | undefined;
  #controller = new AbortController();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #listeners = new Set<() => void>();

  getSnapshot = (): SessionSnapshot => this.#snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #publish(snapshot: SessionSnapshot) {
    this.#snapshot = Object.freeze(snapshot);
    for (const listener of this.#listeners) listener();
  }

  end(phase: "idle" | "error" | "expired" | "signed-out" = "signed-out") {
    const previous = this.#controller;
    this.#controller = new AbortController();
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#credentials = undefined;
    try {
      this.#publish({ phase, generation: this.#snapshot.generation + 1 });
    } finally {
      // Synchronous abort handlers can no longer read the ended credentials.
      previous.abort();
    }
  }

  begin(): SessionOperation {
    this.end("idle");
    this.#publish({ phase: "pending", generation: this.#snapshot.generation });
    return this.#operation();
  }

  #operation(): SessionOperation {
    const generation = this.#snapshot.generation;
    const signal = this.#controller.signal;
    return {
      signal,
      isCurrent: () => {
        this.checkExpiry();
        return !signal.aborted && generation === this.#snapshot.generation;
      },
    };
  }

  accept(operation: SessionOperation, credentials: AccessSession): boolean {
    if (!operation.isCurrent() || this.#snapshot.phase !== "pending")
      return false;
    if (
      !Number.isSafeInteger(credentials.expiresAt) ||
      credentials.expiresAt <= Date.now() ||
      credentials.expiresAt - Date.now() > 86400_000
    ) {
      this.end("expired");
      return false;
    }
    this.#credentials = Object.freeze({ ...credentials });
    this.#publish({
      phase: "authenticated",
      generation: this.#snapshot.generation,
      expiresAt: credentials.expiresAt,
    });
    this.#scheduleExpiry();
    return true;
  }

  #scheduleExpiry(): void {
    if (!this.#credentials) return;
    this.#timer = setTimeout(
      () => {
        this.checkExpiry();
        // A changed wall clock can make a timer arrive before the absolute deadline.
        if (this.#credentials) this.#scheduleExpiry();
      },
      Math.max(1, this.#credentials.expiresAt - Date.now()),
    );
  }

  checkExpiry(): void {
    if (this.#credentials && this.#credentials.expiresAt <= Date.now())
      this.end("expired");
  }

  get credentials(): AccessSession | undefined {
    this.checkExpiry();
    return this.#credentials;
  }

  // Transport uses this boundary; an ignored abort still cannot publish
  // a result into a newer session. No business cache is introduced here.
  async run<T>(
    work: (
      credentials: AccessSession,
      signal: AbortSignal,
      operation: SessionOperation,
    ) => Promise<T>,
  ): Promise<T> {
    const credentials = this.credentials;
    if (!credentials) throw new SessionUnavailableError();
    const operation = this.#operation();
    try {
      const result = await work(credentials, operation.signal, operation);
      if (!operation.isCurrent()) throw new SessionUnavailableError();
      return result;
    } catch (error) {
      if (!operation.isCurrent()) throw new SessionUnavailableError();
      throw error;
    }
  }
}
