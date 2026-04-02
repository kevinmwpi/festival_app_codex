const DATABASE_NAME = 'festival_cache.db';

export interface LocalDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowId?: number }>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
  transaction<T>(callback: (db: LocalDatabase) => Promise<T>): Promise<T>;
}

type DatabaseFactory = () => Promise<LocalDatabase>;

let databasePromise: Promise<LocalDatabase> | null = null;
let databaseFactory: DatabaseFactory = openDefaultDatabase;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    avatar_type TEXT NOT NULL DEFAULT 'initials',
    avatar_value TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS festivals (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    timezone TEXT NOT NULL,
    venue_name TEXT,
    map_asset_url TEXT,
    version INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS stages (
    id TEXT PRIMARY KEY,
    festival_id TEXT NOT NULL,
    name TEXT NOT NULL,
    map_x REAL,
    map_y REAL,
    zone TEXT
  );

  CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    image_url TEXT,
    genre TEXT
  );

  CREATE TABLE IF NOT EXISTS sets (
    id TEXT PRIMARY KEY,
    festival_id TEXT NOT NULL,
    artist_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    set_type TEXT NOT NULL DEFAULT 'performance'
  );

  CREATE TABLE IF NOT EXISTS user_set_selections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    festival_id TEXT NOT NULL,
    set_id TEXT NOT NULL,
    selected_at TEXT NOT NULL,
    note TEXT,
    pending_sync INTEGER NOT NULL DEFAULT 0,
    synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    festival_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL,
    invite_code TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS group_members (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meetups (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    title TEXT NOT NULL,
    stage_id TEXT,
    custom_map_x REAL,
    custom_map_y REAL,
    starts_at TEXT NOT NULL,
    notes TEXT,
    totem_image_url TEXT,
    created_by_user_id TEXT NOT NULL,
    pending_sync INTEGER NOT NULL DEFAULT 0,
    synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY,
    table_name TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    pending_sync INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

function createExpoAdapter(database: {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown): Promise<{ changes: number; lastInsertRowId?: number }>;
  getAllAsync<T>(sql: string, params?: unknown): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown): Promise<T | null>;
}): LocalDatabase {
  const adapter: LocalDatabase = {
    execAsync(sql) {
      return database.execAsync(sql);
    },
    runAsync(sql, params = []) {
      return database.runAsync(sql, params);
    },
    getAllAsync(sql, params = []) {
      return database.getAllAsync(sql, params);
    },
    getFirstAsync(sql, params = []) {
      return database.getFirstAsync(sql, params);
    },
    async transaction(callback) {
      await database.execAsync('BEGIN TRANSACTION;');
      try {
        const result = await callback(adapter);
        await database.execAsync('COMMIT;');
        return result;
      } catch (error) {
        await database.execAsync('ROLLBACK;');
        throw error;
      }
    },
  };

  return adapter;
}

async function openDefaultDatabase(): Promise<LocalDatabase> {
  const sqliteModule = await import('expo-sqlite');
  if (!('openDatabaseAsync' in sqliteModule)) {
    throw new Error('expo-sqlite openDatabaseAsync is unavailable on this native platform.');
  }

  const database = await sqliteModule.openDatabaseAsync(DATABASE_NAME);
  return createExpoAdapter(database);
}

async function initialiseSchema(database: LocalDatabase): Promise<void> {
  await database.execAsync(SCHEMA);
}

export async function getDb(): Promise<LocalDatabase> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const database = await databaseFactory();
      await initialiseSchema(database);
      return database;
    })();
  }

  return databasePromise;
}

export async function withDbTransaction<T>(callback: (db: LocalDatabase) => Promise<T>): Promise<T> {
  const database = await getDb();
  return database.transaction(callback);
}

export function setDatabaseFactoryForTests(factory: DatabaseFactory): void {
  databaseFactory = factory;
  databasePromise = null;
}

export function resetDbForTests(): void {
  databaseFactory = openDefaultDatabase;
  databasePromise = null;
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_]+$/i.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return identifier;
}

export async function upsertRows(table: string, rows: Array<Record<string, unknown>>, db?: LocalDatabase): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const database = db ?? (await getDb());
  const safeTable = quoteIdentifier(table);

  for (const row of rows) {
    const columns = Object.keys(row);
    const safeColumns = columns.map(quoteIdentifier);
    const placeholders = columns.map(() => '?').join(', ');
    const updates = safeColumns
      .filter((column) => column !== 'id')
      .map((column) => `${column}=excluded.${column}`)
      .join(', ');
    const sql = `INSERT INTO ${safeTable} (${safeColumns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates};`;
    await database.runAsync(sql, columns.map((column) => row[column] ?? null));
  }
}

export async function replaceRowsForFestival(
  table: 'stages' | 'sets',
  festivalId: string,
  rows: Array<Record<string, unknown>>,
  db?: LocalDatabase,
): Promise<void> {
  const database = db ?? (await getDb());
  await database.runAsync(`DELETE FROM ${table} WHERE festival_id = ?;`, [festivalId]);
  await upsertRows(table, rows, database);
}

export async function setMeta(key: string, value: string, db?: LocalDatabase): Promise<void> {
  await upsertRows('app_meta', [{ key, value }], db);
}

export async function getMeta(key: string, db?: LocalDatabase): Promise<string | null> {
  const database = db ?? (await getDb());
  const row = await database.getFirstAsync<{ value: string }>('SELECT value FROM app_meta WHERE key = ?;', [key]);
  return row?.value ?? null;
}
