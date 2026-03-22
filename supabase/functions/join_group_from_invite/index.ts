import { corsHeaders } from '../_shared/cors.ts';
import { resolveAuthedAppUser } from '../_shared/helpers.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const auth = await resolveAuthedAppUser(request);
  if ('error' in auth) {
    return auth.error;
  }

  const { appUser, serviceClient } = auth;
  const { invite_code } = await request.json();
  const normalizedCode = String(invite_code ?? '').trim().toUpperCase();

  const { data: group, error: groupError } = await serviceClient
    .from('groups')
    .select('*')
    .ilike('invite_code', normalizedCode)
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
