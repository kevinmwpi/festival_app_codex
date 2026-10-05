import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * The app's single React Query client. User-data query keys must include the auth user id
 * (§5.1); `performSignOut` clears the whole cache.
 *
 * `networkMode: 'always'`: query functions read the local SQLite/MMKV cache first (and refresh in
 * the background only when online), so they must run offline too — React Query's default `'online'`
 * mode would pause them, and pause user-initiated mutations silently, whenever NetInfo reports
 * offline. Mutations fail fast instead and show their error.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      networkMode: 'always',
    },
    mutations: {
      networkMode: 'always',
    },
  },
});

/**
 * Offline only when NetInfo says so; "unknown" (`null`, before the first probe) counts as online,
 * like the sync engine's optimistic `isOnline()`, so launch does not register a fake reconnect.
 */
function isReachable(state: NetInfoState): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

let lifecycleConnected = false;

/**
 * Connects React Query to React Native (it only knows the browser's `online` / `visibilitychange`
 * events): app foreground → `focusManager` (stale queries of mounted screens refetch on return to the
 * app), NetInfo → `onlineManager` (they refetch on reconnect). Idempotent; called once by
 * `AppProviders`.
 */
export function connectQueryClientToApp(): void {
  if (lifecycleConnected) {
    return;
  }
  lifecycleConnected = true;

  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      handleFocus(status === 'active');
    });
    return () => subscription.remove();
  });

  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(isReachable(state));
    }),
  );
}
