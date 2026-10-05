import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as syncEngine from '@festival/sync-engine';

import { LOCAL_OWNER_META_KEY, ensureLocalOwner } from '../src/auth';
import { setupDataAccessTest, teardownDataAccessTest } from './helpers';

/** Counts wipes without changing what they do. */
vi.mock('@festival/sync-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@festival/sync-engine')>();
  return { ...actual, clearLocalUserData: vi.fn(actual.clearLocalUserData) };
});

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const clearLocalUserData = vi.mocked(syncEngine.clearLocalUserData);

describe('ensureLocalOwner (single-flight)', () => {
  beforeEach(() => {
    setupDataAccessTest();
    clearLocalUserData.mockClear();
  });
  afterEach(teardownDataAccessTest);

  it('concurrent calls for the same user share one claim and wipe at most once', async () => {
    await syncEngine.setMeta(LOCAL_OWNER_META_KEY, USER_A);
    await syncEngine.enqueue({ table: 'meetups', type: 'delete', payload: { id: 'm1' } });

    const first = ensureLocalOwner(USER_B);
    const second = ensureLocalOwner(USER_B);
    const third = ensureLocalOwner(USER_B);
    expect(second).toBe(first);
    expect(third).toBe(first);
    await Promise.all([first, second, third]);

    expect(clearLocalUserData).toHaveBeenCalledTimes(1);
    expect(await syncEngine.getMeta(LOCAL_OWNER_META_KEY)).toBe(USER_B);
    expect(await syncEngine.getPendingCount()).toBe(0);
  });

  it('a call after the claim settles starts a new check (no wipe for the same owner)', async () => {
    await ensureLocalOwner(USER_A);
    expect(clearLocalUserData).toHaveBeenCalledTimes(1);

    await syncEngine.enqueue({ table: 'meetups', type: 'delete', payload: { id: 'm1' } });
    const again = ensureLocalOwner(USER_A);
    await again;
    expect(clearLocalUserData).toHaveBeenCalledTimes(1);
    expect(await syncEngine.getPendingCount()).toBe(1);
  });

  it('a different user waits for the in-flight claim, and the latest call decides the owner', async () => {
    await syncEngine.setMeta(LOCAL_OWNER_META_KEY, USER_A);
    const order: string[] = [];

    const toB = ensureLocalOwner(USER_B).then(() => order.push('B'));
    const backToA = ensureLocalOwner(USER_A).then(() => order.push('A'));
    await Promise.all([toB, backToA]);

    expect(order).toEqual(['B', 'A']);
    expect(clearLocalUserData).toHaveBeenCalledTimes(2);
    expect(await syncEngine.getMeta(LOCAL_OWNER_META_KEY)).toBe(USER_A);
  });

  it('a failed claim rejects every caller that shared it; the next call retries', async () => {
    clearLocalUserData.mockRejectedValueOnce(new Error('disk full'));

    const first = ensureLocalOwner(USER_B);
    const second = ensureLocalOwner(USER_B);
    expect(second).toBe(first);
    await expect(first).rejects.toThrow('disk full');
    await expect(second).rejects.toThrow('disk full');
    expect(await syncEngine.getMeta(LOCAL_OWNER_META_KEY)).toBeNull();

    await ensureLocalOwner(USER_B);
    expect(clearLocalUserData).toHaveBeenCalledTimes(2);
    expect(await syncEngine.getMeta(LOCAL_OWNER_META_KEY)).toBe(USER_B);
  });

  it('a queued claim for another user still runs after an in-flight claim fails', async () => {
    clearLocalUserData.mockRejectedValueOnce(new Error('disk full'));

    const failing = ensureLocalOwner(USER_B);
    const queued = ensureLocalOwner(USER_A);
    await expect(failing).rejects.toThrow('disk full');
    await queued;
    expect(await syncEngine.getMeta(LOCAL_OWNER_META_KEY)).toBe(USER_A);
  });
});
