import {
  configureDataSync,
  getStoredSession,
  setAuthAutoRefresh,
  subscribeToAuthChanges,
} from '@festival/data-access';
import { flush } from '@festival/sync-engine';
import { colors, layout, ToastHost } from '@festival/ui';
import Mapbox from '@rnmapbox/maps';
import { QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import React, { useContext, useEffect, useSyncExternalStore } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { MAPBOX_ACCESS_TOKEN } from '@/src/config/app-info';
import { LocationSharingProvider } from '@/src/location/LocationSharingProvider';
import { AppStoreProvider } from '@/src/state/app-store';

import { runOwnerCheck, waitForOwnerCheck } from './owner-check';
import { connectQueryClientToApp, queryClient } from './query-client';
import { isSigningOut, performSignOut } from './session-actions';
import { notifySessionChanged } from './session-state';

export { queryClient } from './query-client';

function warn(step: string, error: unknown): void {
  if (__DEV__) {
    console.warn(`[app-providers] ${step} failed`, error);
  }
}

/** Flushes the offline queue once no local owner check is pending (never another account's queue). */
function flushQueue(): void {
  void waitForOwnerCheck()
    .then(() => flush())
    .catch((error: unknown) => warn('flush', error));
}

/* ─── Launch readiness ──────────────────────────────────── */

let launchCheckStarted = false;
let providersReady = false;
const readyListeners = new Set<() => void>();

function markProvidersReady(): void {
  if (providersReady) {
    return;
  }
  providersReady = true;
  readyListeners.forEach((listener) => listener());
}

/**
 * At launch with a stored session, the local owner must be confirmed before anything renders that
 * could enqueue a write for the wrong owner; then the offline queue flushes. Idempotent.
 */
function startLaunchOwnerCheck(): void {
  if (launchCheckStarted) {
    return;
  }
  launchCheckStarted = true;

  const stored = getStoredSession();
  if (!stored) {
    markProvidersReady();
    return;
  }
  void runOwnerCheck(stored.authUserId)
    .catch((error: unknown) => warn('launch ensureLocalOwner', error))
    .finally(() => {
      markProvidersReady();
      flushQueue();
    });
}

function subscribeToReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
}

function getProvidersReady(): boolean {
  return providersReady;
}

/**
 * `true` once `AppProviders` renders its children (the launch owner check has finished, or there is
 * no stored session). Usable outside `AppProviders` — e.g. to keep the splash screen up until the
 * first real frame. `AppProviders` itself hides the splash screen when it becomes ready.
 */
export function useAppProvidersReady(): boolean {
  configureServicesOnce();
  startLaunchOwnerCheck();
  return useSyncExternalStore(subscribeToReady, getProvidersReady, getProvidersReady);
}

/* ─── Services ──────────────────────────────────────────── */

let servicesConfigured = false;

/** One-time, synchronous service setup (idempotent across remounts and fast refresh). */
function configureServicesOnce(): void {
  if (servicesConfigured) {
    return;
  }
  servicesConfigured = true;

  configureDataSync();
  connectQueryClientToApp();

  if (MAPBOX_ACCESS_TOKEN) {
    try {
      void Mapbox.setAccessToken(MAPBOX_ACCESS_TOKEN).catch((error: unknown) => warn('Mapbox token', error));
      Mapbox.setTelemetryEnabled(false);
    } catch (error) {
      warn('Mapbox setup', error);
    }
  }
}

/**
 * App-wide providers: `QueryClientProvider > AppStoreProvider > LocationSharingProvider > children`,
 * plus the toast host. Also owns the session lifecycle wiring:
 * - the sync engine (`configureDataSync`), React Query's focus/online signals (AppState, NetInfo)
 *   and Mapbox (token, telemetry off) are set up once;
 * - auth token auto-refresh follows AppState (on when active, off in the background);
 * - at launch with a stored session, `ensureLocalOwner` runs before children render (nothing can
 *   enqueue for the wrong owner), then the offline queue flushes; meanwhile the splash screen stays
 *   up (hidden here once ready) over an app-coloured placeholder;
 * - `SIGNED_IN` → `ensureLocalOwner` (serialised after the launch check; routing waits for it, see
 *   `owner-check.ts`), cached queries reset when the account changed, then flush;
 *   `TOKEN_REFRESHED` → flush; `SIGNED_OUT` → `performSignOut('session_lost')`.
 */
export function AppProviders({ children }: React.PropsWithChildren) {
  const ready = useAppProvidersReady();

  useEffect(() => {
    if (ready) {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [ready]);

  useEffect(() => {
    setAuthAutoRefresh(AppState.currentState === 'active');
    const appStateSubscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        setAuthAutoRefresh(true);
        flushQueue();
      } else if (status === 'background') {
        setAuthAutoRefresh(false);
      }
    });

    const unsubscribeAuth = subscribeToAuthChanges((event, session) => {
      notifySessionChanged();
      switch (event) {
        case 'SIGNED_IN': {
          const authUserId = session?.user?.id;
          if (authUserId) {
            void runOwnerCheck(authUserId)
              .then(async ({ ownerChanged }) => {
                // A different account: anything React Query read before the wipe is discarded.
                if (ownerChanged) {
                  await queryClient.resetQueries();
                }
              })
              .catch((error: unknown) => warn('ensureLocalOwner', error))
              .finally(flushQueue);
          }
          break;
        }
        case 'TOKEN_REFRESHED':
          flushQueue();
          break;
        case 'SIGNED_OUT':
          // supabase-js removes the stored session before emitting SIGNED_OUT, so a stored session
          // here belongs to a newer sign-in and the event is stale. A sign-out already in progress
          // (signOut()/deleteAccount() emit this themselves) is joined by performSignOut.
          if (!isSigningOut() && getStoredSession() !== null) {
            break;
          }
          void performSignOut('session_lost').catch((error: unknown) => warn('session_lost sign-out', error));
          break;
        default:
          break;
      }
    });

    return () => {
      appStateSubscription.remove();
      unsubscribeAuth();
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AppStoreProvider>
        <LocationSharingProvider>
          {ready ? children : <View style={styles.placeholder} />}
          <AppToastHost />
        </LocationSharingProvider>
      </AppStoreProvider>
    </QueryClientProvider>
  );
}

/** Toasts float above the tab bar and the home indicator. */
function AppToastHost() {
  const insets = useContext(SafeAreaInsetsContext);
  return <ToastHost bottomOffset={layout.tabBarClearance + (insets?.bottom ?? 0)} />;
}

const styles = StyleSheet.create({
  placeholder: { backgroundColor: colors.background, flex: 1 },
});
