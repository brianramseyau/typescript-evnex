/**
 * A FIFO, non-reentrant async mutex — the `asyncio.Lock` equivalent used
 * throughout `evnex/auth.py` (PLAN.md §2.3).
 *
 * TODO(A7): implement. `runExclusive` serialises callers in submission
 * order and releases the lock on throw as well as on success.
 */

export class Mutex {
  /** True while a caller currently holds the lock. */
  get locked(): boolean {
    throw new Error("TODO(A7)");
  }

  /** Run `fn` once every earlier-queued caller has released the lock. */
  async runExclusive<T>(fn: () => T | PromiseLike<T>): Promise<T> {
    throw new Error("TODO(A7)");
  }
}
