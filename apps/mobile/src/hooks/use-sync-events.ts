import { toUserMessage } from '@festival/data-access';
import { subscribeToSyncEvents, type MutableTable, type SyncEvent } from '@festival/sync-engine';
import { showToast } from '@festival/ui';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { invalidateGroupQueries, invalidateSelectionQueries } from './query-keys';
import { consumeInlineFailure } from './sync-outcome';

const FAILED_COPY: Record<MutableTable, string> = {
  user_set_selections: "Couldn't save a schedule change",
  meetups: "Couldn't save a meetup change",
};

function invalidateTable(queryClient: QueryClient, table: MutableTable): void {
  if (table === 'user_set_selections') {
    void invalidateSelectionQueries(queryClient);
  } else {
    void invalidateGroupQueries(queryClient);
  }
}

/**
 * Bridges sync-engine events to the UI (mount once in the signed-in shell):
 * - `synced` → re-read the affected cache (clears "waiting to sync" badges);
 * - `failed` → the write was rejected for good and rolled back locally: re-read and explain why
 *   (unless the screen that is waiting for it shows the reason inline, see `writeAndAwaitSync`);
 * - `missing` → a queued meetup edit found the meetup deleted on the server: re-read crews/meetups.
 */
export function useSyncEventBridge(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Coalesce bursts (a flush syncs many operations at once) into one invalidation per table.
    const pending = new Set<MutableTable>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (table: MutableTable) => {
      pending.add(table);
      if (timer) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        const tables = [...pending];
        pending.clear();
        tables.forEach((name) => invalidateTable(queryClient, name));
      }, 150);
    };

    const unsubscribe = subscribeToSyncEvents((event: SyncEvent) => {
      switch (event.type) {
        case 'synced':
          schedule(event.table);
          break;
        case 'failed': {
          schedule(event.table);
          const reason = toUserMessage({ code: event.failure.errorCode, message: event.failure.errorMessage ?? '' });
          // Next tick: every listener (including a waiting screen) has seen the event by then.
          setTimeout(() => {
            if (!consumeInlineFailure(event.recordId)) {
              showToast(`${FAILED_COPY[event.table]}: ${reason}`, 'error');
            }
          }, 0);
          break;
        }
        case 'missing':
          schedule('meetups');
          showToast('A meetup you edited was removed from the crew.', 'neutral');
          break;
        default:
          break;
      }
    });

    return () => {
      unsubscribe();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [queryClient]);
}
