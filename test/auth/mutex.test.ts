import { describe, expect, it } from "vitest";
import { Mutex } from "../../src/auth/mutex.js";

describe("Mutex", () => {
  it("is unlocked initially", () => {
    const mutex = new Mutex();
    expect(mutex.locked).toBe(false);
  });

  it("reports locked while a caller is running and unlocked after", async () => {
    const mutex = new Mutex();
    let observedDuring = false;

    const task = mutex.runExclusive(async () => {
      observedDuring = mutex.locked;
      await Promise.resolve();
    });

    await task;
    expect(observedDuring).toBe(true);
    expect(mutex.locked).toBe(false);
  });

  it("returns the value produced by fn", async () => {
    const mutex = new Mutex();
    const result = await mutex.runExclusive(() => 42);
    expect(result).toBe(42);
  });

  it("serialises 100 concurrent callers strictly in submission order", async () => {
    const mutex = new Mutex();
    const started: number[] = [];
    const finished: number[] = [];

    const tasks = Array.from({ length: 100 }, (_, i) =>
      mutex.runExclusive(async () => {
        started.push(i);
        // Yield a couple of microtask turns so a non-serialised
        // implementation would visibly interleave.
        await Promise.resolve();
        await Promise.resolve();
        finished.push(i);
      }),
    );

    await Promise.all(tasks);

    const expected = Array.from({ length: 100 }, (_, i) => i);
    expect(started).toEqual(expected);
    expect(finished).toEqual(expected);
  });

  it("never runs two callers concurrently", async () => {
    const mutex = new Mutex();
    let active = 0;
    let maxActive = 0;

    const tasks = Array.from({ length: 20 }, () =>
      mutex.runExclusive(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        await Promise.resolve();
        active -= 1;
      }),
    );

    await Promise.all(tasks);
    expect(maxActive).toBe(1);
  });

  it("releases the lock when fn throws synchronously", async () => {
    const mutex = new Mutex();

    await expect(
      mutex.runExclusive(() => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(mutex.locked).toBe(false);
    // The mutex is still usable afterwards.
    await expect(mutex.runExclusive(() => "ok")).resolves.toBe("ok");
  });

  it("releases the lock when fn rejects", async () => {
    const mutex = new Mutex();

    await expect(
      mutex.runExclusive(async () => {
        await Promise.resolve();
        throw new Error("async boom");
      }),
    ).rejects.toThrow("async boom");

    expect(mutex.locked).toBe(false);
    await expect(mutex.runExclusive(() => "ok")).resolves.toBe("ok");
  });

  it("keeps queued callers running in order even after an earlier rejection", async () => {
    const mutex = new Mutex();
    const order: string[] = [];

    const first = mutex.runExclusive(async () => {
      order.push("first-start");
      await Promise.resolve();
      order.push("first-throw");
      throw new Error("fail");
    });
    const second = mutex.runExclusive(() => {
      order.push("second");
    });

    await expect(first).rejects.toThrow("fail");
    await second;

    expect(order).toEqual(["first-start", "first-throw", "second"]);
  });
});
