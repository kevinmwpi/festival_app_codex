import NetInfo from '@react-native-community/netinfo';

import {
  classifySyncError,
  describeSyncError,
  isConnectivityError,
  isMutableTable,
  isSessionUnavailableError,
  stripPayloadForServer,
} from './classify';
import { getDb, upsertRows, type LocalDatabase } from './db';
import { USER_DATA_TABLES } from './schema';
import type {
  EnqueueResult,
  FailedOperation,
  MutableTable,
  PendingOperation,
  SyncEvent,
  SyncEventListener,
  SyncOperation,
  SyncOperationType,
  SyncSessionState,
  SyncTransport,
  TrackedOperation,
} from './types';

interface QueueRow {
  id: string;
  table_name: MutableTable;
  operation_type: SyncOperationType;
  payload_json: string;
  attempt_count: number;
  next_retry_at: string | null;
  last_error: string | null;
  created_at: string;
  record_id: string | null;
  record_key: string | null;
  previous_json: string | null;
  parked: number;
}

type RetryScheduler = (delayMs: number, callback: () => void) => unknown;
type RetryCanceller = (handle: unknown) => void;

export const MAX_SYNC_ATTEMPTS = 20;
export const MAX_SYNC_BACKOFF_MS = 30_000;
/** A session expiring within this window is treated as unusable (auto-refresh is about to replace it). */
export const SESSION_EXPIRY_MARGIN_MS = 60_000;
const SESSION_RETRY_DELAY_MS = 5_000;

const QUEUE_COLUMNS =
  'id, table_name, operation_type, payload_json, attempt_count, next_retry_at, last_error, created_at, record_id, record_key, previous_json, parked';

let syncTransport: SyncTransport | null = null;
let getSessionState: (() => SyncSessionState | null) | null = null;
let online = true;
let listenerStarted = false;
let unsubscribeNetInfo: (() => void) | null = null;
let flushPromise: Promise<void> | null = null;
let flushRequested = false;
let parkedReleasedThisSession = false;
let generation = 0;
let retryHandle: unknown;
let retryDueAt: number | null = null;
let retryScheduler: RetryScheduler = (delayMs, callback) => setTimeout(callback, delayMs);
let retryCanceller: RetryCanceller = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>);
const eventListeners = new Set<SyncEventListener>();
const activityTrackers = new Set<ActiveTracker>();

interface ActiveTracker {
  operations: TrackedOperation[];
  cleared: boolean;
}

/**
 * Records queue activity while a network refresh is in flight, so the merge can protect every record
 * whose queued operation overlapped the fetch (see `trackQueueActivity`).
 */
export interface QueueActivityTracker {
  /** Operations enqueued since the tracker started, oldest first. */
  readonly operations: readonly TrackedOperation[];
  /** True once `clearLocalUserData()` ran after the tracker started (the fetched data is stale). */
  readonly cleared: boolean;
  /** Stops recording. Idempotent. */
  stop(): void;
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // RFC 4122 v4 fallback for runtimes without crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export function getBackoffDelayMs(attempt: number): number {
  return Math.min(MAX_SYNC_BACKOFF_MS, 2 ** Math.max(0, attempt - 1) * 1_000);
}

function emit(event: SyncEvent): void {
  for (const listener of eventListeners) {
    try {
      listener(event);
    } catch {
      // A misbehaving listener must never break syncing.
    }
  }
}

function isReachable(state: { isConnected: boolean | null; isInternetReachable?: boolean | null }): boolean {
  return Boolean(state.isConnected && state.isInternetReachable !== false);
}

function ensureListener(): void {
  if (listenerStarted) {
    return;
  }

  listenerStarted = true;
  void NetInfo.fetch()
    .then((state) => {
      online = isReachable(state);
    })
    .catch(() => undefined);

  unsubscribeNetInfo = NetInfo.addEventListener((state) => {
    const nextOnline = isReachable(state);
    const cameOnline = !online && nextOnline;
    online = nextOnline;
    if (cameOnline) {
      void flush();
    }
  });
}

function cancelRetry(): void {
  if (retryHandle !== undefined) {
    retryCanceller(retryHandle);
  }
  retryHandle = undefined;
  retryDueAt = null;
}

function scheduleRetry(delayMs: number): void {
  const dueAt = Date.now() + delayMs;
  if (retryHandle !== undefined && retryDueAt !== null && retryDueAt <= dueAt) {
    return;
  }

  cancelRetry();
  retryDueAt = dueAt;
  retryHandle = retryScheduler(delayMs, () => {
    retryHandle = undefined;
    retryDueAt = null;
    void flush();
  });
}

export function getRecordKey(table: string, payload: Record<string, unknown>): string {
  if (table === 'user_set_selections' && typeof payload.user_id === 'string' && typeof payload.set_id === 'string') {
    return `${table}:${payload.user_id}:${payload.set_id}`;
  }

  return `${table}:${String(payload.id ?? '')}`;
}

function parseJson(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function withoutLocalFlags(row: Record<string, unknown>): Record<string, unknown> {
  const { pending_sync: _pending, synced_at: _synced, ...rest } = row;
  return rest;
}

async function findLocalRow(
  db: LocalDatabase,
  table: MutableTable,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (typeof payload.id === 'string') {
    const byId = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?;`, [payload.id]);
    if (byId) {
      return byId;
    }
  }

  if (table === 'user_set_selections' && typeof payload.user_id === 'string' && typeof payload.set_id === 'string') {
    return db.getFirstAsync<Record<string, unknown>>('SELECT * FROM user_set_selections WHERE user_id = ? AND set_id = ? LIMIT 1;', [
      payload.user_id,
      payload.set_id,
    ]);
  }

  return null;
}

async function deleteLocalRecord(db: LocalDatabase, table: MutableTable, payload: Record<string, unknown>): Promise<void> {
  if (table === 'user_set_selections' && typeof payload.user_id === 'string' && typeof payload.set_id === 'string') {
    await db.runAsync('DELETE FROM user_set_selections WHERE id = ? OR (user_id = ? AND set_id = ?);', [
      typeof payload.id === 'string' ? payload.id : '',
      payload.user_id,
      payload.set_id,
    ]);
    return;
  }

  if (typeof payload.id === 'string') {
    await db.runAsync(`DELETE FROM ${table} WHERE id = ?;`, [payload.id]);
  }
}

export function configureSyncService(options: {
  transport: SyncTransport;
  /** Returns the stored session (or null). When provided, `flush()` never sends without a usable session. */
  getSession?: () => SyncSessionState | null;
}): void {
  syncTransport = options.transport;
  getSessionState = options.getSession ?? null;
  ensureListener();
}

/** Current NetInfo reachability as last reported (optimistically `true` until the first report). */
export function isOnline(): boolean {
  return online;
}

export function subscribeToSyncEvents(listener: SyncEventListener): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

/**
 * Applies the mutation to the local cache optimistically and queues it for the server, in one
 * local transaction. Starts a background flush when online; it does not wait for the network.
 */
export async function enqueue(operation: SyncOperation): Promise<EnqueueResult> {
  if (!isMutableTable(operation.table)) {
    throw new Error(`Table ${String(operation.table)} is not synced through the queue.`);
  }

  ensureListener();
  const table = operation.table;
  const payload = withoutLocalFlags({ ...operation.payload });
  if (typeof payload.id !== 'string' || payload.id.length === 0) {
    payload.id = createId();
  }
  const recordId = payload.id as string;
  const recordKey = getRecordKey(table, payload);
  const createdAt = operation.created_at ?? new Date().toISOString();
  const queueId = createId();
  const db = await getDb();

  await db.transaction(async (tx) => {
    const previous = await findLocalRow(tx, table, payload);

    if (operation.type !== 'delete') {
      if (previous && previous.id !== recordId) {
        // Another local row represents the same selection: replace it.
        await tx.runAsync(`DELETE FROM ${table} WHERE id = ?;`, [previous.id]);
      }
      await upsertRows(table, [{ ...payload, pending_sync: 1, synced_at: null }], tx);
    } else {
      await deleteLocalRecord(tx, table, payload);
    }

    const seqRow = await tx.getFirstAsync<{ next_seq: number }>('SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM sync_queue;');
    await upsertRows(
      'sync_queue',
      [
        {
          id: queueId,
          table_name: table,
          operation_type: operation.type,
          payload_json: JSON.stringify(payload),
          attempt_count: 0,
          next_retry_at: null,
          last_error: null,
          created_at: createdAt,
          pending_sync: 1,
          record_id: recordId,
          record_key: recordKey,
          previous_json: previous ? JSON.stringify(previous) : null,
          parked: 0,
          seq: seqRow?.next_seq ?? 1,
        },
      ],
      tx,
    );
  });

  for (const tracker of activityTrackers) {
    tracker.operations.push({ table, type: operation.type, recordId, payload: { ...payload } });
  }
  emit({ type: 'queued', table, recordId });

  if (online && syncTransport) {
    void flush().catch(() => undefined);
  }

  return { queueId, recordId };
}

async function countPendingForKey(db: LocalDatabase, recordKey: string, table: string, recordId: string | null): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM sync_queue WHERE pending_sync = 1 AND ${SAME_RECORD_CONDITION};`,
    [recordKey, table, recordId ?? ''],
  );
  return Number(row?.count ?? 0);
}

const SAME_RECORD_CONDITION = '(record_key = ? OR (record_key IS NULL AND table_name = ? AND record_id = ?))';

/**
 * Sets `previous_json` — the state a permanent failure rolls back to — on every still-queued operation
 * for the same record that was queued after `row`. Operations for one record are sent strictly in
 * order, so once `row` is resolved this is the best-known server state for all of them.
 */
async function setPreviousForLaterOperations(
  db: LocalDatabase,
  row: QueueRow,
  recordKey: string,
  previous: (laterPrevious: Record<string, unknown> | null) => Record<string, unknown> | null,
): Promise<void> {
  const sameRecord = await db.getAllAsync<{ id: string; previous_json: string | null }>(
    `SELECT id, previous_json FROM sync_queue WHERE pending_sync = 1 AND ${SAME_RECORD_CONDITION}
     ORDER BY seq ASC, created_at ASC, rowid ASC;`,
    [recordKey, row.table_name, row.record_id ?? ''],
  );
  const position = sameRecord.findIndex((operation) => operation.id === row.id);
  const later = position === -1 ? [] : sameRecord.slice(position + 1);
  for (const operation of later) {
    const next = previous(parseJson(operation.previous_json));
    await db.runAsync('UPDATE sync_queue SET previous_json = ? WHERE id = ?;', [next ? JSON.stringify(next) : null, operation.id]);
  }
}

async function markSucceeded(row: QueueRow, payload: Record<string, unknown>, recordKey: string): Promise<void> {
  const db = await getDb();
  const syncedAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    // Later operations for this record now roll back to what the server just accepted, not to an
    // optimistic row that was never confirmed (or to nothing at all).
    await setPreviousForLaterOperations(tx, row, recordKey, (laterPrevious) =>
      row.operation_type !== 'delete' ? { ...(laterPrevious ?? {}), ...payload, pending_sync: 0, synced_at: syncedAt } : null,
    );
    await tx.runAsync('DELETE FROM sync_queue WHERE id = ?;', [row.id]);
    if (row.operation_type !== 'delete' && typeof payload.id === 'string') {
      const remaining = await countPendingForKey(tx, recordKey, row.table_name, row.record_id);
      if (remaining === 0) {
        await tx.runAsync(`UPDATE ${row.table_name} SET pending_sync = 0, synced_at = ? WHERE id = ?;`, [syncedAt, payload.id]);
      }
    }
  });
  emit({ type: 'synced', table: row.table_name, recordId: String(row.record_id ?? payload.id ?? '') });
}

async function markPermanentFailure(row: QueueRow, payload: Record<string, unknown>, recordKey: string, error: unknown): Promise<void> {
  const db = await getDb();
  const { code, message } = describeSyncError(error);
  const failure: FailedOperation = {
    id: createId(),
    table: row.table_name,
    type: row.operation_type,
    recordId: row.record_id ?? (typeof payload.id === 'string' ? payload.id : null),
    payload,
    errorCode: code,
    errorMessage: message,
    failedAt: new Date().toISOString(),
  };

  await db.transaction(async (tx) => {
    // `row` was read when the pass started; an earlier success may have updated previous_json since.
    const current = await tx.getFirstAsync<{ previous_json: string | null }>('SELECT previous_json FROM sync_queue WHERE id = ?;', [row.id]);
    const previousJson = current ? current.previous_json : row.previous_json;
    // The server never applied this operation, so the state before it is still the state before
    // every later operation for the same record.
    await setPreviousForLaterOperations(tx, row, recordKey, () => parseJson(previousJson));
    await tx.runAsync('DELETE FROM sync_queue WHERE id = ?;', [row.id]);
    await upsertRows(
      'sync_failures',
      [
        {
          id: failure.id,
          table_name: failure.table,
          operation_type: failure.type,
          record_id: failure.recordId,
          payload_json: row.payload_json,
          error_code: failure.errorCode,
          error_message: failure.errorMessage,
          failed_at: failure.failedAt,
        },
      ],
      tx,
    );

    // Later queued operations for the same record reflect newer intent: leave the local row to them.
    if ((await countPendingForKey(tx, recordKey, row.table_name, row.record_id)) > 0) {
      return;
    }

    const previous = parseJson(previousJson);
    // A previous row that was itself unsynced has no confirmed server state to return to.
    const restorable = previous && Number(previous.pending_sync ?? 0) === 0 ? previous : null;

    if (row.operation_type !== 'delete') {
      if (typeof payload.id === 'string') {
        await tx.runAsync(`DELETE FROM ${row.table_name} WHERE id = ?;`, [payload.id]);
      }
      if (restorable) {
        await upsertRows(row.table_name, [{ ...restorable, pending_sync: 0 }], tx);
      }
    } else if (restorable) {
      await upsertRows(row.table_name, [{ ...restorable, pending_sync: 0 }], tx);
    }
  });

  emit({ type: 'failed', table: row.table_name, recordId: String(failure.recordId ?? ''), failure });
}

/**
 * A queued update found no server row: the record was deleted elsewhere (by a group admin, by
 * moderation, or on another device). Deletion wins — the operation is dropped and, unless later
 * operations for the record are still queued, the local row is removed. Nothing is recorded as failed.
 */
async function markMissingOnServer(row: QueueRow, payload: Record<string, unknown>, recordKey: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await setPreviousForLaterOperations(tx, row, recordKey, () => null);
    await tx.runAsync('DELETE FROM sync_queue WHERE id = ?;', [row.id]);
    if ((await countPendingForKey(tx, recordKey, row.table_name, row.record_id)) === 0) {
      await deleteLocalRecord(tx, row.table_name, payload);
    }
  });
  emit({ type: 'missing', table: row.table_name, recordId: String(row.record_id ?? payload.id ?? '') });
}

async function markTransientFailure(row: QueueRow, error: unknown, countsAsAttempt: boolean): Promise<void> {
  const db = await getDb();
  const { message } = describeSyncError(error);
  const attemptCount = row.attempt_count + (countsAsAttempt ? 1 : 0);

  if (attemptCount >= MAX_SYNC_ATTEMPTS) {
    await db.runAsync('UPDATE sync_queue SET attempt_count = ?, last_error = ?, next_retry_at = NULL, parked = 1 WHERE id = ?;', [
      attemptCount,
      message,
      row.id,
    ]);
    emit({ type: 'parked', table: row.table_name, recordId: String(row.record_id ?? '') });
    return;
  }

  const delayMs = countsAsAttempt ? getBackoffDelayMs(attemptCount) : SESSION_RETRY_DELAY_MS;
  await db.runAsync('UPDATE sync_queue SET attempt_count = ?, last_error = ?, next_retry_at = ? WHERE id = ?;', [
    attemptCount,
    message,
    new Date(Date.now() + delayMs).toISOString(),
    row.id,
  ]);
  scheduleRetry(delayMs);
}

function hasUsableSession(): boolean | 'expiring' {
  if (!getSessionState) {
    return true;
  }

  let session: SyncSessionState | null = null;
  try {
    session = getSessionState();
  } catch {
    session = null;
  }

  if (!session) {
    return false;
  }

  return session.expiresAt - Date.now() <= SESSION_EXPIRY_MARGIN_MS ? 'expiring' : true;
}

async function runFlushPass(transport: SyncTransport): Promise<void> {
  const passGeneration = generation;
  const sessionState = hasUsableSession();
  if (sessionState === false) {
    // Signed out: nothing is sent; sign-in triggers the next flush.
    return;
  }
  if (sessionState === 'expiring') {
    scheduleRetry(SESSION_RETRY_DELAY_MS);
    return;
  }

  const db = await getDb();
  if (!parkedReleasedThisSession) {
    // Parked operations get one fresh round of attempts per app session.
    parkedReleasedThisSession = true;
    await db.runAsync('UPDATE sync_queue SET parked = 0, attempt_count = 0, next_retry_at = NULL WHERE parked = 1;');
  }

  const queue = await db.getAllAsync<QueueRow>(
    `SELECT ${QUEUE_COLUMNS} FROM sync_queue WHERE pending_sync = 1 ORDER BY seq ASC, created_at ASC, rowid ASC;`,
  );
  const blockedKeys = new Set<string>();
  let earliestRetryMs: number | null = null;

  for (const row of queue) {
    if (passGeneration !== generation || !online) {
      return;
    }

    const payload = parseJson(row.payload_json) ?? {};
    const recordKey = row.record_key ?? getRecordKey(row.table_name, payload);

    if (row.parked || blockedKeys.has(recordKey)) {
      blockedKeys.add(recordKey);
      continue;
    }

    if (row.next_retry_at) {
      const dueInMs = Date.parse(row.next_retry_at) - Date.now();
      if (dueInMs > 0) {
        blockedKeys.add(recordKey);
        earliestRetryMs = earliestRetryMs === null ? dueInMs : Math.min(earliestRetryMs, dueInMs);
        continue;
      }
    }

    if (!isMutableTable(row.table_name)) {
      await markPermanentFailure(row, payload, recordKey, new Error(`Unsupported sync table ${String(row.table_name)}`));
      continue;
    }

    let failure: unknown = null;
    let missingOnServer = false;
    try {
      const body = stripPayloadForServer(row.table_name, payload);
      if (row.operation_type === 'upsert') {
        await transport.upsert(row.table_name, body);
      } else if (row.operation_type === 'update') {
        missingOnServer = !(await transport.update(row.table_name, body)).found;
      } else {
        await transport.delete(row.table_name, body);
      }
    } catch (error) {
      failure = error ?? new Error('Unknown sync failure');
    }

    if (passGeneration !== generation) {
      // Local user data was wiped while the request was in flight.
      return;
    }

    if (failure === null && missingOnServer) {
      await markMissingOnServer(row, payload, recordKey);
      continue;
    }

    const outcome = failure === null ? 'success' : classifySyncError(failure, row.table_name, row.operation_type);
    if (outcome === 'success') {
      await markSucceeded(row, payload, recordKey);
      continue;
    }

    if (outcome === 'permanent') {
      await markPermanentFailure(row, payload, recordKey, failure);
      continue;
    }

    const sessionUnavailable = isSessionUnavailableError(failure);
    await markTransientFailure(row, failure, !sessionUnavailable);
    blockedKeys.add(recordKey);
    if (sessionUnavailable || isConnectivityError(failure)) {
      // Everything behind this would fail the same way; stop and let the backoff retry.
      return;
    }
  }

  if (earliestRetryMs !== null) {
    scheduleRetry(earliestRetryMs);
  }
}

/** Sends due queue operations in order. Concurrent calls share one run (and trigger one more pass). */
export async function flush(): Promise<void> {
  ensureListener();
  const transport = syncTransport;
  if (!transport || !online) {
    return;
  }

  if (flushPromise) {
    flushRequested = true;
    return flushPromise;
  }

  flushPromise = (async () => {
    do {
      flushRequested = false;
      await runFlushPass(transport);
    } while (flushRequested && online && syncTransport);
  })().finally(() => {
    flushPromise = null;
  });

  return flushPromise;
}

/** Unparks every parked operation and flushes. */
export async function retryParkedOperations(): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE sync_queue SET parked = 0, attempt_count = 0, next_retry_at = NULL WHERE parked = 1;');
  await flush();
}

/** Number of operations not yet accepted by the server (including parked ones). */
export async function getPendingCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM sync_queue WHERE pending_sync = 1;');
  return Number(row?.count ?? 0);
}

function toPendingOperation(row: QueueRow): PendingOperation {
  const payload = parseJson(row.payload_json) ?? {};
  return {
    id: row.id,
    table: row.table_name,
    type: row.operation_type,
    recordId: row.record_id ?? String(payload.id ?? ''),
    payload,
    attemptCount: Number(row.attempt_count),
    parked: Number(row.parked) === 1,
    lastError: row.last_error,
    nextRetryAt: row.next_retry_at,
    createdAt: row.created_at,
  };
}

/**
 * Unsent operations, oldest first. Pass `db` (a transaction handle) to read the queue inside a running
 * transaction.
 */
export async function getPendingOperations(table?: MutableTable, db?: LocalDatabase): Promise<PendingOperation[]> {
  const database = db ?? (await getDb());
  const rows = table
    ? await database.getAllAsync<QueueRow>(
        `SELECT ${QUEUE_COLUMNS} FROM sync_queue WHERE pending_sync = 1 AND table_name = ? ORDER BY seq ASC, created_at ASC, rowid ASC;`,
        [table],
      )
    : await database.getAllAsync<QueueRow>(
        `SELECT ${QUEUE_COLUMNS} FROM sync_queue WHERE pending_sync = 1 ORDER BY seq ASC, created_at ASC, rowid ASC;`,
      );
  return rows.map(toPendingOperation);
}

/** Record ids (payload `id`) with at least one unsent operation for `table`. */
export async function getPendingOperationIds(table: MutableTable, db?: LocalDatabase): Promise<string[]> {
  const operations = await getPendingOperations(table, db);
  return [...new Set(operations.map((operation) => operation.recordId).filter((id) => id.length > 0))];
}

export async function getFailedOperations(): Promise<FailedOperation[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    table_name: MutableTable;
    operation_type: SyncOperationType;
    record_id: string | null;
    payload_json: string;
    error_code: string | null;
    error_message: string | null;
    failed_at: string;
  }>('SELECT id, table_name, operation_type, record_id, payload_json, error_code, error_message, failed_at FROM sync_failures ORDER BY failed_at DESC;');

  return rows.map((row) => ({
    id: row.id,
    table: row.table_name,
    type: row.operation_type,
    recordId: row.record_id,
    payload: parseJson(row.payload_json) ?? {},
    errorCode: row.error_code,
    errorMessage: row.error_message,
    failedAt: row.failed_at,
  }));
}

export async function clearFailedOperations(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM sync_failures;');
}

/**
 * Starts recording queue activity. A refresh that fetches server rows and merges them into the cache
 * takes a snapshot of the queue (`getPendingOperations`) after starting the tracker and before the
 * fetch: every operation that could have reached the server while the fetch was in flight is then
 * either in that snapshot or in `tracker.operations`, even when it was flushed before the merge ran.
 * Always `stop()` the tracker (in a `finally`).
 */
export function trackQueueActivity(): QueueActivityTracker {
  const state: ActiveTracker = { operations: [], cleared: false };
  activityTrackers.add(state);
  return {
    get operations() {
      return state.operations;
    },
    get cleared() {
      return state.cleared;
    },
    stop() {
      activityTrackers.delete(state);
    },
  };
}

/**
 * Deletes everything that belongs to the signed-in user: cached user rows, the queue and recorded
 * failures. The public festival catalog (festivals/stages/artists/sets) is kept. In-flight sync
 * results are discarded.
 */
export async function clearLocalUserData(): Promise<void> {
  generation += 1;
  cancelRetry();
  for (const tracker of activityTrackers) {
    tracker.cleared = true;
  }
  const db = await getDb();
  await db.transaction(async (tx) => {
    for (const table of USER_DATA_TABLES) {
      await tx.runAsync(`DELETE FROM ${table};`);
    }
  });
  emit({ type: 'cleared' });
}

export function setOnlineStatusForTests(value: boolean): void {
  online = value;
}

export function setRetrySchedulerForTests(scheduler: RetryScheduler, canceller?: RetryCanceller): void {
  retryScheduler = scheduler;
  retryCanceller = canceller ?? (() => undefined);
}

export function resetSyncServiceForTests(): void {
  cancelRetry();
  unsubscribeNetInfo?.();
  unsubscribeNetInfo = null;
  syncTransport = null;
  getSessionState = null;
  online = true;
  listenerStarted = false;
  flushPromise = null;
  flushRequested = false;
  parkedReleasedThisSession = false;
  eventListeners.clear();
  activityTrackers.clear();
  retryScheduler = (delayMs, callback) => setTimeout(callback, delayMs);
  retryCanceller = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>);
}
