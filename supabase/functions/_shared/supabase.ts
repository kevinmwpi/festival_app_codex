import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role client from the variables the edge runtime injects (`SUPABASE_URL`,
 * `SUPABASE_SERVICE_ROLE_KEY`). Bypasses RLS: use it only after the caller has been checked.
 */
export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
