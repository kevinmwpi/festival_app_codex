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
  const { meetup_id, totem_image_url } = await request.json();
  const expectedPathPrefix = `/storage/v1/object/public/totems/${meetup_id}/`;
  let hasExpectedPath = false;
  if (typeof totem_image_url === 'string') {
    try {
      const parsedUrl = new URL(totem_image_url);
      hasExpectedPath = parsedUrl.pathname.startsWith(expectedPathPrefix);
    } catch {
      hasExpectedPath = false;
    }
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
