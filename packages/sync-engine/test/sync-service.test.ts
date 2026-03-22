import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-community/netinfo', () => ({
  default: {
    addEventListener: vi.fn(() => () => undefined),
    fetch: vi.fn(async () => ({
      isConnected: true,
      isInternetReachable: true,
    })),
  },
}));

import { resetDbForTests, setDatabaseFactoryForTests, type LocalDatabase } from '../src/db';
import {
  configureSyncService,
  enqueue,
  flush,
  getPendingCount,
  resetSyncServiceForTests,
  setOnlineStatusForTests,
  setRetrySchedulerForTests,
  type SyncTransport,
} from '../src/sync-service';

class MemoryDatabase implements LocalDatabase {
  private tables = new Map<string, Array<Record<string, unknown>>>();

  async execAsync(sql: string): Promise<void> {
    const createTableMatches = sql.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/gi);
    for (const match of createTableMatches) {
      this.tables.set(match[1], this.tables.get(match[1]) ?? []);
    }
  }

  async runAsync(sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertRowId?: number }> {
    if (/INSERT INTO sync_queue/i.test(sql)) {
      this.insertOrReplace('sync_queue', sql, params);
      return { changes: 1 };
    }

    if (/INSERT INTO user_set_selections/i.test(sql)) {
      this.insertOrReplace('user_set_selections', sql, params);
      return { changes: 1 };
    }

    if (/UPDATE user_set_selections SET pending_sync = 0/i.test(sql)) {
      const rows = this.tables.get('user_set_selections') ?? [];
      const row = rows.find((candidate) => candidate.id === params[1]);
      if (row) {
        row.pending_sync = 0;
        row.synced_at = params[0];
      }
      return { changes: row ? 1 : 0 };
    }

    if (/DELETE FROM user_set_selections/i.test(sql)) {
      const rows = this.tables.get('user_set_selections') ?? [];
      this.tables.set(
        'user_set_selections',
        rows.filter((row) => row.id !== params[0]),
      );
      return { changes: 1 };
    }

    if (/DELETE FROM sync_queue/i.test(sql)) {
      const rows = this.tables.get('sync_queue') ?? [];
      this.tables.set(
        'sync_queue',
        rows.filter((row) => row.id !== params[0]),
      );
      return { changes: 1 };
    }

    if (/UPDATE sync_queue SET attempt_count/i.test(sql)) {
      const rows = this.tables.get('sync_queue') ?? [];
      const row = rows.find((candidate) => candidate.id === params[3]);
      if (row) {
        row.attempt_count = params[0];
        row.last_error = params[1];
        row.next_retry_at = params[2];
      }
      return { changes: row ? 1 : 0 };
    }

    throw new Error(`Unsupported SQL in MemoryDatabase: ${sql}`);
  }

  async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (/FROM sync_queue/i.test(sql)) {
      const now = String(params[0]);
      const rows = [...(this.tables.get('sync_queue') ?? [])]
        .filter((row) => row.pending_sync === 1 && (!row.next_retry_at || String(row.next_retry_at) <= now))
        .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
      return rows as T[];
    }

    throw new Error(`Unsupported SQL in MemoryDatabase: ${sql}`);
  }

  async getFirstAsync<T>(sql: string): Promise<T | null> {
    if (/COUNT\(\*\) AS count FROM sync_queue/i.test(sql)) {
      return {
        count: (this.tables.get('sync_queue') ?? []).filter((row) => row.pending_sync === 1).length,
      } as T;
    }

    return null;
  }

  async transaction<T>(callback: (db: LocalDatabase) => Promise<T>): Promise<T> {
    return callback(this);
  }

  private insertOrReplace(table: string, sql: string, params: unknown[]): void {
    const columnsMatch = sql.match(/\(([^)]+)\)\s+VALUES/i);
    if (!columnsMatch) {
      throw new Error(`Unable to parse columns for SQL: ${sql}`);
    }

    const columns = columnsMatch[1].split(',').map((column) => column.trim());
    const row = Object.fromEntries(columns.map((column, index) => [column, params[index]]));
    const rows = this.tables.get(table) ?? [];
    const existingIndex = rows.findIndex((candidate) => candidate.id === row.id);
    if (existingIndex >= 0) {
      rows[existingIndex] = { ...rows[existingIndex], ...row };
    } else {
      rows.push(row);
    }
    this.tables.set(table, rows);
  }
}

describe('sync-service', () => {
  let database: MemoryDatabase;
  let transport: SyncTransport;

  beforeEach(() => {
    database = new MemoryDatabase();
    setDatabaseFactoryForTests(async () => database);
    resetSyncServiceForTests();
    setOnlineStatusForTests(true);
    transport = {
      upsert: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    configureSyncService({ transport });
  });

  afterEach(() => {
    resetDbForTests();
    resetSyncServiceForTests();
  });

  it('tracks pending operations while offline', async () => {
    setOnlineStatusForTests(false);

    await enqueue({
      table: 'user_set_selections',
      type: 'upsert',
      payload: {
        id: 'selection-1',
        user_id: 'user-1',
        festival_id: 'festival-1',
        set_id: 'set-1',
        selected_at: '2026-08-21T18:00:00.000Z',
      },
      created_at: '2026-08-21T18:00:00.000Z',
      pending_sync: true,
    });
    await enqueue({
      table: 'user_set_selections',
      type: 'upsert',
      payload: {
        id: 'selection-2',
        user_id: 'user-1',
        festival_id: 'festival-1',
        set_id: 'set-2',
        selected_at: '2026-08-21T19:00:00.000Z',
      },
      created_at: '2026-08-21T19:00:00.000Z',
      pending_sync: true,
    });
    await enqueue({
      table: 'user_set_selections',
      type: 'upsert',
      payload: {
        id: 'selection-3',
        user_id: 'user-1',
        festival_id: 'festival-1',
        set_id: 'set-3',
        selected_at: '2026-08-21T20:00:00.000Z',
      },
      created_at: '2026-08-21T20:00:00.000Z',
      pending_sync: true,
    });

    expect(await getPendingCount()).toBe(3);
  });

  it('flushes queued operations when connectivity returns', async () => {
    setOnlineStatusForTests(false);

    await enqueue({
      table: 'user_set_selections',
      type: 'upsert',
      payload: {
        id: 'selection-1',
        user_id: 'user-1',
        festival_id: 'festival-1',
        set_id: 'set-1',
        selected_at: '2026-08-21T18:00:00.000Z',
      },
      created_at: '2026-08-21T18:00:00.000Z',
      pending_sync: true,
    });

    setOnlineStatusForTests(true);
    await flush();

    expect(transport.upsert).toHaveBeenCalledTimes(1);
    expect(await getPendingCount()).toBe(0);
  });

  it('retries failed sync operations with backoff', async () => {
    const scheduledDelays: number[] = [];
    setRetrySchedulerForTests((delayMs, callback) => {
      scheduledDelays.push(delayMs);
      return setTimeout(callback, 0);
    });
    transport.upsert = vi.fn(async () => {
      throw new Error('500');
    });

    await enqueue({
      table: 'user_set_selections',
      type: 'upsert',
      payload: {
        id: 'selection-1',
        user_id: 'user-1',
        festival_id: 'festival-1',
        set_id: 'set-1',
        selected_at: '2026-08-21T18:00:00.000Z',
      },
      created_at: '2026-08-21T18:00:00.000Z',
      pending_sync: true,
    });

    expect(await getPendingCount()).toBeGreaterThan(0);
    expect(scheduledDelays[0]).toBe(1_000);
  });
});
