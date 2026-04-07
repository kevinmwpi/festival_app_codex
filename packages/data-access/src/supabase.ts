import type { SyncTransport } from '@festival/sync-engine';
import { createClient } from '@supabase/supabase-js';
import { createMMKV } from 'react-native-mmkv';

import type { Database } from './database.types';
import type { UserRow } from './models';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://example.supabase.co';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_KEY ??
  'development-anon-key';

console.log('[Supabase Init]', { url: supabaseUrl, keyPrefix: supabaseAnonKey?.substring(0, 20) + '...' });

const storage = createMMKV({ id: 'festival-auth' });

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true,
    storageKey: 'supabase_session',
    storage: {
      getItem(key) {
        return storage.getString(key) ?? null;
      },
      removeItem(key) {
        storage.remove(key);
      },
      setItem(key, value) {
        storage.set(key, value);
      },
    },
  },
  global: {
    headers: {
      'x-client-info': 'festival-app',
    },
  },
});

const client = supabase as any;

export async function getUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw error;
  }

  return data.user ?? null;
}

export async function signInWithOTP(email: string): Promise<void> {
  const url = `${supabaseUrl}/functions/v1/request-otp`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = (body as { error?: string }).error ?? 'Unable to send login code.';
    throw new Error(message);
  }
}

export async function verifyOTP(email: string, token: string) {
  const url = `${supabaseUrl}/functions/v1/verify-otp`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({ email, token }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = (body as { error?: string }).error ?? 'That code was not accepted.';
    throw new Error(message);
  }

  const { access_token, refresh_token } = (await response.json()) as {
    access_token: string;
    refresh_token: string;
  };

  const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) {
    throw error;
  }

  return data.session;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

export function subscribeToAuthChanges(handler: Parameters<typeof supabase.auth.onAuthStateChange>[0]): () => void {
  const { data } = supabase.auth.onAuthStateChange(handler);
  return () => data.subscription.unsubscribe();
}

export async function getCurrentProfile(): Promise<UserRow | null> {
  const user = await getUser();
  if (!user?.email) {
    return null;
  }

  const { data, error } = await client.from('users').select('*').eq('email', user.email).maybeSingle();
  if (error) {
    throw error;
  }

  return (data as UserRow | null) ?? null;
}

export async function saveProfile(input: {
  display_name: string;
  avatar_type: string;
  avatar_value: string;
}): Promise<UserRow> {
  const user = await getUser();
  if (!user?.email) {
    throw new Error('No authenticated user is available.');
  }

  const { data, error } = await client
    .from('users')
    .upsert(
      {
        email: user.email,
        display_name: input.display_name,
        avatar_type: input.avatar_type,
        avatar_value: input.avatar_value,
      },
      {
        onConflict: 'email',
      },
    )
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data as UserRow;
}

export async function requireCurrentProfile(): Promise<UserRow> {
  const profile = await getCurrentProfile();
  if (!profile) {
    throw new Error('The signed-in user does not have a profile yet.');
  }

  return profile;
}

export function createSupabaseSyncTransport(): SyncTransport {
  return {
    async upsert(table, payload) {
      const { error } = await supabase.from(table as never).upsert(payload as never);
      if (error) {
        throw error;
      }
    },
    async delete(table, payload) {
      const id = payload.id;
      if (typeof id !== 'string') {
        throw new Error(`Delete operation for ${table} requires an id.`);
      }

      const { error } = await supabase.from(table as never).delete().eq('id', id);
      if (error) {
        throw error;
      }
    },
  };
}
