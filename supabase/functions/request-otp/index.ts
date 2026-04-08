import { corsHeaders } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/helpers.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { checkBodySize, requireEmail, ValidationError, validationErrorResponse } from '../_shared/validate.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Body size guard — an email + options payload should never exceed 1 KB
  const sizeError = checkBodySize(request, 1024);
  if (sizeError) return sizeError;

  let email: string;
  try {
    const body = await request.json();
    email = requireEmail(body?.email, 'email');
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const serviceClient = createServiceClient();

  // Rate limit: 10 OTP send attempts per email per 10 minutes
  const rateLimitError = await checkRateLimit(serviceClient, email, 'request_otp', 10, 10 * 60 * 1000);
  if (rateLimitError) return rateLimitError;

  // Trigger Supabase Auth to send the OTP email.
  // We call the Supabase Auth REST API directly using the anon key so that
  // the OTP is issued for a user-scoped session (not an admin-scoped one).
  const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ email, create_user: true }),
  });

  if (!authResponse.ok) {
    const authBody = await authResponse.json().catch(() => ({}));
    const message = (authBody as { msg?: string; error_description?: string }).msg
      ?? (authBody as { msg?: string; error_description?: string }).error_description
      ?? 'Failed to send login code.';
    return new Response(JSON.stringify({ error: message }), {
      status: authResponse.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ message: 'Login code sent.' }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
