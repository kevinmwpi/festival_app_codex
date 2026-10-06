/**
 * Error types thrown by `@festival/data-access`. Every class carries a stable `code` so UI code can
 * branch without `instanceof` across bundles; `toUserMessage(error)` turns any of them (and raw
 * Supabase/Postgres errors) into friendly copy.
 */

export class AppError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

/** Supabase URL / anon key missing from the build. No client exists; every network call throws this. */
export class ConfigError extends AppError {
  constructor(message: string) {
    super('config_error', message);
    this.name = 'ConfigError';
  }
}

/**
 * An authenticated call was attempted without a stored session. Nothing was sent (prevents
 * anon-key requests being misread as permission errors). Treat as "signed out / retry later".
 */
export class TransientAuthError extends AppError {
  constructor(message = 'No signed-in session is available.') {
    super('session_missing', message);
    this.name = 'TransientAuthError';
  }
}

/** The signed-in user has no cached profile yet (profile setup not finished). */
export class ProfileRequiredError extends AppError {
  constructor(message = 'Finish setting up your profile first.') {
    super('profile_required', message);
    this.name = 'ProfileRequiredError';
  }
}

/** `join_group` returned zero rows: no group has that invite code. */
export class InviteNotFoundError extends AppError {
  constructor(message = 'No crew matches that invite code.') {
    super('invite_not_found', message);
    this.name = 'InviteNotFoundError';
  }
}

/** A totem photo was added before the meetup reached the server. */
export class MeetupNotSyncedError extends AppError {
  constructor(message = 'Add the photo once this meetup syncs.') {
    super('meetup_not_synced', message);
    this.name = 'MeetupNotSyncedError';
  }
}

/** Client-side validation failed before anything was sent. `field` names the offending input. */
export class ValidationError extends AppError {
  readonly field: string | null;

  constructor(message: string, field: string | null = null) {
    super('invalid_input', message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

/** The local cache has no such record (e.g. editing a meetup that was removed). */
export class NotFoundError extends AppError {
  constructor(message: string) {
    super('not_found', message);
    this.name = 'NotFoundError';
  }
}

/** Supabase / PostgREST / Postgres error normalised to one shape (`code`, HTTP `status`). */
export class DataAccessError extends Error {
  readonly code: string | null;
  readonly status: number | null;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(
    message: string,
    options: { code?: string | null; status?: number | null; details?: string | null; hint?: string | null } = {},
  ) {
    super(message);
    this.name = 'DataAccessError';
    this.code = options.code ?? null;
    this.status = options.status ?? null;
    this.details = options.details ?? null;
    this.hint = options.hint ?? null;
  }
}

/**
 * A reply that cannot have come from PostgREST, such as an empty 2xx/204 or an empty 404, which
 * supabase-js reports as success with `data` and `count` null. Something between the app and Supabase
 * (a proxy, WAF or captive network) answered, so it is reported like a connectivity failure (status 0,
 * retryable) and never read as "no rows".
 */
export function unexpectedResponseError(status?: number | null): DataAccessError {
  return new DataAccessError('Unexpected response from the server.', {
    status: 0,
    details: typeof status === 'number' && status > 0 ? `HTTP ${status}` : null,
  });
}

/** App-level database error codes raised as `P0001` (§ Global conventions). */
export type AppErrorCode =
  | 'not_authenticated'
  | 'profile_required'
  | 'not_group_member'
  | 'not_group_admin'
  | 'group_full'
  | 'rate_limited'
  | 'content_not_allowed'
  | 'invalid_input'
  | 'festival_not_found'
  | 'meetup_not_found'
  | 'meetup_limit_reached'
  | 'cannot_remove_self';

interface PostgrestLikeError {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
}

/** Wraps a `{ error, status }` result from supabase-js into a `DataAccessError`. */
export function toDataAccessError(error: PostgrestLikeError | Error, status?: number | null): DataAccessError {
  if (error instanceof DataAccessError) {
    return error;
  }

  const candidate = error as PostgrestLikeError;
  const message = typeof candidate.message === 'string' && candidate.message ? candidate.message : 'Request failed.';
  return new DataAccessError(message, {
    code: typeof candidate.code === 'string' && candidate.code ? candidate.code : null,
    status: typeof status === 'number' ? status : null,
    details: typeof candidate.details === 'string' ? candidate.details : null,
    hint: typeof candidate.hint === 'string' ? candidate.hint : null,
  });
}

/** The P0001 app code of an error (`'not_group_member'`, …) or null. */
export function getAppErrorCode(error: unknown): AppErrorCode | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code !== 'P0001' || typeof candidate.message !== 'string') {
    return null;
  }

  return candidate.message as AppErrorCode;
}

export function isAppErrorCode(error: unknown, code: AppErrorCode): boolean {
  return getAppErrorCode(error) === code;
}

/** Stable code of any error thrown by this package (`AppError.code`, P0001 message, or SQLSTATE). */
export function getErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const appCode = getAppErrorCode(error);
  if (appCode) {
    return appCode;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code ? code : null;
}
