import type { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js';

import { createExpoAdapter, createSerialisedDatabase, setDefaultDatabaseFactory, type LocalDatabase } from './db-core';

export * from './db-core';

const DATABASE_NAME = 'festival_cache.db';

function createSqlJsAdapter(database: SqlJsDatabase): LocalDatabase {
  const getAllAsync = async <T>(sql: string, params: unknown[]): Promise<T[]> => {
    const statement = database.prepare(sql);
    try {
      statement.bind(params as never[]);
      const rows: T[] = [];
      while (statement.step()) {
        rows.push(statement.getAsObject() as T);
      }
      return rows;
    } finally {
      statement.free();
    }
  };

  return createSerialisedDatabase({
    async execAsync(sql) {
      database.exec(sql);
    },
    async runAsync(sql, params) {
      const statement = database.prepare(sql);
      try {
        statement.run(params as never[]);
        return { changes: database.getRowsModified() };
      } finally {
        statement.free();
      }
    },
    getAllAsync,
    async getFirstAsync<T>(sql: string, params: unknown[]) {
      const rows = await getAllAsync<T>(sql, params);
      return rows[0] ?? null;
    },
  });
}

/** In-memory SQLite (sql.js / WASM). Used on platforms without expo-sqlite and by tests. */
export async function createSqlJsDatabase(): Promise<LocalDatabase> {
  const sqlJsModule = (await import('sql.js')) as unknown as {
    default?: (config?: Record<string, unknown>) => Promise<SqlJsStatic>;
  } & ((config?: Record<string, unknown>) => Promise<SqlJsStatic>);
  const initSqlJs = typeof sqlJsModule.default === 'function' ? sqlJsModule.default : sqlJsModule;
  const SQL = await initSqlJs({});
  return createSqlJsAdapter(new SQL.Database());
}

async function openDefaultDatabase(): Promise<LocalDatabase> {
  try {
    const sqliteModule = await import('expo-sqlite');
    if ('openDatabaseAsync' in sqliteModule) {
      const database = await sqliteModule.openDatabaseAsync(DATABASE_NAME);
      return createExpoAdapter(database);
    }
  } catch (error) {
    if (!(error instanceof Error) || !/Cannot find module/.test(error.message)) {
      throw error;
    }
  }

  return createSqlJsDatabase();
}

setDefaultDatabaseFactory(openDefaultDatabase);
