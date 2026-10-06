import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type EnvReader = (name: string) => string | undefined;

/**
 * Picks the server-side key from the variables the edge runtime injects.
 *
 * Prefers the new secret key (`SUPABASE_SECRET_KEYS`, a JSON map; the `default` entry) and falls back
 * to the legacy service_role JWT (`SUPABASE_SERVICE_ROLE_KEY`). Once the legacy keys are disabled in
 * the dashboard the legacy JWT is rejected by the API gateway, so the secret key must win whenever it
 * is present. A malformed `SUPABASE_SECRET_KEYS` falls back to the legacy key rather than throwing.
 */
export function resolveServiceKey(env: EnvReader): string | null {
  const secretKeys = env('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    try {
      const parsed: unknown = JSON.parse(secretKeys);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const key = (parsed as Record<string, unknown>)['default'];
        if (typeof key === 'string' && key.length > 0) {
          return key;
        }
      }
    } catch {
      // Not JSON: ignore and use the legacy key below.
    }
  }
  const legacy = env('SUPABASE_SERVICE_ROLE_KEY');
  return legacy && legacy.length > 0 ? legacy : null;
}

/**
 * Service-role client from the variables the edge runtime injects (`SUPABASE_URL`, plus
 * `SUPABASE_SECRET_KEYS` or the legacy `SUPABASE_SERVICE_ROLE_KEY`; see resolveServiceKey).
 * Bypasses RLS: use it only after the caller has been checked.
 */
export function createServiceClient(env: EnvReader = (name) => Deno.env.get(name)): SupabaseClient {
  const url = env('SUPABASE_URL');
  const serviceKey = resolveServiceKey(env);
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEYS (or SUPABASE_SERVICE_ROLE_KEY) must be set');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
