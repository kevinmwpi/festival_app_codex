import { createSqlJsDatabase, resetDbForTests, resetSyncServiceForTests, setDatabaseFactoryForTests, setOnlineStatusForTests } from '@festival/sync-engine';

import { resetDemoLoginMemoForTests } from '../src/auth';
import { clearSignedUrlCache } from '../src/media';
import {
  AUTH_SESSION_KEY,
  AUTH_STORAGE_ID,
  PROFILE_CACHE_KEY,
  PROFILE_CACHE_STORAGE_ID,
  resetKeyValueStoresForTests,
} from '../src/storage';
import { resetSupabaseForTests, setSupabaseClientForTests } from '../src/supabase';
import { __resetMMKV, createMMKV } from './mocks/react-native-mmkv';
import { createFakeSupabase, type FakeSupabase } from './mocks/supabase-client';

export const AUTH_USER_ID = '11111111-1111-4111-8111-111111111111';
export const PROFILE_ID = '22222222-2222-4222-8222-222222222222';

export function storeSession(options: { authUserId?: string; expiresInSeconds?: number } = {}): void {
  const expiresAt = Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? 3600);
  createMMKV({ id: AUTH_STORAGE_ID }).set(
    AUTH_SESSION_KEY,
    JSON.stringify({
      access_token: 'access',
      refresh_token: 'refresh',
      expires_at: expiresAt,
      token_type: 'bearer',
      user: { id: options.authUserId ?? AUTH_USER_ID, email: 'fan@example.com' },
    }),
  );
}

export function storeProfile(options: { id?: string; authUserId?: string } = {}): void {
  createMMKV({ id: PROFILE_CACHE_STORAGE_ID }).set(
    PROFILE_CACHE_KEY,
    JSON.stringify({
      id: options.id ?? PROFILE_ID,
      auth_user_id: options.authUserId ?? AUTH_USER_ID,
      display_name: 'Kev',
      avatar_type: 'initials',
      avatar_value: 'K',
    }),
  );
}

/** Fresh in-memory SQLite, empty MMKV, fake Supabase client. */
export function setupDataAccessTest(): FakeSupabase {
  __resetMMKV();
  resetKeyValueStoresForTests();
  resetDbForTests();
  resetSyncServiceForTests();
  setDatabaseFactoryForTests(() => createSqlJsDatabase());
  setOnlineStatusForTests(false);
  resetDemoLoginMemoForTests();
  clearSignedUrlCache();
  resetSupabaseForTests();
  const fake = createFakeSupabase();
  setSupabaseClientForTests(fake);
  return fake;
}

export function teardownDataAccessTest(): void {
  resetSupabaseForTests();
  resetDbForTests();
  resetSyncServiceForTests();
}
