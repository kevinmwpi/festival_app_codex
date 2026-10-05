import type { MutableTable, SyncOperationType } from './types';

/**
 * Columns the server accepts for each queued table. Everything else in a local row
 * (`pending_sync`, `synced_at`, `totem_path`, `custom_map_*`, `created_at`, `updated_at`, …)
 * is stripped before a request is sent.
 */
export const SERVER_PAYLOAD_WHITELIST: Readonly<Record<MutableTable, readonly string[]>> = {
  meetups: ['id', 'group_id', 'title', 'stage_id', 'starts_at', 'notes', 'latitude', 'longitude', 'created_by_user_id'],
  user_set_selections: ['id', 'user_id', 'festival_id', 'set_id', 'selected_at', 'note'],
};

/**
 * Columns a queued `update` may change. Identity and ownership columns (`id`, `group_id`,
 * `created_by_user_id`, `user_id`, `festival_id`, `set_id`) are never part of an update.
 */
export const SERVER_UPDATABLE_COLUMNS: Readonly<Record<MutableTable, readonly string[]>> = {
  meetups: ['title', 'stage_id', 'starts_at', 'notes', 'latitude', 'longitude'],
  user_set_selections: ['selected_at', 'note'],
};

export const MUTABLE_TABLES: ReadonlySet<MutableTable> = new Set<MutableTable>(['user_set_selections', 'meetups']);

export function isMutableTable(table: string): table is MutableTable {
  return MUTABLE_TABLES.has(table as MutableTable);
}

export function stripPayloadForServer(table: string, payload: Record<string, unknown>): Record<string, unknown> {
  if (!isMutableTable(table)) {
    throw new Error(`Table ${table} is not synced through the queue.`);
  }

  const stripped: Record<string, unknown> = {};
  for (const column of SERVER_PAYLOAD_WHITELIST[table]) {
    if (column in payload && payload[column] !== undefined) {
      stripped[column] = payload[column];
    }
  }

  return stripped;
}

/** The `SET` list for a queued update: `payload` reduced to `SERVER_UPDATABLE_COLUMNS`. */
export function pickUpdatableColumns(table: string, payload: Record<string, unknown>): Record<string, unknown> {
  if (!isMutableTable(table)) {
    throw new Error(`Table ${table} is not synced through the queue.`);
  }

  const fields: Record<string, unknown> = {};
  for (const column of SERVER_UPDATABLE_COLUMNS[table]) {
    if (column in payload && payload[column] !== undefined) {
      fields[column] = payload[column];
    }
  }

  return fields;
}

export type SyncErrorClass = 'success' | 'transient' | 'permanent';

export interface SyncErrorLike {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
  /** Set by transports when a request went out without a user JWT (anon key only). */
  sentWithoutUserJwt?: unknown;
}

const TRANSIENT_POSTGREST_CODES = new Set(['PGRST301', 'PGRST303']);
const TRANSIENT_SQLSTATES = new Set(['40001', '40P01', '55P03', '57014', '57P01', '53300', '53400']);
const PERMANENT_CODES = new Set(['42501', '23502', '23503', '23514', '22P02', 'PGRST204']);
const NETWORK_ERROR_NAMES = new Set([
  'AbortError',
  'TimeoutError',
  'FetchTimeoutError',
  'FunctionsFetchError',
  'AuthRetryableFetchError',
]);
const NETWORK_MESSAGE_PATTERN =
  /network request failed|failed to fetch|fetcherror|aborterror|timeouterror|timed out|load failed|network error|econnreset|econnrefused|enotfound|etimedout|socket hang up/i;

function asErrorLike(error: unknown): SyncErrorLike {
  return typeof error === 'object' && error !== null ? (error as SyncErrorLike) : { message: String(error) };
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function getStatus(error: SyncErrorLike): number | null {
  return typeof error.status === 'number' && Number.isFinite(error.status) ? error.status : null;
}

/** Network / timeout failures (the request never got an HTTP response). */
export function isConnectivityError(error: unknown): boolean {
  const candidate = asErrorLike(error);
  const name = getString(candidate.name);
  if (NETWORK_ERROR_NAMES.has(name)) {
    return true;
  }

  const status = getStatus(candidate);
  if (status !== null) {
    return status === 0;
  }

  const code = getString(candidate.code);
  if (code && !/^E[A-Z]+$/.test(code)) {
    // A database/PostgREST code means the server answered.
    return false;
  }

  return name === 'TypeError' || NETWORK_MESSAGE_PATTERN.test(getString(candidate.message));
}

/** Requests that were refused because no user session was available (never sent, or sent as anon). */
export function isSessionUnavailableError(error: unknown): boolean {
  const candidate = asErrorLike(error);
  return (
    candidate.name === 'TransientAuthError' ||
    candidate.code === 'session_missing' ||
    candidate.sentWithoutUserJwt === true
  );
}

/**
 * Classifies a failed queue operation (§4.2):
 * - success: 23505 on user_set_selections (the row already exists server-side).
 * - transient (keep, back off, park after the attempt cap): network/timeout, HTTP 5xx/408/429,
 *   `rate_limited`, PGRST301/PGRST303/HTTP 401, any request without a user JWT, and Postgres
 *   serialization/lock/cancel states.
 * - permanent (record, drop, roll back): 42501 with a valid JWT, 23502, 23503, 23514, 22P02,
 *   PGRST204, other P0001 codes, other integrity/data errors and any other 4xx that carries a
 *   PostgREST/Postgres error code.
 * - A 4xx without an error code did not come from PostgREST (a proxy, WAF or captive-portal page):
 *   the server never evaluated the write, so it is transient, never dropped.
 */
export function classifySyncError(error: unknown, table: string, _operationType?: SyncOperationType): SyncErrorClass {
  const candidate = asErrorLike(error);
  const code = getString(candidate.code);
  const status = getStatus(candidate);
  const message = getString(candidate.message);

  if (isSessionUnavailableError(candidate)) {
    return 'transient';
  }

  if (code === '23505' && table === 'user_set_selections') {
    return 'success';
  }

  if (code === 'P0001') {
    return message === 'rate_limited' ? 'transient' : 'permanent';
  }

  if (TRANSIENT_POSTGREST_CODES.has(code) || status === 401) {
    return 'transient';
  }

  if (isConnectivityError(candidate)) {
    return 'transient';
  }

  if (status !== null && (status >= 500 || status === 408 || status === 429)) {
    return 'transient';
  }

  if (TRANSIENT_SQLSTATES.has(code) || code.startsWith('08')) {
    return 'transient';
  }

  if (PERMANENT_CODES.has(code) || code.startsWith('22') || code.startsWith('23') || code.startsWith('PGRST')) {
    return 'permanent';
  }

  if (status !== null && status >= 400 && status < 500) {
    return code ? 'permanent' : 'transient';
  }

  // Unknown failure without an HTTP status: keep it and let the attempt cap park it if it persists.
  return 'transient';
}

export function describeSyncError(error: unknown): { code: string | null; message: string } {
  const candidate = asErrorLike(error);
  const code = getString(candidate.code) || null;
  const message = getString(candidate.message) || (error instanceof Error ? error.message : String(error));
  return { code, message };
}
