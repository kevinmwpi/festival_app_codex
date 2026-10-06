import {
  flush,
  isOnline,
  subscribeToSyncEvents,
  type FailedOperation,
  type MutableTable,
  type SyncEvent,
} from '@festival/sync-engine';

/** What happened to one queued write by the time the caller stopped waiting. */
export type SyncOutcome =
  | { status: 'synced' }
  /** The server rejected the write for good (e.g. `content_not_allowed`); it was rolled back locally. */
  | { status: 'failed'; failure: FailedOperation }
  /** Offline, retrying, or slower than the wait: it stays queued and syncs later. */
  | { status: 'pending' };

/** Long enough for one round trip on a slow festival network; the write keeps syncing after it. */
const DEFAULT_WAIT_MS = 8_000;

/** Failed records a waiting screen reports inline (the global failure toast skips them). */
const inlineFailures = new Set<string>();

/**
 * `true` (once) when a screen waiting in `writeAndAwaitSync` already shows this failure itself. Call it
 * after the `failed` event has been delivered to every listener (e.g. on the next tick).
 */
export function consumeInlineFailure(recordId: string): boolean {
  return inlineFailures.delete(recordId);
}

/**
 * Runs `write` (which queues one operation for `table` and resolves the queued record) and, while
 * online, flushes the queue and waits for that record's outcome — so a screen can show a server
 * rejection inline instead of a success followed by a rollback. Events are collected from before the
 * write starts, so an outcome that arrives before `write` resolves is not missed. Rejects only when
 * `write` itself rejects.
 */
export async function writeAndAwaitSync<T extends { id: string }>(
  table: MutableTable,
  write: () => Promise<T>,
  waitMs = DEFAULT_WAIT_MS,
): Promise<{ record: T; outcome: SyncOutcome }> {
  const events: SyncEvent[] = [];
  let onEvent: (() => void) | null = null;
  /** The record whose outcome the caller is still waiting for. */
  let awaitedId: string | null = null;
  const unsubscribe = subscribeToSyncEvents((event) => {
    if ('table' in event && event.table === table) {
      events.push(event);
      if (event.type === 'failed' && event.recordId === awaitedId) {
        inlineFailures.add(event.recordId);
      }
      onEvent?.();
    }
  });

  try {
    const record = await write();
    const find = (): SyncOutcome | null => {
      for (const event of events) {
        if (event.type === 'synced' && event.recordId === record.id) return { status: 'synced' };
        if (event.type === 'failed' && event.recordId === record.id) return { status: 'failed', failure: event.failure };
      }
      return null;
    };

    const known = find();
    if (known || !isOnline()) {
      return { record, outcome: known ?? { status: 'pending' } };
    }

    awaitedId = record.id;
    const outcome = await new Promise<SyncOutcome>((resolve) => {
      let settled = false;
      const finish = (value: SyncOutcome) => {
        if (settled) return;
        settled = true;
        awaitedId = null;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(find() ?? { status: 'pending' }), waitMs);
      onEvent = () => {
        const found = find();
        if (found) finish(found);
      };
      // A flush pass that ends without an outcome for this record (connectivity error, retry
      // scheduled, operations ahead of it parked) leaves it queued.
      void flush()
        .catch(() => undefined)
        .then(() => finish(find() ?? { status: 'pending' }));
    });
    return { record, outcome };
  } finally {
    unsubscribe();
  }
}
