import { TransientAuthError } from './errors';
import { AUTH_SESSION_KEY, getAuthStorage } from './storage';

export interface StoredSession {
  /** `auth.users.id` of the signed-in user. */
  authUserId: string;
  /** Access-token expiry, epoch milliseconds (0 when unknown — treat as expired). */
  expiresAt: number;
}

/**
 * Parses a persisted supabase-js session. Requires a `refresh_token` and `user.id`; an expired
 * access token still counts (auto-refresh replaces it once online).
 */
export function parseStoredSession(raw: string | null | undefined): StoredSession | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  // Older supabase-js versions wrapped the session as `{ currentSession, expiresAt }`.
  const container = parsed as Record<string, unknown>;
  const session = (
    container.currentSession && typeof container.currentSession === 'object' ? container.currentSession : container
  ) as Record<string, unknown>;

  const refreshToken = session.refresh_token;
  const user = session.user as Record<string, unknown> | null | undefined;
  const authUserId = user && typeof user === 'object' ? user.id : undefined;
  if (typeof refreshToken !== 'string' || refreshToken.length === 0 || typeof authUserId !== 'string' || authUserId.length === 0) {
    return null;
  }

  const expiresAtSeconds = typeof session.expires_at === 'number' ? session.expires_at : Number(session.expires_at);
  return {
    authUserId,
    expiresAt: Number.isFinite(expiresAtSeconds) && expiresAtSeconds > 0 ? expiresAtSeconds * 1000 : 0,
  };
}

/**
 * The persisted session, read synchronously from MMKV. Never calls `supabase.auth.*`, so it is safe on
 * launch/render paths with no network and an expired token.
 */
export function getStoredSession(): StoredSession | null {
  try {
    return parseStoredSession(getAuthStorage().getString(AUTH_SESSION_KEY));
  } catch {
    return null;
  }
}

/** Throws `TransientAuthError` (without sending anything) when no session is stored. */
export function requireStoredSession(): StoredSession {
  const session = getStoredSession();
  if (!session) {
    throw new TransientAuthError();
  }

  return session;
}

export function removeStoredSession(): void {
  try {
    const storage = getAuthStorage();
    storage.remove(AUTH_SESSION_KEY);
    // Auxiliary keys supabase-js may write next to the session.
    storage.remove(`${AUTH_SESSION_KEY}-user`);
    storage.remove(`${AUTH_SESSION_KEY}-code-verifier`);
  } catch {
    // Nothing persisted or storage unavailable: already signed out locally.
  }
}
