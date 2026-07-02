/** Minimal FIFO async mutex. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async lock(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.tail;
    this.tail = this.tail.then(() => next);
    await prev;
    return release;
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.lock();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const namedLocks = new Map<string, Mutex>();

/** Process-wide mutex per key (e.g. one per main checkout path). */
export function namedMutex(key: string): Mutex {
  let mutex = namedLocks.get(key);
  if (!mutex) {
    mutex = new Mutex();
    namedLocks.set(key, mutex);
  }
  return mutex;
}
