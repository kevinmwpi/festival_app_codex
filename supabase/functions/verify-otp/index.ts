import { corsHeaders } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/helpers.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { checkBodySize, requireEmail, requireString, ValidationError, validationErrorResponse } from '../_shared/validate.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Body size guard — email + 8-digit token should never exceed 1 KB
  const sizeError = checkBodySize(request, 1024);
  if (sizeError) return sizeError;

  let email: string;
  let token: string;
  try {
    const body = await request.json();
    email = requireEmail(body?.email, 'email');
    token = requireString(body?.token, 'token', 16);
    // OTP tokens are numeric strings; reject anything that clearly isn't
    if (!/^\d+$/.test(token)) {
      throw new ValidationError("'token' must contain only digits.");
    }
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const serviceClient = createServiceClient();

  // Rate limit: 10 OTP verification attempts per email per 10 minutes
  const rateLimitError = await checkRateLimit(serviceClient, email, 'verify_otp', 10, 10 * 60 * 1000);
  if (rateLimitError) return rateLimitError;

  // Verify the OTP using the admin API — this avoids the client needing a
  // user-scoped session before verification and lets us control the flow.
  // The OTP is issued via the /otp endpoint which generates a magiclink-type
  // token, so we must verify with type 'magiclink' to match.
  let data: { session: { access_token: string; refresh_token: string; expires_in: number; token_type: string } | null; user: unknown };
  try {
    const result = await serviceClient.auth.admin.verifyOtp({
      email,
      token,
      type: 'magiclink',
    });
    if (result.error || !result.data.session) {
      return new Response(
        JSON.stringify({ error: result.error?.message ?? 'Invalid or expired login code.' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }
    data = result.data;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed.';
    console.error('[verify-otp] admin.verifyOtp threw:', message);
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  const { access_token, refresh_token, expires_in, token_type } = data.session!;

  return new Response(
    JSON.stringify({ access_token, refresh_token, expires_in, token_type }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
});
