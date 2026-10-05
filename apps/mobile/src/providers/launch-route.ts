/**
 * Where the app opens (§5.1). Routing reads only the synchronous MMKV caches — the stored session and
 * the cached profile — and goes online only for a signed-in user whose profile is not cached yet.
 */
import { getCachedProfile, getMyProfile, getStoredSession } from '@festival/data-access';
import { isOnline } from '@festival/sync-engine';
import { router, type Href } from 'expo-router';

import { takePendingInviteCode } from './pending-invite';

export const SIGN_IN_HREF = '/auth/enter-email' as const;
export const PROFILE_SETUP_HREF = '/auth/profile-setup' as const;
export const HOME_HREF = '/(tabs)/festivals' as const;

/** The device is offline, so a signed-in user without a cached profile cannot be routed yet. */
export class LaunchOfflineError extends Error {
  readonly code = 'launch_offline';

  constructor() {
    super("You're offline.");
    this.name = 'LaunchOfflineError';
  }
}

/**
 * Home for a signed-in user with a profile: the join screen pre-filled with a remembered invite code
 * (the code is forgotten here, so it opens once), else the festivals tab.
 */
export function signedInHome(): Href {
  const code = takePendingInviteCode();
  return code ? { pathname: '/(tabs)/group/join', params: { code } } : HOME_HREF;
}

/**
 * The route decidable without the network, or `null` when the profile must be fetched:
 * no stored session → sign-in; stored session + cached profile for that user → home (even when the
 * access token has expired — auto-refresh fixes it once online).
 */
export function resolveLaunchRouteOffline(): Href | null {
  if (!getStoredSession()) {
    return SIGN_IN_HREF;
  }
  return getCachedProfile() ? signedInHome() : null;
}

/**
 * Full routing decision. With a stored session and no cached profile it asks the server
 * (`getMyProfile()`): none → profile setup.
 *
 * @param attemptWhenOffline send the lookup even when the connectivity monitor says offline (explicit
 *   retries: the monitor can lag behind a connection that just came back).
 * @throws LaunchOfflineError when that lookup is needed while offline, or the lookup's own error.
 *   Callers show a retry screen — never the sign-in screen, which would strand an offline user.
 */
export async function resolveLaunchRoute({ attemptWhenOffline = false }: { attemptWhenOffline?: boolean } = {}): Promise<Href> {
  const offlineRoute = resolveLaunchRouteOffline();
  if (offlineRoute) {
    return offlineRoute;
  }
  if (!attemptWhenOffline && !isOnline()) {
    throw new LaunchOfflineError();
  }
  const profile = await getMyProfile();
  if (!getStoredSession()) {
    // Signed out while the request was in flight (e.g. the session was revoked).
    return SIGN_IN_HREF;
  }
  return profile ? signedInHome() : PROFILE_SETUP_HREF;
}

/**
 * Replaces the whole root stack with `href`, so the back gesture cannot return to sign-in screens
 * after signing in (or to the app after leaving it).
 */
export function resetTo(href: Href): void {
  if (router.canDismiss()) {
    router.dismissAll();
  }
  router.replace(href);
}
