import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReadScheduler } from "./read-scheduler";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("preserves an undefined rejection and releases its active slot", async () => {
  const scheduler = new ReadScheduler();
  const result = scheduler
    .run(() => Promise.reject(undefined), new AbortController().signal)
    .then(
      () => "resolved",
      (error: unknown) => ({ error }),
    );
  expect(await result).toEqual({ error: undefined });
  const next = scheduler.run(async () => "next", new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await next).toBe("next");
});

it("allows two active reads at most and retains an ignored-abort slot", async () => {
  const scheduler = new ReadScheduler();
  const deliveries: ((value: string) => void)[] = [];
  const work = vi.fn(
    () => new Promise<string>((resolve) => deliveries.push(resolve)),
  );
  const cancellation = new AbortController();
  const first = scheduler.run(work, cancellation.signal);
  const second = scheduler.run(work, new AbortController().signal);
  const third = scheduler.run(work, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1000);
  expect(work).toHaveBeenCalledTimes(2);
  cancellation.abort();
  await expect(first).rejects.toHaveProperty("code", "cancelled");
  await vi.advanceTimersByTimeAsync(1000);
  expect(work).toHaveBeenCalledTimes(2);
  deliveries[0]!("old");
  await vi.advanceTimersByTimeAsync(0);
  expect(work).toHaveBeenCalledTimes(3);
  deliveries[1]!("second");
  deliveries[2]!("third");
  expect(await second).toBe("second");
  expect(await third).toBe("third");
});
it("spaces departures and stays at sixty starts per rolling minute", async () => {
  const scheduler = new ReadScheduler();
  const times: number[] = [];
  for (let i = 0; i < 61; i++) {
    const result = scheduler.run(async () => {
      times.push(Date.now());
      return true;
    }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1000);
    await result;
  }
  expect(
    times.every(
      (time, index) => index === 0 || time - times[index - 1]! >= 1000,
    ),
  ).toBe(true);
  expect(times.filter((time) => time < times[0]! + 60_000)).toHaveLength(60);
});
it("bounds queued jobs and expires waiting jobs without starting them", async () => {
  const scheduler = new ReadScheduler();
  const work = vi.fn(() => new Promise(() => undefined));
  void scheduler.run(work, new AbortController().signal);
  const waiting = Array.from({ length: 32 }, () =>
    scheduler
      .run(work, new AbortController().signal)
      .catch((error: unknown) => error),
  );
  await expect(
    scheduler.run(work, new AbortController().signal),
  ).rejects.toHaveProperty("code", "queue-full");
  await vi.advanceTimersByTimeAsync(30_000);
  expect(work).toHaveBeenCalledTimes(2);
  const expired = await Promise.all(waiting.slice(1));
  expect(
    expired.every(
      (error) => (error as { code: string }).code === "queue-timeout",
    ),
  ).toBe(true);
});
