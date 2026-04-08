import { corsHeaders } from '../_shared/cors.ts';
import { resolveAuthedAppUser } from '../_shared/helpers.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { checkBodySize, requireString, ValidationError, validationErrorResponse } from '../_shared/validate.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const sizeError = checkBodySize(request, 1024);
  if (sizeError) return sizeError;

  const auth = await resolveAuthedAppUser(request);
  if ('error' in auth) {
    return auth.error;
  }

  const { appUser, serviceClient } = auth;

  let invite_code: string;
  try {
    const body = await request.json();
    // Invite codes are 6 chars; allow up to 16 for minor whitespace/casing tolerance
    invite_code = requireString(body?.invite_code, 'invite_code', 16).toUpperCase();
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Rate limit: 10 join attempts per user per hour
  const rateLimitError = await checkRateLimit(serviceClient, appUser.email, 'join_invite', 10, 60 * 60 * 1000);
  if (rateLimitError) return rateLimitError;

  const { data: group, error: groupError } = await serviceClient
    .from('groups')
    .select('*')
    .ilike('invite_code', invite_code)
    .maybeSingle();
  if (groupError) {
    return new Response(JSON.stringify({ error: groupError.message }), { status: 500, headers: corsHeaders });
  }
  if (!group) {
    return new Response(JSON.stringify({ error: 'Invite code not found' }), { status: 404, headers: corsHeaders });
  }

  const { error: insertError } = await serviceClient.from('group_members').upsert(
    {
      group_id: group.id,
      user_id: appUser.id,
    },
    {
      onConflict: 'group_id,user_id',
      ignoreDuplicates: false,
    },
  );
  if (insertError) {
    return new Response(JSON.stringify({ error: insertError.message }), { status: 500, headers: corsHeaders });
  }

  const { count } = await serviceClient.from('group_members').select('*', { count: 'exact', head: true }).eq('group_id', group.id);

  return new Response(
    JSON.stringify({
      group_id: group.id,
      group_name: group.name,
      member_count: count ?? 0,
    }),
    {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    },
  );
});
