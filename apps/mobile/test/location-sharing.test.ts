import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * LocationSharingController (§5.6) against fakes of expo-location, data-access and AppState: stop/send
 * ordering, stale fixes, the stop() result and re-asking for an expired "Allow Once" grant.
 */

type Fix = { coords: { latitude: number; longitude: number; accuracy: number; heading: number }; timestamp: number };

const h = vi.hoisted(() => {
  const state = {
    session: { authUserId: 'auth-1' } as { authUserId: string } | null,
    current: null as unknown,
    lastKnown: null as unknown,
    watchCallback: null as ((location: unknown) => void) | null,
    permission: { granted: true, canAskAgain: true },
    requestResult: { granted: true, canAskAgain: true },
    log: [] as string[],
    share: null as ((groupId: string, coords: { latitude: number }) => Promise<void>) | null,
    stopSharing: null as ((groupId: string) => Promise<void>) | null,
    appStateListeners: new Set<(state: string) => void>(),
    storage: new Map<string, string>(),
  };
  return { state };
});

vi.mock('@festival/data-access', () => ({
  getStoredSession: () => h.state.session,
  requireStoredSession: () => {
    if (!h.state.session) throw new Error('no session');
    return h.state.session;
  },
  getErrorCode: (error: { code?: string } | undefined) => error?.code ?? null,
  isAppErrorCode: (error: { code?: string } | undefined, code: string) => error?.code === code,
  shareLocation: (groupId: string, coords: { latitude: number }) => {
    h.state.log.push(`share:start ${coords.latitude}`);
    return (h.state.share ?? (async () => undefined))(groupId, coords).then(() => {
      h.state.log.push(`share:done ${coords.latitude}`);
    });
  },
  stopSharingLocation: (groupId: string) => {
    h.state.log.push(`delete ${groupId}`);
    return (h.state.stopSharing ?? (async () => undefined))(groupId);
  },
}));
vi.mock('@festival/ui', () => ({ showToast: (message: string) => h.state.log.push(`toast ${message}`) }));
vi.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: async () => h.state.permission,
  requestForegroundPermissionsAsync: async () => {
    h.state.log.push('prompt');
    h.state.permission = h.state.requestResult;
    return h.state.requestResult;
  },
  hasServicesEnabledAsync: async () => true,
  getCurrentPositionAsync: async () => h.state.current,
  getLastKnownPositionAsync: async (options?: { maxAge?: number }) => {
    h.state.log.push(`lastKnown maxAge=${options?.maxAge ?? 'none'}`);
    const fix = h.state.lastKnown as Fix | null;
    if (fix && options?.maxAge !== undefined && Date.now() - fix.timestamp > options.maxAge) return null;
    return fix;
  },
  watchPositionAsync: async (_options: unknown, callback: (location: unknown) => void) => {
    h.state.watchCallback = callback;
    return { remove: () => (h.state.watchCallback = null) };
  },
}));
vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (_type: string, listener: (state: string) => void) => {
      h.state.appStateListeners.add(listener);
      return { remove: () => h.state.appStateListeners.delete(listener) };
    },
  },
}));
vi.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: (key: string) => h.state.storage.get(key),
    set: (key: string, value: string) => h.state.storage.set(key, value),
    remove: (key: string) => h.state.storage.delete(key),
  }),
}));
vi.mock('@/src/providers/session-state', () => ({ useHasStoredSession: () => true }));

const fix = (latitude: number, ageMs = 0): Fix => ({
  coords: { latitude, longitude: 10, accuracy: 5, heading: -1 },
  timestamp: Date.now() - ageMs,
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function emitAppState(state: string) {
  h.state.appStateListeners.forEach((listener) => listener(state));
}

async function loadController() {
  vi.resetModules();
  const module = await import('../src/location/LocationSharingProvider');
  const controller = module.locationSharingControllerForTests;
  const detach = controller.attach();
  return { module, controller, detach };
}

let detach: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  h.state.session = { authUserId: 'auth-1' };
  h.state.current = null;
  h.state.lastKnown = null;
  h.state.watchCallback = null;
  h.state.permission = { granted: true, canAskAgain: true };
  h.state.requestResult = { granted: true, canAskAgain: true };
  h.state.log = [];
  h.state.share = null;
  h.state.stopSharing = null;
  h.state.appStateListeners.clear();
  h.state.storage.clear();
});

afterEach(() => {
  detach?.();
  detach = null;
  vi.useRealTimers();
});

describe('stop() and sends in flight', () => {
  it('waits for a share already on the wire before deleting the row', async () => {
    const loaded = await loadController();
    detach = loaded.detach;
    const share = deferred();
    h.state.share = () => share.promise;
    h.state.current = fix(1);

    const started = loaded.controller.start('g1', 3_600_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.log).toEqual(['share:start 1']);

    const stopped = loaded.controller.stop('user');
    await vi.advanceTimersByTimeAsync(100);
    expect(h.state.log).not.toContain('delete g1');

    share.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await expect(stopped).resolves.toBe(true);
    await started;
    expect(h.state.log).toEqual(['share:start 1', 'share:done 1', 'delete g1']);
    expect(loaded.controller.getSnapshot().status).toBe('off');
  });

  it('deletes the row again when a slow share lands after the delete', async () => {
    const loaded = await loadController();
    detach = loaded.detach;
    const share = deferred();
    h.state.share = () => share.promise;
    h.state.current = fix(1);

    void loaded.controller.start('g1', 3_600_000);
    await vi.advanceTimersByTimeAsync(0);
    const stopped = loaded.controller.stop('user');
    await vi.advanceTimersByTimeAsync(2_000); // past the in-flight wait
    await expect(stopped).resolves.toBe(true);
    expect(h.state.log).toEqual(['share:start 1', 'delete g1']);

    share.resolve(); // the share commits after the delete
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.log).toEqual(['share:start 1', 'delete g1', 'share:done 1', 'delete g1']);
  });

  it('does not delete again when the user started sharing with the same crew meanwhile', async () => {
    const loaded = await loadController();
    detach = loaded.detach;
    const share = deferred();
    h.state.share = () => share.promise;
    h.state.current = fix(1);

    void loaded.controller.start('g1', 3_600_000);
    await vi.advanceTimersByTimeAsync(0);
    void loaded.controller.stop('user');
    await vi.advanceTimersByTimeAsync(2_000);
    h.state.share = null;
    h.state.current = fix(2);
    await loaded.controller.start('g1', 3_600_000);
    share.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.log.filter((entry) => entry === 'delete g1')).toHaveLength(1);
  });

  it('reports false when the server delete fails or times out', async () => {
    const loaded = await loadController();
    detach = loaded.detach;
    h.state.current = fix(1);
    await loaded.controller.start('g1', 3_600_000);
    h.state.stopSharing = () => Promise.reject(Object.assign(new Error('offline'), { code: 'network' }));
    await expect(loaded.controller.stop('user')).resolves.toBe(false);

    await loaded.controller.start('g1', 3_600_000);
    h.state.stopSharing = () => new Promise(() => undefined);
    const stopped = loaded.controller.stop('user');
    await vi.advanceTimersByTimeAsync(3_100);
    await expect(stopped).resolves.toBe(false);

    await loaded.controller.start('g1', 3_600_000);
    h.state.stopSharing = null;
    await expect(loaded.controller.stop('user')).resolves.toBe(true);
  });
});

describe('heartbeat freshness', () => {
  it('never sends an old OS last-known fix as the current position', async () => {
    const loaded = await loadController();
    detach = loaded.detach;
    h.state.lastKnown = fix(99, 3 * 24 * 3_600_000); // three days old
    await loaded.controller.start('g1', 3_600_000);
    await vi.advanceTimersByTimeAsync(120_000); // first heartbeat, no fix from the watcher
    expect(h.state.log.filter((entry) => entry.startsWith('share'))).toEqual([]);
    expect(h.state.log).toContain('lastKnown maxAge=120000');
    expect(h.state.log).not.toContain('lastKnown maxAge=none');
  });

  it('sends a recent OS fix when the watcher has none yet', async () => {
    const loaded = await loadController();
    detach = loaded.detach;
    await loaded.controller.start('g1', 3_600_000);
    await vi.advanceTimersByTimeAsync(119_000);
    h.state.lastKnown = fix(7, 30_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.state.log).toContain('share:start 7');
  });

  it('does not re-send a fix from before the app went to the background', async () => {
    const loaded = await loadController();
    detach = loaded.detach;
    h.state.current = fix(10);
    await loaded.controller.start('g1', 8 * 3_600_000);
    expect(h.state.log).toEqual(['share:start 10', 'share:done 10', 'lastKnown maxAge=120000']);

    emitAppState('background');
    await vi.advanceTimersByTimeAsync(3 * 3_600_000 - 1);
    h.state.log = [];
    emitAppState('active');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.state.log.filter((entry) => entry.startsWith('share'))).toEqual([]);
    expect(loaded.controller.getSnapshot().status).toBe('sharing');

    h.state.watchCallback?.(fix(20));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.log).toContain('share:start 20');
  });
});

describe('expired "Allow Once" grant', () => {
  it('reports canAskAgain and resumes after requestAccess()', async () => {
    const loaded = await loadController();
    detach = loaded.detach;
    h.state.current = fix(1);
    await loaded.controller.start('g1', 3_600_000);

    emitAppState('background');
    h.state.permission = { granted: false, canAskAgain: true };
    emitAppState('active');
    await vi.advanceTimersByTimeAsync(0);
    expect(loaded.controller.getSnapshot()).toMatchObject({ status: 'permission_denied', canAskAgain: true });

    await expect(loaded.controller.requestAccess()).resolves.toBe(true);
    expect(h.state.log).toContain('prompt');
    expect(loaded.controller.getSnapshot()).toMatchObject({ status: 'sharing', canAskAgain: false });
  });

  it('offers only Settings when the prompt can no longer be shown', async () => {
    const loaded = await loadController();
    detach = loaded.detach;
    h.state.current = fix(1);
    await loaded.controller.start('g1', 3_600_000);
    emitAppState('background');
    h.state.permission = { granted: false, canAskAgain: false };
    emitAppState('active');
    await vi.advanceTimersByTimeAsync(0);
    expect(loaded.controller.getSnapshot()).toMatchObject({ status: 'permission_denied', canAskAgain: false });
  });
});
