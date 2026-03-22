import NetInfo from '@react-native-community/netinfo';

import { getDb, upsertRows } from './db';
import type { SyncOperation } from './types';

interface QueueRow {
  id: string;
  table_name: string;
  operation_type: 'upsert' | 'delete';
  payload_json: string;
  attempt_count: number;
  next_retry_at: string | null;
  created_at: string;
}

export interface SyncTransport {
  upsert(table: string, payload: Record<string, unknown>): Promise<void>;
  delete(table: string, payload: Record<string, unknown>): Promise<void>;
}

type RetryScheduler = (delayMs: number, callback: () => void) => unknown;

const MUTABLE_TABLES = new Set(['user_set_selections', 'meetups']);

let syncTransport: SyncTransport | null = null;
let online = true;
let listenerStarted = false;
let flushPromise: Promise<void> | null = null;
let retryHandle: unknown;
let retryScheduler: RetryScheduler = (delayMs, callback) => setTimeout(callback, delayMs);

function createId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `sync_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getBackoffDelayMs(attempt: number): number {
  return Math.min(30_000, 2 ** Math.max(0, attempt - 1) * 1_000);
}

function ensureListener(): void {
  if (listenerStarted) {
    return;
  }

  listenerStarted = true;
  void NetInfo.fetch().then((state) => {
    online = Boolean(state.isConnected && state.isInternetReachable !== false);
  });

  NetInfo.addEventListener((state) => {
    const nextOnline = Boolean(state.isConnected && state.isInternetReachable !== false);
    const wasOffline = !online && nextOnline;
    online = nextOnline;
    if (wasOffline) {
      void flush();
    }
  });
}

function scheduleRetry(delayMs: number): void {
  if (retryHandle) {
    clearTimeout(retryHandle as NodeJS.Timeout);
  }

  retryHandle = retryScheduler(delayMs, () => {
    retryHandle = undefined;
    void flush();
  });
}

function ensureMutableRecordShape(operation: SyncOperation): Record<string, unknown> {
  const nextPayload = { ...operation.payload };
  if (!('id' in nextPayload) || typeof nextPayload.id !== 'string' || nextPayload.id.length === 0) {
    nextPayload.id = createId();
  }

  nextPayload.pending_sync = true;
  nextPayload.synced_at = null;
  return nextPayload;
}

async function enqueueLocalMutation(operation: SyncOperation): Promise<SyncOperation> {
  const db = await getDb();
  const payload = MUTABLE_TABLES.has(operation.table) ? ensureMutableRecordShape(operation) : { ...operation.payload };
  const queuedOperation: SyncOperation = {
    ...operation,
    payload,
  };

  await db.transaction(async (tx) => {
    if (queuedOperation.type === 'upsert' && MUTABLE_TABLES.has(queuedOperation.table)) {
      await upsertRows(queuedOperation.table, [payload], tx);
    }

    if (queuedOperation.type === 'delete' && MUTABLE_TABLES.has(queuedOperation.table) && typeof payload.id === 'string') {
      await tx.runAsync(`DELETE FROM ${queuedOperation.table} WHERE id = ?;`, [payload.id]);
    }

    await upsertRows(
      'sync_queue',
      [
        {
          id: createId(),
          table_name: queuedOperation.table,
          operation_type: queuedOperation.type,
          payload_json: JSON.stringify(payload),
          attempt_count: 0,
          next_retry_at: null,
          last_error: null,
          created_at: queuedOperation.created_at,
          pending_sync: 1,
        },
      ],
      tx,
    );
  });

  return queuedOperation;
}

async function markQueueRowSucceeded(queueRow: QueueRow, payload: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    if (queueRow.operation_type === 'upsert' && MUTABLE_TABLES.has(queueRow.table_name) && typeof payload.id === 'string') {
      await tx.runAsync(
        `UPDATE ${queueRow.table_name} SET pending_sync = 0, synced_at = ? WHERE id = ?;`,
        [new Date().toISOString(), payload.id],
      );
    }

    await tx.runAsync('DELETE FROM sync_queue WHERE id = ?;', [queueRow.id]);
  });
}

async function markQueueRowFailed(queueRow: QueueRow, error: unknown): Promise<void> {
  const db = await getDb();
  const attemptCount = queueRow.attempt_count + 1;
  const delayMs = getBackoffDelayMs(attemptCount);
  const nextRetryAt = new Date(Date.now() + delayMs).toISOString();
  await db.runAsync('UPDATE sync_queue SET attempt_count = ?, last_error = ?, next_retry_at = ? WHERE id = ?;', [
    attemptCount,
    error instanceof Error ? error.message : String(error),
    nextRetryAt,
    queueRow.id,
  ]);
  scheduleRetry(delayMs);
}

export function configureSyncService(options: { transport: SyncTransport }): void {
  syncTransport = options.transport;
  ensureListener();
}

export async function enqueue(operation: SyncOperation): Promise<void> {
  ensureListener();
  await enqueueLocalMutation(operation);

  if (online) {
    await flush();
  }
}

export async function flush(): Promise<void> {
  ensureListener();
  if (!syncTransport || !online) {
    return;
  }

  if (flushPromise) {
    return flushPromise;
  }

  flushPromise = (async () => {
    const db = await getDb();
    const now = new Date().toISOString();
    const queue = await db.getAllAsync<QueueRow>(
      `SELECT id, table_name, operation_type, payload_json, attempt_count, next_retry_at, created_at
       FROM sync_queue
       WHERE pending_sync = 1
         AND (next_retry_at IS NULL OR next_retry_at <= ?)
       ORDER BY created_at ASC;`,
      [now],
    );

    for (const queueRow of queue) {
      const payload = JSON.parse(queueRow.payload_json) as Record<string, unknown>;
      try {
        if (queueRow.operation_type === 'upsert') {
          await syncTransport.upsert(queueRow.table_name, payload);
        } else {
          await syncTransport.delete(queueRow.table_name, payload);
        }
        await markQueueRowSucceeded(queueRow, payload);
      } catch (error) {
        await markQueueRowFailed(queueRow, error);
      }
    }
  })().finally(() => {
    flushPromise = null;
  });

  return flushPromise;
}

export async function getPendingCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM sync_queue WHERE pending_sync = 1;');
  return row?.count ?? 0;
}

export function setOnlineStatusForTests(value: boolean): void {
  online = value;
}

export function setRetrySchedulerForTests(scheduler: RetryScheduler): void {
  retryScheduler = scheduler;
}

export function resetSyncServiceForTests(): void {
  syncTransport = null;
  online = true;
  listenerStarted = false;
  flushPromise = null;
  retryHandle = undefined;
  retryScheduler = (delayMs, callback) => setTimeout(callback, delayMs);
}
