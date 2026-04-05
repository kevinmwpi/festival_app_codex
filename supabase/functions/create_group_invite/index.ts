import { corsHeaders } from '../_shared/cors.ts';
import { resolveAuthedAppUser } from '../_shared/helpers.ts';
import { checkBodySize, requireUUID, ValidationError, validationErrorResponse } from '../_shared/validate.ts';

function randomInviteCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((value) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[value % 32])
    .join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const sizeError = checkBodySize(request, 512);
  if (sizeError) return sizeError;

  const auth = await resolveAuthedAppUser(request);
  if ('error' in auth) {
    return auth.error;
  }

  const { appUser, serviceClient } = auth;

  let group_id: string;
  try {
    const body = await request.json();
    group_id = requireUUID(body?.group_id, 'group_id');
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: group, error: groupError } = await serviceClient.from('groups').select('*').eq('id', group_id).single();
  if (groupError || !group) {
    return new Response(JSON.stringify({ error: 'Group not found' }), { status: 404, headers: corsHeaders });
  }

  const { data: membership } = await serviceClient
    .from('group_members')
    .select('*')
    .eq('group_id', group_id)
    .eq('user_id', appUser.id)
    .maybeSingle();

  const isOwner = group.created_by_user_id === appUser.id;
  const isAdmin = membership?.role === 'admin';
  if (!isOwner && !isAdmin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders });
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await serviceClient
    .from('group_invite_generations')
    .select('*', { count: 'exact', head: true })
    .eq('group_id', group_id)
    .gte('generated_at', oneHourAgo);

  if ((count ?? 0) >= 10) {
    return new Response(JSON.stringify({ error: 'Invite generation rate limit exceeded' }), { status: 429, headers: corsHeaders });
  }

  let inviteCode = randomInviteCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: existing } = await serviceClient.from('groups').select('id').ilike('invite_code', inviteCode).maybeSingle();
    if (!existing) {
      break;
    }
    inviteCode = randomInviteCode();
  }

  const { error: updateError } = await serviceClient.from('groups').update({ invite_code: inviteCode }).eq('id', group_id);
  if (updateError) {
    return new Response(JSON.stringify({ error: updateError.message }), { status: 500, headers: corsHeaders });
  }

  await serviceClient.from('group_invite_generations').insert({
    group_id,
    requested_by_user_id: appUser.id,
  });

  return new Response(
    JSON.stringify({
      invite_code: inviteCode,
      deep_link: `festivalapp://groups/join?code=${inviteCode}`,
    }),
    {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    },
  );
});
