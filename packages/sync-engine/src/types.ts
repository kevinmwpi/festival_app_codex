/** Tables whose writes go through the offline queue (direct table writes under RLS). */
export type MutableTable = 'user_set_selections' | 'meetups';

/**
 * `upsert` creates (or replaces) a record; `update` changes an existing record and never re-creates
 * one that was deleted on the server; `delete` removes it.
 */
export type SyncOperationType = 'upsert' | 'update' | 'delete';

export interface SyncOperation {
  table: MutableTable;
  type: SyncOperationType;
  /**
   * The full local row for an upsert or update (an `id` is generated when missing; an update needs the
   * existing `id`). For a delete: `{ id }`, plus `user_id` and `set_id` for `user_set_selections` (the
   * server delete matches on those).
   */
  payload: Record<string, unknown>;
  /** ISO timestamp; defaults to now. */
  created_at?: string;
}

export interface EnqueueResult {
  queueId: string;
  recordId: string;
}

/**
 * Sends one queued operation. Implementations throw on failure; the error should carry
 * `code` (Postgres/PostgREST/P0001 code) and `status` (HTTP status, 0 for network failures) so it can
 * be classified — see `SyncTransportError`.
 */
export interface SyncTransport {
  upsert(table: MutableTable, payload: Record<string, unknown>): Promise<void>;
  /**
   * Updates the existing row `payload.id` (send only `SERVER_UPDATABLE_COLUMNS`). Resolves
   * `{ found: false }` when no row was updated because it no longer exists (or is no longer visible):
   * the engine then drops the operation and the local row instead of re-creating it.
   */
  update(table: MutableTable, payload: Record<string, unknown>): Promise<{ found: boolean }>;
  delete(table: MutableTable, payload: Record<string, unknown>): Promise<void>;
}

/** Minimal view of the stored auth session used by the flush pre-check. */
export interface SyncSessionState {
  /** Access-token expiry, epoch milliseconds. */
  expiresAt: number;
  /** `auth.users.id` of the session's user; required for the local-owner check (`getLocalOwner`). */
  authUserId?: string;
}

/** An operation as it was enqueued (see `trackQueueActivity`). */
export interface TrackedOperation {
  table: MutableTable;
  type: SyncOperationType;
  recordId: string;
  payload: Record<string, unknown>;
}

export interface PendingOperation {
  id: string;
  table: MutableTable;
  type: SyncOperationType;
  recordId: string;
  payload: Record<string, unknown>;
  attemptCount: number;
  parked: boolean;
  lastError: string | null;
  nextRetryAt: string | null;
  createdAt: string;
}

export interface FailedOperation {
  id: string;
  table: MutableTable;
  type: SyncOperationType;
  recordId: string | null;
  payload: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
  failedAt: string;
}

export type SyncEvent =
  | { type: 'queued'; table: MutableTable; recordId: string }
  | { type: 'synced'; table: MutableTable; recordId: string }
  | { type: 'failed'; table: MutableTable; recordId: string; failure: FailedOperation }
  | { type: 'parked'; table: MutableTable; recordId: string }
  /** A queued update found no server row (deleted elsewhere, e.g. by a group admin or moderation): the local row was removed. */
  | { type: 'missing'; table: MutableTable; recordId: string }
  | { type: 'cleared' };

export type SyncEventListener = (event: SyncEvent) => void;

/** Error shape transports should throw so failures classify correctly. */
export class SyncTransportError extends Error {
  readonly code: string | null;
  readonly status: number | null;
  readonly details: string | null;
  readonly sentWithoutUserJwt: boolean;

  constructor(
    message: string,
    options: { code?: string | null; status?: number | null; details?: string | null; sentWithoutUserJwt?: boolean } = {},
  ) {
    super(message);
    this.name = 'SyncTransportError';
    this.code = options.code ?? null;
    this.status = options.status ?? null;
    this.details = options.details ?? null;
    this.sentWithoutUserJwt = options.sentWithoutUserJwt ?? false;
  }
}
