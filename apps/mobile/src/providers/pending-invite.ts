/**
 * An invite link (`festivalapp://group/join?code=ABC123`) opened before the user is signed in and set
 * up is remembered here, so the join screen can open with the code once sign-in and profile setup are
 * done (§5.1). Stored in MMKV `pending-invite-code`; forgotten after a day so an old link never
 * resurfaces unexpectedly.
 */
import { isWellFormedInviteCode, normaliseInviteCode } from '@festival/data-access';
import { createMMKV, type MMKV } from 'react-native-mmkv';

const STORAGE_ID = 'pending-invite-code';
const STORAGE_KEY = 'pending';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

let storage: MMKV | null = null;

function getStorage(): MMKV | null {
  try {
    storage ??= createMMKV({ id: STORAGE_ID });
    return storage;
  } catch {
    return null;
  }
}

/** Remembers `code` (normalised) when it looks like an invite code. Returns the stored code or `null`. */
export function savePendingInviteCode(code: string): string | null {
  const normalised = normaliseInviteCode(code);
  if (!isWellFormedInviteCode(normalised)) {
    return null;
  }
  try {
    getStorage()?.set(STORAGE_KEY, JSON.stringify({ code: normalised, savedAt: Date.now() }));
  } catch {
    return null;
  }
  return normalised;
}

/** The remembered invite code, or `null` (none, malformed or older than a day). */
export function peekPendingInviteCode(): string | null {
  try {
    const raw = getStorage()?.getString(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { code?: unknown; savedAt?: unknown };
    const fresh = typeof parsed.savedAt === 'number' && Date.now() - parsed.savedAt <= MAX_AGE_MS;
    if (typeof parsed.code === 'string' && fresh && isWellFormedInviteCode(parsed.code)) {
      return parsed.code;
    }
    clearPendingInviteCode();
    return null;
  } catch {
    clearPendingInviteCode();
    return null;
  }
}

export function clearPendingInviteCode(): void {
  try {
    getStorage()?.remove(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Returns the remembered invite code and forgets it (the join screen pre-fills it once; it never
 * auto-joins).
 */
export function takePendingInviteCode(): string | null {
  const code = peekPendingInviteCode();
  if (code) {
    clearPendingInviteCode();
  }
  return code;
}

/**
 * The invite code in an incoming system path or URL when it targets the join screen
 * (`festivalapp://group/join?code=…`, `/group/join?code=…`, `group/join?code=…`), else `null`.
 */
export function inviteCodeFromSystemPath(path: string): { isJoinPath: boolean; code: string | null } {
  // Drop the scheme ("festivalapp://"), then any leading slashes.
  const withoutScheme = path.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/+/, '');
  const [pathname = '', query = ''] = withoutScheme.split('#')[0].split('?');
  const segments = pathname.split('/').filter(Boolean);
  const isJoinPath = segments.length === 2 && segments[0].toLowerCase() === 'group' && segments[1].toLowerCase() === 'join';
  if (!isJoinPath) {
    return { isJoinPath: false, code: null };
  }

  for (const pair of query.split('&')) {
    const [key, value = ''] = pair.split('=');
    if (key === 'code') {
      try {
        return { isJoinPath, code: decodeURIComponent(value.replace(/\+/g, ' ')) };
      } catch {
        return { isJoinPath, code: null };
      }
    }
  }
  return { isJoinPath, code: null };
}
