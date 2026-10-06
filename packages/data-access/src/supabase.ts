import { createClient, type AuthChangeEvent, type Session, type SupabaseClient } from '@supabase/supabase-js';

import { fetchWithTimeout, getSupabaseConfig, REQUEST_TIMEOUT_MS, supabaseConfigError, type SupabaseConfig } from './config';
import type { Database } from './database.types';
import { toDataAccessError, unexpectedResponseError } from './errors';
import { requireStoredSession } from './session';
import { AUTH_SESSION_KEY, getAuthStorage } from './storage';

export type FestivalSupabaseClient = SupabaseClient<Database>;
type PublicFunctions = Database['public']['Functions'];
export type RpcName = keyof PublicFunctions;
type AuthHandler = (event: AuthChangeEvent, session: Session | null) => void;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface AuthSubscription {
  handler: AuthHandler;
  /** Unsubscribes from the client it is currently attached to. */
  detach: (() => void) | null;
  /** `INITIAL_SESSION` is delivered once per subscription, not again for every replacement client. */
  receivedInitialSession: boolean;
}

let client: FestivalSupabaseClient | null = null;
let clientOverride: FestivalSupabaseClient | null = null;
let configOverride: (SupabaseConfig & { fetch?: FetchLike }) | null = null;
/**
 * Incremented whenever the client is retired. Each client's storage adapter remembers the generation
 * it was created in and goes inert once it is no longer current.
 */
let clientGeneration = 0;
/** Last value passed to `setAuthAutoRefresh` (null: never called), replayed onto replacement clients. */
let autoRefreshActive: boolean | null = null;
const authSubscriptions = new Set<AuthSubscription>();

function createSupabaseClient(generation: number): FestivalSupabaseClient {
  const config = configOverride ?? getSupabaseConfig();
  const isCurrent = () => generation === clientGeneration;
  return createClient<Database>(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
      storageKey: AUTH_SESSION_KEY,
      // A retired client (see `retireSupabaseClient`) can neither read nor change the persisted session.
      storage: {
        getItem(key) {
          return isCurrent() ? (getAuthStorage().getString(key) ?? null) : null;
        },
        removeItem(key) {
          if (isCurrent()) {
            getAuthStorage().remove(key);
          }
        },
        setItem(key, value) {
          if (isCurrent()) {
            getAuthStorage().set(key, value);
          }
        },
      },
    },
    global: {
      fetch: fetchWithTimeout(REQUEST_TIMEOUT_MS, configOverride?.fetch ? { fetchImpl: configOverride.fetch } : {}),
      headers: {
        'x-client-info': 'festie-mobile',
      },
    },
  });
}

function attachAuthSubscription(subscription: AuthSubscription, target: FestivalSupabaseClient): void {
  subscription.detach?.();
  const { data } = target.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') {
      if (subscription.receivedInitialSession) {
        return;
      }
      subscription.receivedInitialSession = true;
    }
    subscription.handler(event, session);
  });
  subscription.detach = () => data.subscription.unsubscribe();
}

/**
 * The Supabase client. Throws `ConfigError` when `supabaseConfigError` is set (no client is ever
 * created without config).
 */
export function getSupabase(): FestivalSupabaseClient {
  if (clientOverride) {
    return clientOverride;
  }

  if (!client) {
    const created = createSupabaseClient(clientGeneration);
    client = created;
    for (const subscription of authSubscriptions) {
      attachAuthSubscription(subscription, created);
    }
    if (autoRefreshActive === false) {
      void created.auth.stopAutoRefresh().catch(() => undefined);
    }
  }

  return client;
}

/**
 * Detaches the current client so the next `getSupabase()` builds a fresh one. The retired client may
 * still have calls in flight (e.g. a sign-out stuck on a slow network): from now on its storage adapter
 * ignores reads and writes, its auth events no longer reach `subscribeToAuthChanges` handlers and its
 * refresh ticker is stopped, so nothing it does later can touch a newer session. Auth subscriptions
 * move to the replacement client. Returns `false` when there was nothing to retire.
 */
export function retireSupabaseClient(): boolean {
  if (clientOverride || !client) {
    return false;
  }

  const retired = client;
  client = null;
  clientGeneration += 1;
  for (const subscription of authSubscriptions) {
    subscription.detach?.();
    subscription.detach = null;
  }
  void retired.auth.stopAutoRefresh().catch(() => undefined);
  return true;
}

export function isSupabaseConfigured(): boolean {
  return clientOverride !== null || configOverride !== null || supabaseConfigError === null;
}

/** Replaces the client with a fake (tests only). `null` restores the real client. */
export function setSupabaseClientForTests(override: unknown): void {
  clientOverride = (override as FestivalSupabaseClient | null) ?? null;
}

/**
 * Builds real supabase-js clients from this config instead of the `EXPO_PUBLIC_*` env (tests only);
 * `fetch` replaces the network. `null` restores the env config. Retires any existing client.
 */
export function setSupabaseConfigForTests(override: (SupabaseConfig & { fetch?: FetchLike }) | null): void {
  retireSupabaseClient();
  configOverride = override;
}

/** Retires the client and drops every auth subscription and test override (tests only). */
export function resetSupabaseForTests(): void {
  retireSupabaseClient();
  authSubscriptions.clear();
  clientOverride = null;
  configOverride = null;
  autoRefreshActive = null;
}

/**
 * Calls a `public` RPC as the signed-in user. Throws `TransientAuthError` without sending when no
 * session is stored, and a `DataAccessError` (with `code`/`status`) when the RPC fails.
 */
export async function callRpc<Name extends RpcName>(
  name: Name,
  args?: PublicFunctions[Name]['Args'] extends never ? undefined : PublicFunctions[Name]['Args'],
): Promise<PublicFunctions[Name]['Returns']> {
  requireStoredSession();
  const { data, error, status } = await getSupabase().rpc(name as never, args as never);
  if (error) {
    throw toDataAccessError(error, status);
  }

  return data as PublicFunctions[Name]['Returns'];
}

/**
 * The rows returned by an RPC that returns a table. PostgREST always answers those with a JSON array
 * (`[]` when nothing matched); anything else (e.g. an empty reply, which supabase-js reports as
 * `null`) did not come from PostgREST and throws a retryable `DataAccessError` (status 0) instead of
 * reading as "no rows".
 */
export function requireRpcRows<T>(rows: readonly T[] | null | undefined): readonly T[] {
  if (!Array.isArray(rows)) {
    throw unexpectedResponseError();
  }
  return rows;
}

/** Throws a `DataAccessError` for a failed supabase-js result, otherwise returns `data`. */
export function unwrapResult<T>(result: { data: T | null; error: unknown; status?: number }): T {
  if (result.error) {
    throw toDataAccessError(result.error as Error, result.status ?? null);
  }

  return result.data as T;
}

/**
 * Subscribes to Supabase auth events. Returns an unsubscribe function (a no-op without config).
 * The subscription survives client replacement (`retireSupabaseClient`): it follows the current client,
 * receives `INITIAL_SESSION` once, and never receives events from a retired client.
 */
export function subscribeToAuthChanges(handler: AuthHandler): () => void {
  if (!isSupabaseConfigured()) {
    return () => undefined;
  }

  const subscription: AuthSubscription = { handler, detach: null, receivedInitialSession: false };
  authSubscriptions.add(subscription);
  const current = getSupabase();
  if (!subscription.detach) {
    attachAuthSubscription(subscription, current);
  }

  return () => {
    authSubscriptions.delete(subscription);
    subscription.detach?.();
    subscription.detach = null;
  };
}

/**
 * React Native has no visibility events: call with `true` when the app becomes active and `false`
 * when it goes to the background so tokens refresh only while the app is in use.
 */
export function setAuthAutoRefresh(active: boolean): void {
  if (!isSupabaseConfigured()) {
    return;
  }

  autoRefreshActive = active;
  const auth = getSupabase().auth;
  void (active ? auth.startAutoRefresh() : auth.stopAutoRefresh()).catch(() => undefined);
}
