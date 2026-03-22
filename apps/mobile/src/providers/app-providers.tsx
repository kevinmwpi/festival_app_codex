import { createSupabaseSyncTransport, subscribeToAuthChanges } from '@festival/data-access';
import { configureSyncService, flush } from '@festival/sync-engine';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { AppState } from 'react-native';

import { AppStoreProvider } from '@/src/state/app-store';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
    },
  },
});

export function AppProviders({ children }: React.PropsWithChildren) {
  React.useEffect(() => {
    configureSyncService({
      transport: createSupabaseSyncTransport(),
    });

    const appStateSubscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        void flush();
      }
    });

    const unsubscribeAuth = subscribeToAuthChanges(async () => {
      await flush();
    });

    return () => {
      appStateSubscription.remove();
      unsubscribeAuth();
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AppStoreProvider>{children}</AppStoreProvider>
    </QueryClientProvider>
  );
}
