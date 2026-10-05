import {
  getErrorCode,
  OFFLINE_ERROR_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
  toUserMessage,
} from '@festival/data-access';

/**
 * Errors worth retrying in the background: network/timeouts, 5xx, rate limits and data-access's
 * `result_changed` (the data kept changing while it paged — the cached copy stays on screen).
 */
export function isTransientError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code === 'result_changed' || code === 'rate_limited') {
    return true;
  }
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && (status === 0 || status === 408 || status === 429 || status >= 500)) {
    return true;
  }
  const message = toUserMessage(error);
  return message === OFFLINE_ERROR_MESSAGE || message === TIMEOUT_ERROR_MESSAGE;
}

/** True for errors that mean "no connection" rather than a server-side problem. */
export function isOfflineError(error: unknown): boolean {
  const message = toUserMessage(error);
  return message === OFFLINE_ERROR_MESSAGE || message === TIMEOUT_ERROR_MESSAGE;
}
