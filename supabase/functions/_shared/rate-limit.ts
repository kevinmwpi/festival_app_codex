import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

import { corsHeaders } from './cors.ts';

/**
 * Check whether a given (email, action) pair is within the allowed rate limit window.
 *
 * Inserts a new attempt record unconditionally so that each call to checkRateLimit
 * counts against the budget. Returns a 429 Response if the limit is exceeded, or
 * null if the request is allowed.
 *
 * @param serviceClient  Supabase client initialised with the service-role key
 * @param email          The user email being rate-limited
 * @param action         A string identifying the action (e.g. 'request_otp')
 * @param maxAttempts    Maximum number of attempts allowed within the window
 * @param windowMs       Window duration in milliseconds
 */
export async function checkRateLimit(
  serviceClient: SupabaseClient,
  email: string,
  action: string,
  maxAttempts: number,
  windowMs: number,
): Promise<Response | null> {
  const windowStart = new Date(Date.now() - windowMs).toISOString();

  const { count, error: countError } = await serviceClient
    .from('auth_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('email', email.toLowerCase())
    .eq('action', action)
    .gte('attempted_at', windowStart);

  if (countError) {
    // If we can't query the rate limit table, fail open but log the error.
    console.error('[rate-limit] failed to query auth_attempts:', countError.message);
    return null;
  }

  if ((count ?? 0) >= maxAttempts) {
    const retryAfterSecs = Math.ceil(windowMs / 1000);
    return new Response(
      JSON.stringify({
        error: 'Too many requests. Please wait before trying again.',
        retry_after_seconds: retryAfterSecs,
      }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfterSecs),
        },
      },
    );
  }

  // Record this attempt
  await serviceClient.from('auth_attempts').insert({
    email: email.toLowerCase(),
    action,
  });

  return null;
}
