import { chunk, STORAGE_REMOVE_BATCH } from '../_shared/chunk.ts';
import { checkMethod, describeError, errorResponse, jsonResponse, parseBearerToken } from '../_shared/http.ts';

/** Who the caller's access token belongs to. */
export type CallerLookup =
  | { kind: 'user'; authUserId: string }
  /** The token is valid but its user no longer exists: an earlier deletion already finished. */
  | { kind: 'gone' }
  | { kind: 'unauthorized' };

/** Everything the handler needs from Supabase (service role). Each call throws on failure. */
export interface DeleteAccountDeps {
  /** `auth.getUser(jwt)`. Throws only on a transient failure (network, auth server 5xx). */
  lookupCaller(jwt: string): Promise<CallerLookup>;
  /** `rpc('prepare_account_deletion')`: leaves every group and returns the photo paths to delete. */
  prepareAccountDeletion(authUserId: string): Promise<string[]>;
  /** `storage.from('totems').remove(paths)` for one batch of at most 1000 paths. */
  removeTotems(paths: string[]): Promise<void>;
  /** `auth.admin.deleteUser(id)`; succeeds when the user is already gone. */
  deleteAuthUser(authUserId: string): Promise<void>;
  /** Log sink for failures; receives no PII (no ids, emails or paths). */
  logError(step: string, details: Record<string, unknown>): void;
}

const deleted = () => jsonResponse({ deleted: true });

/**
 * POST, no body. Deletes the caller's account and everything that belongs to it:
 * 1. identify the caller from the access token (a token whose user is gone → already deleted);
 * 2. `prepare_account_deletion` (memberships, admin hand-off, location rows; returns photo paths);
 * 3. remove the photos from the `totems` bucket in batches of ≤ 1000;
 * 4. delete the auth user, which cascades through `users.auth_user_id` to the profile and its rows.
 *
 * Every step is safe to repeat, so any failure answers a retryable 500 and the app retries the
 * whole request. Success is always 200 `{ deleted: true }`.
 */
export function createDeleteAccountHandler(deps: DeleteAccountDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const rejected = checkMethod(request, 'POST');
    if (rejected) {
      return rejected;
    }

    const jwt = parseBearerToken(request.headers.get('Authorization'));
    if (!jwt) {
      return errorResponse(401, 'not_authenticated');
    }

    let step = 'lookup_caller';
    try {
      const caller = await deps.lookupCaller(jwt);
      if (caller.kind === 'gone') {
        return deleted();
      }
      if (caller.kind === 'unauthorized') {
        return errorResponse(401, 'not_authenticated');
      }

      step = 'prepare_account_deletion';
      const paths = await deps.prepareAccountDeletion(caller.authUserId);

      step = 'remove_totems';
      for (const batch of chunk(paths, STORAGE_REMOVE_BATCH)) {
        await deps.removeTotems(batch);
      }

      step = 'delete_auth_user';
      await deps.deleteAuthUser(caller.authUserId);
      return deleted();
    } catch (error) {
      deps.logError(step, describeError(error));
      return errorResponse(500, 'server_error');
    }
  };
}
