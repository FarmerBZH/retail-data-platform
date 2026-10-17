import type { Session } from "./session";

type Job = {
  signal: AbortSignal;
  start: () => void;
  cancel: () => void;
};

// One queue per memory session, shared by every ReadApi instance.
const schedulers = new WeakMap<Session, ReadScheduler>();
export class ReadSchedulingError extends Error {
  constructor(readonly code: "cancelled" | "queue-full" | "queue-timeout") {
    super("Read unavailable");
  }
}
export function readScheduler(session: Session): ReadScheduler {
  let scheduler = schedulers.get(session);
  if (!scheduler) {
    scheduler = new ReadScheduler();
    schedulers.set(session, scheduler);
  }
  return scheduler;
}

export class ReadScheduler {
  #active = 0;
  #queue: Job[] = [];
  #starts: number[] = [];
  #nextStart = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;

  run<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted || this.#queue.length >= 32)
      return Promise.reject(
        new ReadSchedulingError(signal.aborted ? "cancelled" : "queue-full"),
      );
    return new Promise<T>((resolve, reject) => {
      let started = false;
      let settled = false;
      const finish = (result: { value: T } | { error: unknown }) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", cancel);
        clearTimeout(deadline);
        if ("error" in result) reject(result.error);
        else resolve(result.value);
      };
      const cancel = () => {
        if (!started)
          this.#queue = this.#queue.filter((entry) => entry !== job);
        finish({ error: new ReadSchedulingError("cancelled") });
        this.#pump();
      };
      const deadline = setTimeout(() => {
        this.#queue = this.#queue.filter((entry) => entry !== job);
        finish({ error: new ReadSchedulingError("queue-timeout") });
        this.#pump();
      }, 30_000);
      const job: Job = {
        signal,
        cancel,
        start: () => {
          started = true;
          clearTimeout(deadline);
          this.#active++;
          // Aborted work keeps its slot until the underlying operation settles.
          let running: Promise<T>;
          try {
            running = work();
          } catch (error) {
            running = Promise.reject(error);
          }
          running
            .then(
              (value) => finish({ value }),
              (error: unknown) => finish({ error }),
            )
            .finally(() => {
              this.#active--;
              this.#pump();
            });
        },
      };
      signal.addEventListener("abort", cancel, { once: true });
      this.#queue.push(job);
      this.#pump();
    });
  }

  #pump(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#active >= 2 || !this.#queue.length) return;
    const now = Date.now();
    this.#starts = this.#starts.filter((time) => time > now - 60_000);
    const readyAt = Math.max(
      this.#nextStart,
      this.#starts.length >= 60 ? this.#starts[0]! + 60_000 : now,
    );
    if (readyAt > now) {
      this.#timer = setTimeout(() => this.#pump(), readyAt - now);
      return;
    }
    const job = this.#queue.shift()!;
    if (job.signal.aborted) {
      job.cancel();
      return;
    }
    this.#starts.push(now);
    this.#nextStart = now + 1000;
    job.start();
    this.#pump();
  }
}
