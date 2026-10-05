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

function isStorageUpload(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET')).toUpperCase();
  const url = requestUrl(input);
  return (method === 'POST' || method === 'PUT') && /\/storage\/v1\/object\/(?!sign\/|list\/)/.test(url);
}

/**
 * A `fetch` that aborts after `timeoutMs` (default 15 s) and rejects with `FetchTimeoutError`.
 * Storage object uploads use `uploadTimeoutMs` instead. A caller-supplied `signal` still aborts.
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

    return baseFetch(input, { ...init, signal: controller.signal })
      .catch((error: unknown) => {
        throw timedOut ? new FetchTimeoutError(effectiveTimeout) : error;
      })
      .finally(() => {
        clearTimeout(timer);
        upstream?.removeEventListener('abort', onUpstreamAbort);
      });
  };
}
