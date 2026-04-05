import { corsHeaders } from '../_shared/cors.ts';
import { resolveAuthedAppUser } from '../_shared/helpers.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { checkBodySize, requireUUID, requireUrl, ValidationError, validationErrorResponse } from '../_shared/validate.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const sizeError = checkBodySize(request, 2048);
  if (sizeError) return sizeError;

  const auth = await resolveAuthedAppUser(request);
  if ('error' in auth) {
    return auth.error;
  }

  const { appUser, serviceClient } = auth;

  let meetup_id: string;
  let totem_image_url: string;
  try {
    const body = await request.json();
    meetup_id = requireUUID(body?.meetup_id, 'meetup_id');
    totem_image_url = requireUrl(body?.totem_image_url, 'totem_image_url', 1024);
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Rate limit: 20 totem uploads per user per hour
  const rateLimitError = await checkRateLimit(serviceClient, appUser.email, 'upload_totem', 20, 60 * 60 * 1000);
  if (rateLimitError) return rateLimitError;

  // Verify the URL path matches the expected meetup storage prefix
  const expectedPathPrefix = `/storage/v1/object/public/totems/${meetup_id}/`;
  let hasExpectedPath = false;
  try {
    const parsedUrl = new URL(totem_image_url);
    hasExpectedPath = parsedUrl.pathname.startsWith(expectedPathPrefix);
  } catch {
    hasExpectedPath = false;
  }

  if (!hasExpectedPath) {
    return new Response(JSON.stringify({ error: 'Totem image URL must match meetup upload path' }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { data: meetup, error: meetupError } = await serviceClient.from('meetups').select('*').eq('id', meetup_id).single();
  if (meetupError || !meetup) {
    return new Response(JSON.stringify({ error: 'Meetup not found' }), { status: 404, headers: corsHeaders });
  }

  const { data: membership } = await serviceClient
    .from('group_members')
    .select('*')
    .eq('group_id', meetup.group_id)
    .eq('user_id', appUser.id)
    .maybeSingle();
  if (!membership) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders });
  }

  const { error: updateError } = await serviceClient
    .from('meetups')
    .update({ totem_image_url })
    .eq('id', meetup_id);
  if (updateError) {
    return new Response(JSON.stringify({ error: updateError.message }), { status: 500, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ meetup_id, totem_image_url }), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
});
