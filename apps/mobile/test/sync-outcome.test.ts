import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * writeAndAwaitSync: a screen that queues a write (Create Meetup) learns a server rejection before it
 * reports success, and the global failure toast skips the failure that screen shows inline.
 */

type Listener = (event: { type: string; table?: string; recordId?: string; failure?: unknown }) => void;

const h = vi.hoisted(() => ({
  online: true,
  listeners: new Set<Listener>(),
  onFlush: null as (() => Promise<void>) | null,
}));

vi.mock('@festival/sync-engine', () => ({
  isOnline: () => h.online,
  subscribeToSyncEvents: (listener: Listener) => {
    h.listeners.add(listener);
    return () => h.listeners.delete(listener);
  },
  flush: () => (h.onFlush ?? (async () => undefined))(),
}));

import { consumeInlineFailure, writeAndAwaitSync } from '../src/hooks/sync-outcome';

const emit: Listener = (event) => h.listeners.forEach((listener) => listener(event));
const failure = { id: 'f1', table: 'meetups', type: 'upsert', recordId: 'm1', payload: {}, errorCode: 'content_not_allowed', errorMessage: null, failedAt: '' };
const write = async () => ({ id: 'm1' });

beforeEach(() => {
  h.online = true;
  h.listeners.clear();
  h.onFlush = null;
});

describe('writeAndAwaitSync', () => {
  it('reports a server rejection of the queued record and marks it as shown inline', async () => {
    h.onFlush = async () => emit({ type: 'failed', table: 'meetups', recordId: 'm1', failure });
    const { outcome } = await writeAndAwaitSync('meetups', write);
    expect(outcome).toEqual({ status: 'failed', failure });
    expect(consumeInlineFailure('m1')).toBe(true);
    expect(consumeInlineFailure('m1')).toBe(false);
    expect(h.listeners.size).toBe(0);
  });

  it('reports synced, and ignores events of other records and tables', async () => {
    h.onFlush = async () => {
      emit({ type: 'failed', table: 'meetups', recordId: 'other', failure });
      emit({ type: 'synced', table: 'user_set_selections', recordId: 'm1' });
      emit({ type: 'synced', table: 'meetups', recordId: 'm1' });
    };
    const { outcome } = await writeAndAwaitSync('meetups', write);
    expect(outcome).toEqual({ status: 'synced' });
    expect(consumeInlineFailure('other')).toBe(false);
  });

  it('stays pending offline, when the flush ends without an outcome, or after the wait', async () => {
    h.online = false;
    await expect(writeAndAwaitSync('meetups', write)).resolves.toMatchObject({ outcome: { status: 'pending' } });

    h.online = true;
    await expect(writeAndAwaitSync('meetups', write)).resolves.toMatchObject({ outcome: { status: 'pending' } });

    vi.useFakeTimers();
    try {
      h.onFlush = () => new Promise<void>(() => undefined);
      const waiting = writeAndAwaitSync('meetups', write, 1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(waiting).resolves.toMatchObject({ outcome: { status: 'pending' } });
    } finally {
      vi.useRealTimers();
    }
  });
});
