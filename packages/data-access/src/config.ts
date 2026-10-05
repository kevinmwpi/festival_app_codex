import { ConfigError } from './errors';

export const REQUEST_TIMEOUT_MS = 15_000;
/** Storage object uploads (≤ 5 MB on festival networks) get longer than ordinary requests. */
export const UPLOAD_TIMEOUT_MS = 90_000;

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

function readEnv(name: string): string | undefined {
  // Each access must be a literal `process.env.EXPO_PUBLIC_*` member for Expo to inline it.
  switch (name) {
    case 'EXPO_PUBLIC_SUPABASE_URL':
      return process.env.EXPO_PUBLIC_SUPABASE_URL;
    case 'EXPO_PUBLIC_SUPABASE_ANON_KEY':
      return process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    case 'EXPO_PUBLIC_SUPABASE_KEY':
      return process.env.EXPO_PUBLIC_SUPABASE_KEY;
    default:
      return undefined;
  }
}

/** Validates the Supabase env config. Pure: exported for tests. */
export function resolveSupabaseConfig(env: {
  url?: string | null;
  anonKey?: string | null;
  legacyKey?: string | null;
}): { config: SupabaseConfig | null; error: string | null } {
  const url = env.url?.trim() ?? '';
  const anonKey = (env.anonKey?.trim() || env.legacyKey?.trim()) ?? '';
  const missing: string[] = [];

  if (!url) {
    missing.push('EXPO_PUBLIC_SUPABASE_URL');
  } else if (!/^https?:\/\/[^\s/]+/i.test(url)) {
    return { config: null, error: 'EXPO_PUBLIC_SUPABASE_URL is not a valid URL.' };
  }

  if (!anonKey) {
    missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  }

  if (missing.length > 0) {
    return { config: null, error: `Missing ${missing.join(' and ')}.` };
  }

  return { config: { url: url.replace(/\/+$/, ''), anonKey }, error: null };
}

const resolved = resolveSupabaseConfig({
  url: readEnv('EXPO_PUBLIC_SUPABASE_URL'),
  anonKey: readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY'),
  legacyKey: readEnv('EXPO_PUBLIC_SUPABASE_KEY'),
});

/** Non-null when the build lacks Supabase config. The app shows a config-error screen; no client exists. */
export const supabaseConfigError: string | null = resolved.error;

export function getSupabaseConfig(): SupabaseConfig {
  if (!resolved.config) {
    throw new ConfigError(supabaseConfigError ?? 'Supabase is not configured.');
  }

  return resolved.config;
}

/** Thrown (and surfaced by supabase-js as `TimeoutError: …`) when a request exceeds its timeout. */
export class FetchTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs} ms`);
    this.name = 'TimeoutError';
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return (input as Request).url ?? '';
}

/** A supabase-js token refresh: `POST {url}/auth/v1/token?grant_type=refresh_token`. */
function isRefreshTokenRequest(url: string): boolean {
  return url.includes('/auth/v1/token') && /[?&]grant_type=refresh_token(?:&|$)/.test(url);
}

function isJsonContentType(response: Response): boolean {
  // application/json, application/json;charset=UTF-8, application/problem+json, …
  return /\bjson\b/i.test(response.headers.get('content-type') ?? '');
}

/**
 * Whether a token-refresh response cannot be trusted as Supabase Auth's verdict on the refresh token:
 * a 5xx, a 429 (rate limited — the token was never evaluated), or any response (2xx included) whose
 * body is not JSON. Captive portals, hotel/festival Wi-Fi login pages, proxies and CDN error pages
 * answer like this — often with `200 text/html` or `511 Network Authentication Required`.
 */
function isNonAuthoritativeRefreshResponse(response: Response): boolean {
  return response.status >= 500 || response.status === 429 || !isJsonContentType(response);
}

/**
 * Whether an ok JSON token-refresh response carries a session the way auth-js reads one
 * (lib/fetch.js `hasSession`: `access_token`, `refresh_token` and `expires_in` all truthy). Anything
 * else — a JSON-speaking proxy or portal answering `200 {"status":"login required"}`, or a malformed
 * body — would otherwise reach `_callRefreshToken` as `AuthSessionMissingError` and sign the user out.
 * Reads a clone, so the original body is still unread for auth-js.
 */
async function okRefreshResponseHasSession(response: Response): Promise<boolean> {
  let body: unknown;
  try {
    body = JSON.parse(await response.clone().text());
  } catch {
    return false;
  }
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  const { access_token, refresh_token, expires_in } = body as Record<string, unknown>;
  return Boolean(access_token && refresh_token && expires_in);
}

function releaseBody(response: Response): void {
  // Release the unread body (a no-op where Response has no stream, e.g. React Native).
  try {
    response.body?.cancel().catch(() => undefined);
  } catch {
    // Nothing to release.
  }
}

/**
 * Thrown in place of a non-authoritative token-refresh response so that auth-js keeps the session.
 * It is a `TypeError` like the one `fetch` itself throws when the network is unreachable.
 */
export class NonAuthoritativeAuthResponseError extends TypeError {
  readonly status: number;

  constructor(status: number) {
    super(`Network request failed (non-authoritative auth response, HTTP ${status})`);
    this.name = 'TypeError';
    this.status = status;
  }
}

function isStorageUpload(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET')).toUpperCase();
  const url = requestUrl(input);
  return (method === 'POST' || method === 'PUT') && /\/storage\/v1\/object\/(?!sign\/|list\/)/.test(url);
}

/**
 * A `fetch` that aborts after `timeoutMs` (default 15 s) and rejects with `FetchTimeoutError`.
 * Storage object uploads use `uploadTimeoutMs` instead. A caller-supplied `signal` still aborts.
 *
 * Captive-portal resilience: a token-refresh response that is not Supabase Auth's verdict on the
 * refresh token (see `isNonAuthoritativeRefreshResponse`) is turned into a rejected
 * `NonAuthoritativeAuthResponseError` (a `TypeError`), exactly like an unreachable network. Verified
 * against @supabase/auth-js 2.99.3 (line numbers from dist/main; dist/module is identical):
 *
 * - lib/fetch.js `_handleRequest` (l. 100-107) maps any rejection of the fetch call to
 *   `AuthRetryableFetchError(message, 0)`.
 * - Had the response been returned instead, `!result.ok` goes to `handleError` (l. 17-67): only
 *   502/503/504 become `AuthRetryableFetchError`; a 500, 429 or 511 becomes `AuthApiError`, or
 *   `AuthUnknownError` when the body is not JSON (l. 26-31). An ok non-JSON body currently becomes
 *   retryable only by accident (`result.json()` throws, l. 114-119, and the SyntaxError is not
 *   response-like); an ok JSON body without a session becomes `AuthSessionMissingError`.
 * - GoTrueClient.js `_refreshAccessToken` (l. 1987-2020) retries only `isAuthRetryableFetchError`;
 *   `_callRefreshToken` (l. 2163-2168) and `_recoverAndRefresh` (l. 2093-2099) call `_removeSession()`
 *   — which deletes the persisted session and emits `SIGNED_OUT` — for every other `AuthError`.
 *
 * So without this, one captive-portal page during a refresh signs the user out. With it, the session
 * stays and auth-js retries on its next auto-refresh tick. An ok JSON refresh response without a
 * session in it (see `okRefreshResponseHasSession`) is treated the same way. Authoritative answers
 * (JSON 4xx such as `400 refresh_token_not_found`) still pass through and sign the user out as before.
 *
 * Trade-off for 429: auth-js retries a retryable error with its own backoff (200, 400, 800 ms …, at
 * most one 30 s auto-refresh tick, GoTrueClient.js l. 2003-2008) and ignores `Retry-After`, so a
 * rate-limited refresh is re-attempted several times per tick. That is still better than signing the
 * user out; if GoTrue's per-IP refresh limit becomes a problem in the field, add a short client-side
 * cooldown after a refresh 429.
 */
export function fetchWithTimeout(
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  options: { uploadTimeoutMs?: number; fetchImpl?: FetchLike } = {},
): FetchLike {
  const uploadTimeoutMs = options.uploadTimeoutMs ?? Math.max(timeoutMs, UPLOAD_TIMEOUT_MS);

  return (input, init = {}) => {
    const baseFetch = options.fetchImpl ?? (globalThis.fetch as FetchLike);
    const controller = new AbortController();
    const upstream = init.signal ?? undefined;
    const effectiveTimeout = isStorageUpload(input, init) ? uploadTimeoutMs : timeoutMs;
    let timedOut = false;

    const onUpstreamAbort = () => controller.abort();
    if (upstream) {
      if (upstream.aborted) {
        controller.abort();
      } else {
        upstream.addEventListener('abort', onUpstreamAbort);
      }
    }

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, effectiveTimeout);

    const refreshRequest = isRefreshTokenRequest(requestUrl(input));

    return baseFetch(input, { ...init, signal: controller.signal })
      .then(async (response) => {
        if (!refreshRequest) {
          return response;
        }
        if (isNonAuthoritativeRefreshResponse(response)) {
          releaseBody(response);
          throw new NonAuthoritativeAuthResponseError(response.status);
        }
        if (response.ok && !(await okRefreshResponseHasSession(response))) {
          releaseBody(response);
          throw new NonAuthoritativeAuthResponseError(response.status);
        }
        return response;
      })
      .catch((error: unknown) => {
        throw timedOut ? new FetchTimeoutError(effectiveTimeout) : error;
      })
      .finally(() => {
        clearTimeout(timer);
        upstream?.removeEventListener('abort', onUpstreamAbort);
      });
  };
}
