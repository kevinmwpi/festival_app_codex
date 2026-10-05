// demo-login (verify_jwt = false) — the App Review sign-in path. See handler.ts.
import type { SupabaseClient } from '@supabase/supabase-js';

import { errorResponse } from '../_shared/http.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { createDemoLoginHandler, type DemoLoginDeps, readDemoLoginConfig } from './handler.ts';

/** GoTrue answers 422 `email_exists` when createUser targets an existing address. */
const USER_EXISTS_CODES = new Set(['email_exists', 'user_already_exists']);

function supabaseDeps(client: SupabaseClient): DemoLoginDeps {
  return {
    async checkRateLimit(key, action, max, window) {
      const { data, error } = await client.rpc('check_rate_limit', {
        p_key: key,
        p_action: action,
        p_max: max,
        p_window: window,
      });
      if (error) {
        throw error;
      }
      return data === true;
    },

    async ensureAuthUser(email) {
      // No app_metadata: `festie_demo` marks the seeded fake crew members, never the reviewer.
      const { error } = await client.auth.admin.createUser({ email, email_confirm: true });
      if (error && !USER_EXISTS_CODES.has(error.code ?? '')) {
        throw error;
      }
    },

    async generateMagicLink(email) {
      const { data, error } = await client.auth.admin.generateLink({ type: 'magiclink', email });
      if (error) {
        throw error;
      }
      const tokenHash = data.properties?.hashed_token;
      const userId = data.user?.id;
      if (!tokenHash || !userId) {
        throw new Error('generateLink returned no token');
      }
      return {
        authUserId: userId,
        tokenHash,
        verificationType: data.properties.verification_type,
      };
    },

    async prepareDemoAccount(authUserId) {
      const { error } = await client.rpc('prepare_demo_account', { p_auth_user_id: authUserId });
      if (error) {
        throw error;
      }
    },

    logError(step, details) {
      console.error(JSON.stringify({ fn: 'demo-login', step, ...details }));
    },
  };
}

const config = await readDemoLoginConfig((name) => Deno.env.get(name));

// Disabled → 404 for every request, without needing the service-role client.
Deno.serve(
  config
    ? createDemoLoginHandler(config, supabaseDeps(createServiceClient()))
    : () => errorResponse(404, 'not_found'),
);
