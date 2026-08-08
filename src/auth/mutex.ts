/**
 * A FIFO, non-reentrant async mutex — the `asyncio.Lock` equivalent used
 * throughout `evnex/auth.py` (PLAN.md §2.3).
 *
 * Implemented as a promise chain: each call synchronously captures the
 * current tail before its first `await`, so callers queue in submission
 * order regardless of how the event loop later schedules them. Re-entering
 * from inside the locked section (calling `runExclusive` again before the
 * outer call has released) deadlocks, exactly like re-acquiring an
 * `asyncio.Lock` from the same task without releasing it first.
 */

export class Mutex {
  private tail: Promise<void> = Promise.resolve();
  private held = false;

  /** True while a caller currently holds the lock. */
  get locked(): boolean {
    return this.held;
  }

  /** Run `fn` once every earlier-queued caller has released the lock. */
  async runExclusive<T>(fn: () => T | PromiseLike<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    this.held = true;
    try {
      return await fn();
    } finally {
      this.held = false;
      release();
    }
  }
}
