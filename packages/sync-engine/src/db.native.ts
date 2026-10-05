import { createExpoAdapter, setDefaultDatabaseFactory, type LocalDatabase } from './db-core';

export * from './db-core';

const DATABASE_NAME = 'festival_cache.db';

/** sql.js is not bundled on native; kept so `db.ts` and `db.native.ts` export the same API. */
export async function createSqlJsDatabase(): Promise<LocalDatabase> {
  throw new Error('createSqlJsDatabase is not available on native platforms.');
}

async function openDefaultDatabase(): Promise<LocalDatabase> {
  const sqliteModule = await import('expo-sqlite');
  if (!('openDatabaseAsync' in sqliteModule)) {
    throw new Error('expo-sqlite openDatabaseAsync is unavailable on this native platform.');
  }

  const database = await sqliteModule.openDatabaseAsync(DATABASE_NAME);
  return createExpoAdapter(database);
}

setDefaultDatabaseFactory(openDefaultDatabase);
