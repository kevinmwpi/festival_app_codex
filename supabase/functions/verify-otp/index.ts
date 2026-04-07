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

  // Rate limit: 5 OTP verification attempts per email per 15 minutes
  const rateLimitError = await checkRateLimit(serviceClient, email, 'verify_otp', 5, 15 * 60 * 1000);
  if (rateLimitError) return rateLimitError;

  // Verify the OTP using the admin API — this avoids the client needing a
  // user-scoped session before verification and lets us control the flow.
  const { data, error } = await serviceClient.auth.admin.verifyOtp({
    email,
    token,
    type: 'email',
  });

  if (error || !data.session) {
    return new Response(
      JSON.stringify({ error: error?.message ?? 'Invalid or expired login code.' }),
      {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  const { access_token, refresh_token, expires_in, token_type } = data.session;

  return new Response(
    JSON.stringify({ access_token, refresh_token, expires_in, token_type }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
});
