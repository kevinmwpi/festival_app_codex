import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

import { corsHeaders } from './cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export function createServiceClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
    },
  });
}

export async function resolveAuthedAppUser(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return { error: new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401, headers: corsHeaders }) };
  }

  const serviceClient = createServiceClient();
  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error: userError,
  } = await serviceClient.auth.getUser(token);

  if (userError || !user?.email) {
    return { error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders }) };
  }

  const { data: appUser, error: appUserError } = await serviceClient.from('users').select('*').eq('email', user.email).single();
  if (appUserError || !appUser) {
    return { error: new Response(JSON.stringify({ error: 'Profile not found' }), { status: 403, headers: corsHeaders }) };
  }

  return {
    authUser: user,
    appUser,
    serviceClient,
  };
}
