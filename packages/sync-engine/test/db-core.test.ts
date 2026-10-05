import { describe, expect, it } from 'vitest';

import { createSerialisedDatabase, type SqliteConnection } from '../src/db-core';
import { createSqlJsDatabase } from '../src/db';

async function setup() {
  const db = await createSqlJsDatabase();
  await db.execAsync('CREATE TABLE items (id TEXT PRIMARY KEY, value TEXT);');
  return db;
}

describe('serialised local database', () => {
  it('runs a statement issued during another transaction after it, so a rollback cannot undo it', async () => {
    const db = await setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const failing = db.transaction(async (tx) => {
      await tx.runAsync('INSERT INTO items (id, value) VALUES (?, ?);', ['a', 'in-tx']);
      await gate;
      throw new Error('boom');
    });
    // Issued while the transaction above is open.
    const unrelated = db.runAsync('INSERT INTO items (id, value) VALUES (?, ?);', ['b', 'outside']);
    release();

    await expect(failing).rejects.toThrow('boom');
    await unrelated;
    expect(await db.getAllAsync<{ id: string }>('SELECT id FROM items ORDER BY id;')).toEqual([{ id: 'b' }]);
  });

  it('does not let reads observe a transaction half-way', async () => {
    const db = await setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const writing = db.transaction(async (tx) => {
      await tx.runAsync('INSERT INTO items (id, value) VALUES (?, ?);', ['a', '1']);
      await gate;
      await tx.runAsync('INSERT INTO items (id, value) VALUES (?, ?);', ['b', '2']);
    });
    const reading = db.getAllAsync<{ id: string }>('SELECT id FROM items ORDER BY id;');
    release();
    await writing;
    expect(await reading).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('joins nested transactions and routes a leaked handle through the queue', async () => {
    const statements: string[] = [];
    const connection: SqliteConnection = {
      async execAsync(sql) {
        statements.push(sql);
      },
      async runAsync(sql) {
        statements.push(sql);
        return { changes: 1 };
      },
      async getAllAsync() {
        return [];
      },
      async getFirstAsync() {
        return null;
      },
    };
    const db = createSerialisedDatabase(connection);

    let leaked: Parameters<Parameters<typeof db.transaction>[0]>[0] | null = null;
    await db.transaction(async (tx) => {
      leaked = tx;
      await tx.transaction((nested) => nested.runAsync('UPDATE nested;'));
    });
    await db.transaction(async () => {
      // A handle from a finished transaction must not run inside this one.
      void leaked!.runAsync('UPDATE leaked;');
      await Promise.resolve();
    });
    await db.getFirstAsync('SELECT 1;');

    expect(statements).toEqual([
      'BEGIN TRANSACTION;',
      'UPDATE nested;',
      'COMMIT;',
      'BEGIN TRANSACTION;',
      'COMMIT;',
      'UPDATE leaked;',
    ]);
  });
});
