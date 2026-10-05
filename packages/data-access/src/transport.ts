import {
  SyncTransportError,
  configureSyncService,
  getMeta,
  pickUpdatableColumns,
  stripPayloadForServer,
  type MutableTable,
  type SyncTransport,
} from '@festival/sync-engine';

import { LOCAL_OWNER_META_KEY } from './auth';
import { TransientAuthError } from './errors';
import { removeTotemObject } from './media';
import { getStoredSession } from './session';
import { getSupabase } from './supabase';

/**
 * Statuses that are retried whether or not the body came from PostgREST (the Supabase gateway answers
 * these itself, without an error code).
 */
function isRetryableStatus(status: number | null): boolean {
  return status === null || status === 0 || status >= 500 || status === 401 || status === 408 || status === 429;
}

/**
 * A response that cannot have come from PostgREST: something between the app and Supabase answered
 * (a proxy, WAF or captive-portal page). The write was never evaluated, so it is reported as a
 * connectivity failure (status 0): kept in the queue and retried, never dropped or marked synced.
 */
function unexpectedResponse(status: number | null, message?: string): SyncTransportError {
  return new SyncTransportError(`Unexpected response from the server${status ? ` (HTTP ${status})` : ''}.`, {
    status: 0,
    details: message ? message.slice(0, 200) : null,
  });
}

function toTransportError(error: { message?: string; code?: string; details?: string | null }, status: number | null): SyncTransportError {
  // Every PostgREST/Postgres error carries a code; a coded 4xx is a real verdict on the write.
  if (!error.code && !isRetryableStatus(status)) {
    return unexpectedResponse(status, error.message);
  }
  return new SyncTransportError(error.message || 'Sync request failed.', {
    code: error.code || null,
    status,
    details: error.details ?? null,
  });
}

/** A write without `.select()` asks PostgREST for no body (`return=minimal`): any body means it did not answer. */
function expectNoBody(data: unknown, status: number | null): void {
  if (data !== null && data !== undefined) {
    throw unexpectedResponse(status);
  }
}

/** A write with `.select()` gets a JSON array of the affected rows from PostgREST. */
function expectRows<T>(data: unknown, status: number | null): T[] {
  if (!Array.isArray(data)) {
    throw unexpectedResponse(status);
  }
  return data as T[];
}

function requireSession(): void {
  if (!getStoredSession()) {
    throw new TransientAuthError();
  }
}

/**
 * Sync transport backed by direct table writes under RLS. Payloads are stripped to the server
 * whitelist; selections upsert on `(user_id, set_id)` ignoring duplicates and delete by
 * `user_id + set_id`. Meetup creates upsert; meetup edits are plain updates (`update … where id`), so an
 * edit queued while the meetup was deleted on the server can never re-create it. Deleting a meetup also
 * removes its totem photo from storage. Nothing is sent without a stored session.
 */
export function createSupabaseSyncTransport(): SyncTransport {
  return {
    async upsert(table: MutableTable, payload: Record<string, unknown>) {
      requireSession();
      const body = stripPayloadForServer(table, payload);
      const client = getSupabase();
      const { data, error, status } =
        table === 'user_set_selections'
          ? await client.from('user_set_selections').upsert(body as never, { onConflict: 'user_id,set_id', ignoreDuplicates: true })
          : await client.from('meetups').upsert(body as never);
      if (error) {
        throw toTransportError(error, status);
      }
      expectNoBody(data, status);
    },

    async update(table: MutableTable, payload: Record<string, unknown>) {
      requireSession();
      if (typeof payload.id !== 'string') {
        throw new SyncTransportError(`Update operation for ${table} requires an id.`, { code: '22P02', status: 400 });
      }

      const fields = pickUpdatableColumns(table, payload);
      if (Object.keys(fields).length === 0) {
        return { found: true };
      }

      const { data, error, status } = await getSupabase()
        .from(table)
        .update(fields as never)
        .eq('id', payload.id)
        .select('id');
      if (error) {
        throw toTransportError(error, status);
      }
      // RLS hides rows the caller may not update, so zero rows means deleted (or no longer editable).
      return { found: expectRows(data, status).length > 0 };
    },

    async delete(table: MutableTable, payload: Record<string, unknown>) {
      requireSession();
      const client = getSupabase();

      if (table === 'user_set_selections' && typeof payload.user_id === 'string' && typeof payload.set_id === 'string') {
        const { data, error, status } = await client
          .from('user_set_selections')
          .delete()
          .eq('user_id', payload.user_id)
          .eq('set_id', payload.set_id);
        if (error) {
          throw toTransportError(error, status);
        }
        expectNoBody(data, status);
        return;
      }

      if (typeof payload.id !== 'string') {
        throw new SyncTransportError(`Delete operation for ${table} requires an id.`, { code: '22P02', status: 400 });
      }

      if (table === 'meetups') {
        const { data, error, status } = await client.from('meetups').delete().eq('id', payload.id).select('id, totem_path');
        if (error) {
          throw toTransportError(error, status);
        }
        // The path comes from the deleted server row, so it is current even when the local copy is stale.
        // Best effort and not awaited, so a slow storage call never holds up the rest of the queue; an
        // object left behind is removed with the uploader's account.
        for (const row of expectRows<{ totem_path: string | null }>(data, status)) {
          if (row.totem_path) {
            void removeTotemObject(row.totem_path);
          }
        }
        return;
      }

      const { data, error, status } = await client.from(table).delete().eq('id', payload.id);
      if (error) {
        throw toTransportError(error, status);
      }
      expectNoBody(data, status);
    },
  };
}

/**
 * Wires the sync engine to Supabase: the transport above plus the stored-session pre-check
 * (`flush()` never sends with a missing or about-to-expire session, or with a session whose user is
 * not `app_meta.local_owner_auth_user_id` — the queue may still hold another account's writes until
 * `ensureLocalOwner` has run). Call once at app start.
 */
export function configureDataSync(): void {
  configureSyncService({
    transport: createSupabaseSyncTransport(),
    getSession: () => getStoredSession(),
    getLocalOwner: () => getMeta(LOCAL_OWNER_META_KEY),
  });
}
