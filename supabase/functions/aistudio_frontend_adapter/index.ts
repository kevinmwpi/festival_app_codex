import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

import { corsHeaders } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/helpers.ts';

type JsonRecord = Record<string, unknown>;
type OAuthProvider = 'google' | 'apple';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const appBaseUrl = Deno.env.get('AISTUDIO_APP_BASE_URL') ?? '';
const canonicalCallbackPath = '/auth/callback';

function createPublicClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}


function resolveCanonicalRedirectUrl(request: Request, body: JsonRecord) {
  const providedAppOrigin = String(body.app_origin ?? '').trim();
  const baseUrl = providedAppOrigin || appBaseUrl || new URL(request.url).origin;

  return new URL(canonicalCallbackPath, baseUrl).toString();
}

function jsonResponse(payload: JsonRecord, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function toDayLabel(iso: string, timezone: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: timezone,
  }).format(new Date(iso));
}

function toTimeLabel(startIso: string, endIso: string, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  });
  return `${formatter.format(new Date(startIso))} - ${formatter.format(new Date(endIso))}`;
}

function toMinutesSinceMidnight(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

function sanitizeInviteCode(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

async function resolveFestival(serviceClient: ReturnType<typeof createServiceClient>, festivalId?: string | null) {
  if (festivalId) {
    const requestedFestival = await serviceClient.from('festivals').select('*').eq('id', festivalId).maybeSingle();
    if (requestedFestival.error) {
      return { error: requestedFestival.error.message };
    }
    if (!requestedFestival.data) {
      return { error: `Festival not found: ${festivalId}` };
    }
    return { data: requestedFestival.data };
  }

  const defaultFestival = await serviceClient.from('festivals').select('*').order('start_date', { ascending: true }).limit(1).maybeSingle();
  if (defaultFestival.error) {
    return { error: defaultFestival.error.message };
  }

  if (!defaultFestival.data) {
    return { error: 'No festivals found. Seed festival data before calling this endpoint.' };
  }

  return { data: defaultFestival.data };
}

async function resolveAuthedUser(request: Request, serviceClient: ReturnType<typeof createServiceClient>) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: jsonResponse({ error: 'Missing bearer token' }, 401) };
  }

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user: authUser },
    error: authError,
  } = await serviceClient.auth.getUser(token);

  if (authError || !authUser?.email) {
    return { error: jsonResponse({ error: 'Unauthorized' }, 401) };
  }

  const upsertedProfile = await serviceClient
    .from('users')
    .upsert(
      {
        email: authUser.email.toLowerCase(),
        display_name: authUser.user_metadata?.full_name ?? authUser.email.split('@')[0] ?? 'Festival Friend',
        avatar_type: 'initials',
        avatar_value: String(authUser.email).slice(0, 2).toUpperCase(),
      },
      { onConflict: 'email' },
    )
    .select('*')
    .single();

  if (upsertedProfile.error) {
    return { error: jsonResponse({ error: upsertedProfile.error.message }, 500) };
  }

  return { authUser, appUser: upsertedProfile.data };
}

async function buildFestivalFeed(serviceClient: ReturnType<typeof createServiceClient>, festivalId?: string | null) {
  const festivalResult = await resolveFestival(serviceClient, festivalId);
  if ('error' in festivalResult) {
    return festivalResult;
  }

  const festival = festivalResult.data;
  const [stagesResult, setsResult] = await Promise.all([
    serviceClient.from('stages').select('*').eq('festival_id', festival.id).order('name', { ascending: true }),
    serviceClient
      .from('sets')
      .select('id, artist_id, stage_id, start_time, end_time, artists (id, name, genre, image_url), stages (name)')
      .eq('festival_id', festival.id)
      .order('start_time', { ascending: true }),
  ]);

  if (stagesResult.error) {
    return { error: stagesResult.error.message };
  }
  if (setsResult.error) {
    return { error: setsResult.error.message };
  }

  const timezone = festival.timezone ?? 'UTC';
  const artists = (setsResult.data ?? []).map((setRow) => {
    const artist = Array.isArray(setRow.artists) ? setRow.artists[0] : setRow.artists;
    const stage = Array.isArray(setRow.stages) ? setRow.stages[0] : setRow.stages;

    return {
      setId: setRow.id,
      artistId: setRow.artist_id,
      name: artist?.name ?? 'Unknown Artist',
      genre: artist?.genre ?? null,
      imageUrl: artist?.image_url ?? null,
      stageId: setRow.stage_id,
      stage: stage?.name ?? 'Unknown Stage',
      startIso: setRow.start_time,
      endIso: setRow.end_time,
      day: toDayLabel(setRow.start_time, timezone),
      time: toTimeLabel(setRow.start_time, setRow.end_time, timezone),
      startTime: toMinutesSinceMidnight(setRow.start_time, timezone),
      endTime: toMinutesSinceMidnight(setRow.end_time, timezone),
    };
  });

  return {
    data: {
      festival: {
        id: festival.id,
        name: festival.name,
        startDate: festival.start_date,
        endDate: festival.end_date,
        timezone,
        venueName: festival.venue_name,
      },
      days: [...new Set(artists.map((artist) => artist.day))],
      stages: (stagesResult.data ?? []).map((stage) => ({
        id: stage.id,
        name: stage.name,
        zone: stage.zone,
      })),
      artists,
    },
  };
}

async function handleMagicLink(request: Request, body: JsonRecord) {
  const email = String(body.email ?? '').trim().toLowerCase();
  const redirectTo = resolveCanonicalRedirectUrl(request, body);

  if (!email) {
    return jsonResponse({ error: 'email is required' }, 400);
  }

  const publicClient = createPublicClient();
  const { error } = await publicClient.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: redirectTo,
    },
  });

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({ sent: true, method: 'magic_link', email });
}

async function handleOAuthStart(request: Request, body: JsonRecord) {
  const provider = String(body.provider ?? '').trim().toLowerCase() as OAuthProvider;
  const redirectTo = resolveCanonicalRedirectUrl(request, body);

  if (!['google', 'apple'].includes(provider)) {
    return jsonResponse({ error: 'provider must be google or apple' }, 400);
  }

  const publicClient = createPublicClient();
  const { data, error } = await publicClient.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({ provider, auth_url: data.url });
}

async function handleGroupsGet(request: Request, serviceClient: ReturnType<typeof createServiceClient>) {
  const auth = await resolveAuthedUser(request, serviceClient);
  if ('error' in auth) {
    return auth.error;
  }

  const groupsResult = await serviceClient
    .from('group_members')
    .select('group_id, role, groups(*)')
    .eq('user_id', auth.appUser.id)
    .order('joined_at', { ascending: false });

  if (groupsResult.error) {
    return jsonResponse({ error: groupsResult.error.message }, 500);
  }

  return jsonResponse({ groups: groupsResult.data ?? [] });
}

async function handleGroupsPost(request: Request, serviceClient: ReturnType<typeof createServiceClient>) {
  const auth = await resolveAuthedUser(request, serviceClient);
  if ('error' in auth) {
    return auth.error;
  }

  const body = (await request.json().catch(() => ({}))) as JsonRecord;
  const groupName = String(body.group_name ?? '').trim();
  const festivalResult = await resolveFestival(serviceClient, String(body.festival_id ?? '') || null);

  if (!groupName) {
    return jsonResponse({ error: 'group_name is required' }, 400);
  }
  if ('error' in festivalResult) {
    return jsonResponse({ error: festivalResult.error }, 400);
  }

  const inviteCode = sanitizeInviteCode(String(body.invite_code ?? '')) || sanitizeInviteCode(crypto.randomUUID().slice(0, 8));
  const groupInsert = await serviceClient
    .from('groups')
    .insert({
      festival_id: festivalResult.data.id,
      name: groupName,
      invite_code: inviteCode,
      created_by_user_id: auth.appUser.id,
    })
    .select('*')
    .single();

  if (groupInsert.error) {
    return jsonResponse({ error: groupInsert.error.message }, 500);
  }

  const membershipResult = await serviceClient.from('group_members').insert({
    group_id: groupInsert.data.id,
    user_id: auth.appUser.id,
    role: 'owner',
  });

  if (membershipResult.error) {
    return jsonResponse({ error: membershipResult.error.message }, 500);
  }

  return jsonResponse({ group: groupInsert.data }, 201);
}

async function handleMembershipsPost(request: Request, serviceClient: ReturnType<typeof createServiceClient>) {
  const auth = await resolveAuthedUser(request, serviceClient);
  if ('error' in auth) {
    return auth.error;
  }

  const body = (await request.json().catch(() => ({}))) as JsonRecord;
  const inviteCode = sanitizeInviteCode(String(body.invite_code ?? ''));
  if (!inviteCode) {
    return jsonResponse({ error: 'invite_code is required' }, 400);
  }

  const groupResult = await serviceClient.from('groups').select('*').ilike('invite_code', inviteCode).maybeSingle();
  if (groupResult.error) {
    return jsonResponse({ error: groupResult.error.message }, 500);
  }
  if (!groupResult.data) {
    return jsonResponse({ error: 'Invite code not found' }, 404);
  }

  const membershipResult = await serviceClient.from('group_members').upsert(
    {
      group_id: groupResult.data.id,
      user_id: auth.appUser.id,
      role: 'member',
    },
    {
      onConflict: 'group_id,user_id',
      ignoreDuplicates: false,
    },
  );

  if (membershipResult.error) {
    return jsonResponse({ error: membershipResult.error.message }, 500);
  }

  return jsonResponse({ group: groupResult.data });
}

async function handleScheduleSelectionsGet(request: Request, serviceClient: ReturnType<typeof createServiceClient>) {
  const auth = await resolveAuthedUser(request, serviceClient);
  if ('error' in auth) {
    return auth.error;
  }

  const url = new URL(request.url);
  const festivalId = url.searchParams.get('festival_id');

  let query = serviceClient
    .from('user_set_selections')
    .select('id, festival_id, set_id, selected_at, note')
    .eq('user_id', auth.appUser.id)
    .order('selected_at', { ascending: false });

  if (festivalId) {
    query = query.eq('festival_id', festivalId);
  }

  const selectionsResult = await query;
  if (selectionsResult.error) {
    return jsonResponse({ error: selectionsResult.error.message }, 500);
  }

  return jsonResponse({ selections: selectionsResult.data ?? [] });
}

async function handleScheduleSelectionsPost(request: Request, serviceClient: ReturnType<typeof createServiceClient>) {
  const auth = await resolveAuthedUser(request, serviceClient);
  if ('error' in auth) {
    return auth.error;
  }

  const body = (await request.json().catch(() => ({}))) as JsonRecord;
  const setId = String(body.set_id ?? '').trim();
  const note = String(body.note ?? '').trim() || null;

  if (!setId) {
    return jsonResponse({ error: 'set_id is required' }, 400);
  }

  const setResult = await serviceClient.from('sets').select('id, festival_id').eq('id', setId).maybeSingle();
  if (setResult.error) {
    return jsonResponse({ error: setResult.error.message }, 500);
  }
  if (!setResult.data) {
    return jsonResponse({ error: 'Set not found' }, 404);
  }

  const upsertResult = await serviceClient
    .from('user_set_selections')
    .upsert(
      {
        user_id: auth.appUser.id,
        festival_id: setResult.data.festival_id,
        set_id: setResult.data.id,
        note,
      },
      { onConflict: 'user_id,set_id' },
    )
    .select('id, festival_id, set_id, selected_at, note')
    .single();

  if (upsertResult.error) {
    return jsonResponse({ error: upsertResult.error.message }, 500);
  }

  return jsonResponse({ selection: upsertResult.data }, 201);
}

async function handleScheduleSelectionsDelete(request: Request, serviceClient: ReturnType<typeof createServiceClient>) {
  const auth = await resolveAuthedUser(request, serviceClient);
  if ('error' in auth) {
    return auth.error;
  }

  const url = new URL(request.url);
  const setId = String(url.searchParams.get('set_id') ?? '').trim();
  if (!setId) {
    return jsonResponse({ error: 'set_id query parameter is required' }, 400);
  }

  const deleteResult = await serviceClient
    .from('user_set_selections')
    .delete()
    .eq('user_id', auth.appUser.id)
    .eq('set_id', setId);

  if (deleteResult.error) {
    return jsonResponse({ error: deleteResult.error.message }, 500);
  }

  return jsonResponse({ removed: true, set_id: setId });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: 'SUPABASE_URL and SUPABASE_ANON_KEY are required' }, 500);
  }

  const serviceClient = createServiceClient();
  const url = new URL(request.url);
  const route = url.pathname.replace(/.*\/aistudio_frontend_adapter/, '') || '/';

  if (request.method === 'POST' && route === '/auth/magic-link') {
    const body = (await request.json().catch(() => ({}))) as JsonRecord;
    return handleMagicLink(request, body);
  }

  if (request.method === 'POST' && route === '/auth/oauth/start') {
    const body = (await request.json().catch(() => ({}))) as JsonRecord;
    return handleOAuthStart(request, body);
  }

  if (request.method === 'GET' && route === '/festival-feed') {
    const payload = await buildFestivalFeed(serviceClient, url.searchParams.get('festival_id'));
    if ('error' in payload) {
      return jsonResponse({ error: payload.error }, 500);
    }

    return jsonResponse(payload.data);
  }

  if (request.method === 'GET' && route === '/groups') {
    return handleGroupsGet(request, serviceClient);
  }

  if (request.method === 'POST' && route === '/groups') {
    return handleGroupsPost(request, serviceClient);
  }

  if (request.method === 'POST' && route === '/group-memberships') {
    return handleMembershipsPost(request, serviceClient);
  }

  if (request.method === 'GET' && route === '/schedule-selections') {
    return handleScheduleSelectionsGet(request, serviceClient);
  }

  if (request.method === 'POST' && route === '/schedule-selections') {
    return handleScheduleSelectionsPost(request, serviceClient);
  }

  if (request.method === 'DELETE' && route === '/schedule-selections') {
    return handleScheduleSelectionsDelete(request, serviceClient);
  }

  return jsonResponse(
    {
      error: 'Route not found',
      available_routes: [
        'POST /auth/magic-link',
        'POST /auth/oauth/start',
        'GET /festival-feed',
        'GET /groups',
        'POST /groups',
        'POST /group-memberships',
        'GET /schedule-selections',
        'POST /schedule-selections',
        'DELETE /schedule-selections?set_id=<uuid>',
      ],
    },
    404,
  );
});
