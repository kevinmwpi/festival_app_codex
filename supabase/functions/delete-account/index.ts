// delete-account (verify_jwt = true; the check below is still authoritative). See handler.ts.
import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';

import { createServiceClient } from '../_shared/supabase.ts';
import { type CallerLookup, createDeleteAccountHandler, type DeleteAccountDeps } from './handler.ts';

const TOTEMS_BUCKET = 'totems';

function isTransient(error: { status?: number }): boolean {
  return isAuthRetryableFetchError(error) || (typeof error.status === 'number' && error.status >= 500);
}

function supabaseDeps(client: SupabaseClient): DeleteAccountDeps {
  return {
    async lookupCaller(jwt): Promise<CallerLookup> {
      const { data, error } = await client.auth.getUser(jwt);
      if (!error && data.user) {
        return { kind: 'user', authUserId: data.user.id };
      }
      if (error?.code === 'user_not_found') {
        return { kind: 'gone' };
      }
      if (error && isTransient(error)) {
        throw error;
      }
      return { kind: 'unauthorized' };
    },

    async prepareAccountDeletion(authUserId) {
      const { data, error } = await client.rpc('prepare_account_deletion', { p_auth_user_id: authUserId });
      if (error) {
        throw error;
      }
      const rows = (data ?? []) as Array<{ storage_path?: unknown }>;
      return rows
        .map((row) => row.storage_path)
        .filter((path): path is string => typeof path === 'string' && path.length > 0);
    },

    async removeTotems(paths) {
      const { error } = await client.storage.from(TOTEMS_BUCKET).remove(paths);
      if (error) {
        throw error;
      }
    },

    async deleteAuthUser(authUserId) {
      const { error } = await client.auth.admin.deleteUser(authUserId);
      if (error && error.code !== 'user_not_found' && error.status !== 404) {
        throw error;
      }
    },

    logError(step, details) {
      console.error(JSON.stringify({ fn: 'delete-account', step, ...details }));
    },
  };
}

Deno.serve(createDeleteAccountHandler(supabaseDeps(createServiceClient())));
