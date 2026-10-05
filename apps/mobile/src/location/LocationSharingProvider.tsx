/**
 * Live location sharing (§5.6).
 *
 * - One sharing session at a time, persisted in MMKV (`{ groupId, startedAt, expiresAt, owner }`) so it
 *   survives restarts; a session recorded for another account is discarded.
 * - Foreground only: a `watchPositionAsync({ accuracy: Balanced, distanceInterval: 25 })` watcher runs
 *   while sharing, the permission is granted and the app is active. AppState `background` pauses it
 *   (`inactive` — Control Centre, the app switcher, a permission dialog — changes nothing); `active`
 *   resumes it. Nothing runs in the background and no background permission is ever requested.
 * - Heartbeat every 120 s while sharing re-sends the last fix (or the OS's last known position), so a
 *   stationary user stays visible; sends are throttled client-side to one per 15 s (the latest fix is
 *   sent when the window opens).
 * - Every `active` checks expiry first: an expired session is stopped on the server and cleared before
 *   anything resumes. A timer also stops it at `expiresAt` while the app is open.
 * - Stops on: the user, expiry, `not_group_member` (left/removed — the server already deleted the row),
 *   leaving the crew (`stopLocationSharingForGroup`), sign-out (`stopLocationSharingNow`) and a lost
 *   session (the provider watches the stored session and tears down locally as soon as it is gone).
 * - Status is truthful: `sharing` only while the watcher can run, `paused` in the background,
 *   `permission_denied` when location access or Location Services were turned off mid-session.
 */
import {
  getErrorCode,
  getStoredSession,
  isAppErrorCode,
  requireStoredSession,
  shareLocation,
  stopSharingLocation,
  type LocationCoords,
} from '@festival/data-access';
import { showToast } from '@festival/ui';
import * as Location from 'expo-location';
import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { createMMKV, type MMKV } from 'react-native-mmkv';

import { useHasStoredSession } from '@/src/providers/session-state';

export type LocationSharingStatus = 'off' | 'sharing' | 'paused' | 'permission_denied';

/* ─── Durations ─────────────────────────────────────────── */

const HOUR_MS = 60 * 60 * 1000;

/** "Until I stop" still ends after 24 hours. */
export const MAX_SHARING_DURATION_MS = 24 * HOUR_MS;
export const DEFAULT_SHARING_DURATION_MS = 8 * HOUR_MS;

export interface SharingDurationOption {
  key: '1h' | '4h' | '8h' | 'until_stop';
  label: string;
  durationMs: number;
}

export const SHARING_DURATION_OPTIONS: readonly SharingDurationOption[] = [
  { key: '1h', label: '1 hour', durationMs: HOUR_MS },
  { key: '4h', label: '4 hours', durationMs: 4 * HOUR_MS },
  { key: '8h', label: '8 hours', durationMs: DEFAULT_SHARING_DURATION_MS },
  { key: 'until_stop', label: 'Until I stop', durationMs: MAX_SHARING_DURATION_MS },
];

const HEARTBEAT_MS = 120_000;
const THROTTLE_MS = 15_000;
const STOP_TIMEOUT_MS = 3_000;
/** A last-known fix older than this is not sent as the "current" position. */
const MAX_LAST_KNOWN_AGE_MS = 2 * 60_000;

/* ─── Errors ────────────────────────────────────────────── */

/** `start()` could not get location access. `canAskAgain === false` → only Settings can fix it. */
export class LocationPermissionError extends Error {
  readonly code = 'location_permission_denied';
  readonly canAskAgain: boolean;
  readonly reason: 'permission' | 'services_disabled';

  constructor(reason: 'permission' | 'services_disabled', canAskAgain: boolean) {
    super(
      reason === 'services_disabled'
        ? 'Location Services are turned off. Turn them on in Settings to share your location.'
        : 'Festie needs location access while the app is open to share your location.',
    );
    this.name = 'LocationPermissionError';
    this.reason = reason;
    this.canAskAgain = canAskAgain;
  }
}

/* ─── Public state ──────────────────────────────────────── */

export interface LocationSharingSnapshot {
  status: LocationSharingStatus;
  /** Crew the user is sharing with, or `null` when off. */
  groupId: string | null;
  /** Epoch ms when sharing started, or `null` when off. */
  startedAt: number | null;
  /** Epoch ms when sharing stops automatically, or `null` when off. */
  expiresAt: number | null;
  /** `true` when the user chose "Until I stop" (still capped at 24 h). */
  untilStopped: boolean;
  /** Epoch ms of the last position the server accepted in this app session, or `null`. */
  lastSentAt: number | null;
  /** Epoch ms of the last failed send (offline, timeout), cleared by the next success. */
  lastErrorAt: number | null;
}

export interface LocationSharingState extends LocationSharingSnapshot {
  /**
   * Starts sharing with `groupId` for `durationMs` (capped at 24 h), replacing any other session.
   * Asks for foreground location permission if needed.
   * @throws LocationPermissionError when access is denied or Location Services are off;
   *   `not_group_member` / auth errors from the first send.
   */
  start: (groupId: string, durationMs: number) => Promise<void>;
  /** Stops sharing (user action). Never throws. */
  stop: () => Promise<void>;
}

interface PersistedSession {
  v: 1;
  groupId: string;
  startedAt: number;
  expiresAt: number;
  untilStopped: boolean;
  /** Auth user id that started the session. */
  owner: string;
}

type StopReason = 'user' | 'expired' | 'removed' | 'left' | 'sign_out' | 'switch' | 'session_lost';

const STORAGE_ID = 'location-sharing';
const STORAGE_KEY = 'session';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

function toCoords(location: Location.LocationObject): LocationCoords {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy,
    heading: location.coords.heading,
  };
}

const OFF_SNAPSHOT: LocationSharingSnapshot = {
  status: 'off',
  groupId: null,
  startedAt: null,
  expiresAt: null,
  untilStopped: false,
  lastSentAt: null,
  lastErrorAt: null,
};

/* ─── Controller (module singleton) ─────────────────────── */

class LocationSharingController {
  private storage: MMKV | null = null;
  private loaded = false;
  private session: PersistedSession | null = null;
  private appActive = AppState.currentState !== 'background';
  private permissionDenied = false;

  private watcher: Location.LocationSubscription | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private trailingTimer: ReturnType<typeof setTimeout> | null = null;

  private lastFix: LocationCoords | null = null;
  private lastAttemptAt = 0;
  private lastSentAt: number | null = null;
  private lastErrorAt: number | null = null;
  private sending = false;
  private resendAfterFlight = false;
  /** Bumped on every start/stop/pause; async work from an older generation is discarded. */
  private generation = 0;

  private snapshot: LocationSharingSnapshot = OFF_SNAPSHOT;
  private listeners = new Set<() => void>();
  private attachCount = 0;
  private appStateSubscription: { remove: () => void } | null = null;

  /* Persistence */

  private getStorage(): MMKV | null {
    if (!this.storage) {
      try {
        this.storage = createMMKV({ id: STORAGE_ID });
      } catch {
        return null;
      }
    }
    return this.storage;
  }

  private ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    try {
      const raw = this.getStorage()?.getString(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<PersistedSession>;
      if (
        parsed.v === 1 &&
        typeof parsed.groupId === 'string' &&
        typeof parsed.startedAt === 'number' &&
        typeof parsed.expiresAt === 'number' &&
        typeof parsed.owner === 'string'
      ) {
        this.session = {
          v: 1,
          groupId: parsed.groupId,
          startedAt: parsed.startedAt,
          expiresAt: Math.min(parsed.expiresAt, parsed.startedAt + MAX_SHARING_DURATION_MS),
          untilStopped: parsed.untilStopped === true,
          owner: parsed.owner,
        };
      } else {
        this.getStorage()?.remove(STORAGE_KEY);
      }
    } catch {
      this.session = null;
    }
    // Silent: this can run inside `getSnapshot` during render, where notifying listeners is not allowed.
    this.publish(false);
  }

  private persist(): void {
    try {
      if (this.session) {
        this.getStorage()?.set(STORAGE_KEY, JSON.stringify(this.session));
      } else {
        this.getStorage()?.remove(STORAGE_KEY);
      }
    } catch {
      // Best effort: the in-memory session stays authoritative for this run.
    }
  }

  /* Store plumbing */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): LocationSharingSnapshot => {
    this.ensureLoaded();
    return this.snapshot;
  };

  private publish(notify = true): void {
    const session = this.session;
    let next: LocationSharingSnapshot;
    if (!session) {
      next = OFF_SNAPSHOT;
    } else {
      const status: LocationSharingStatus = this.permissionDenied ? 'permission_denied' : this.appActive ? 'sharing' : 'paused';
      next = {
        status,
        groupId: session.groupId,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
        untilStopped: session.untilStopped,
        lastSentAt: this.lastSentAt,
        lastErrorAt: this.lastErrorAt,
      };
    }
    const previous = this.snapshot;
    const changed = (Object.keys(next) as Array<keyof LocationSharingSnapshot>).some((key) => next[key] !== previous[key]);
    if (changed) {
      this.snapshot = next;
      if (notify) {
        this.listeners.forEach((listener) => listener());
      }
    }
  }

  /* Lifecycle (AppProviders mounts the provider once) */

  attach(): () => void {
    this.ensureLoaded();
    this.attachCount += 1;
    if (this.attachCount === 1) {
      this.appActive = AppState.currentState !== 'background';
      this.appStateSubscription = AppState.addEventListener('change', this.handleAppState);
      if (this.appActive) {
        void this.resume();
      } else {
        this.publish();
      }
    }
    return () => {
      this.attachCount -= 1;
      if (this.attachCount === 0) {
        this.appStateSubscription?.remove();
        this.appStateSubscription = null;
        this.teardownRuntime();
      }
    };
  }

  private handleAppState = (state: AppStateStatus): void => {
    if (state === 'background') {
      // Pause: nothing runs while Festie is not open (no background location).
      this.appActive = false;
      this.generation += 1;
      this.teardownRuntime();
      this.publish();
    } else if (state === 'active') {
      this.appActive = true;
      this.publish();
      void this.resume();
    }
    // 'inactive' changes nothing.
  };

  /* Runtime: watcher, heartbeat, expiry */

  private teardownRuntime(): void {
    this.watcher?.remove();
    this.watcher = null;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    if (this.trailingTimer) {
      clearTimeout(this.trailingTimer);
      this.trailingTimer = null;
    }
  }

  private sessionBelongsToCurrentUser(session: PersistedSession): boolean {
    const stored = getStoredSession();
    return stored !== null && stored.authUserId === session.owner;
  }

  /** (Re)starts the watcher, heartbeat and expiry timer when a session exists and the app is active. */
  private async resume(): Promise<void> {
    this.ensureLoaded();
    const session = this.session;
    if (!session || !this.appActive) {
      return;
    }
    if (!this.sessionBelongsToCurrentUser(session)) {
      this.clearLocal();
      return;
    }
    if (Date.now() >= session.expiresAt) {
      await this.stop('expired');
      return;
    }

    const generation = ++this.generation;
    this.teardownRuntime();
    // Armed before the access check so an expired session ends even while access is denied.
    this.scheduleExpiry(session);

    const access = await this.checkAccess(false);
    if (generation !== this.generation || this.session !== session) {
      return;
    }
    if (!access.ok) {
      this.permissionDenied = true;
      this.publish();
      return;
    }
    this.permissionDenied = false;
    this.publish();

    this.heartbeatTimer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);

    try {
      const subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 25 },
        (location) => {
          if (generation !== this.generation) {
            return;
          }
          this.lastFix = toCoords(location);
          void this.send();
        },
      );
      if (generation !== this.generation || this.session !== session || !this.appActive) {
        subscription.remove();
        return;
      }
      this.watcher = subscription;
    } catch {
      // Location became unavailable between the check and the watch (e.g. services switched off).
      if (generation === this.generation) {
        this.permissionDenied = true;
        this.publish();
      }
      return;
    }

    // Send something right away when the OS has a recent fix; the watcher delivers a fresh one shortly.
    const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: MAX_LAST_KNOWN_AGE_MS }).catch(() => null);
    if (generation === this.generation && lastKnown && !this.lastFix) {
      this.lastFix = toCoords(lastKnown);
      void this.send();
    }
  }

  private scheduleExpiry(session: PersistedSession): void {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
    }
    const delay = Math.max(0, session.expiresAt - Date.now());
    this.expiryTimer = setTimeout(() => {
      if (this.session === session) {
        void this.stop('expired').then(() => showToast('Location sharing ended.'));
      }
    }, delay);
  }

  private async heartbeat(): Promise<void> {
    if (!this.session || !this.appActive || this.permissionDenied) {
      return;
    }
    if (Date.now() >= this.session.expiresAt) {
      await this.stop('expired');
      showToast('Location sharing ended.');
      return;
    }
    if (!this.lastFix) {
      const lastKnown = await Location.getLastKnownPositionAsync().catch(() => null);
      if (lastKnown) {
        this.lastFix = toCoords(lastKnown);
      }
    }
    // A heartbeat re-sends the same fix so the server's 15-minute visibility window stays open.
    void this.send();
  }

  private async checkAccess(request: boolean): Promise<{ ok: true } | { ok: false; reason: 'permission' | 'services_disabled'; canAskAgain: boolean }> {
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted && request && permission.canAskAgain) {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (!permission.granted) {
        return { ok: false, reason: 'permission', canAskAgain: permission.canAskAgain };
      }
      const servicesEnabled = await Location.hasServicesEnabledAsync().catch(() => true);
      if (!servicesEnabled) {
        return { ok: false, reason: 'services_disabled', canAskAgain: false };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'permission', canAskAgain: false };
    }
  }

  /** Sends the latest fix, respecting the 15 s client throttle. Resolves `true` when the server accepted it. */
  private async send(): Promise<boolean> {
    const session = this.session;
    const fix = this.lastFix;
    if (!session || !fix || !this.appActive || this.permissionDenied) {
      return false;
    }
    if (this.sending) {
      this.resendAfterFlight = true;
      return false;
    }
    const wait = this.lastAttemptAt + THROTTLE_MS - Date.now();
    if (wait > 0) {
      if (!this.trailingTimer) {
        this.trailingTimer = setTimeout(() => {
          this.trailingTimer = null;
          void this.send();
        }, wait);
      }
      return false;
    }
    if (!this.sessionBelongsToCurrentUser(session)) {
      this.clearLocal();
      return false;
    }

    const generation = this.generation;
    this.sending = true;
    this.lastAttemptAt = Date.now();
    try {
      await shareLocation(session.groupId, fix);
      if (this.session === session) {
        this.lastSentAt = Date.now();
        this.lastErrorAt = null;
        this.publish();
      }
      return true;
    } catch (error) {
      if (this.session !== session) {
        return false;
      }
      if (isAppErrorCode(error, 'not_group_member')) {
        // Left or removed: the server already deleted the row (and data-access purged the crew).
        await this.stop('removed');
        showToast("You're no longer in that crew, so location sharing stopped.");
      } else if (getErrorCode(error) === 'session_missing' || getStoredSession() === null) {
        this.clearLocal();
      } else {
        this.lastErrorAt = Date.now();
        this.publish();
      }
      return false;
    } finally {
      this.sending = false;
      if (this.resendAfterFlight && generation === this.generation) {
        this.resendAfterFlight = false;
        void this.send();
      }
    }
  }

  /* Commands */

  start = async (groupId: string, durationMs: number): Promise<void> => {
    this.ensureLoaded();
    const stored = requireStoredSession();

    const access = await this.checkAccess(true);
    if (!access.ok) {
      throw new LocationPermissionError(access.reason, access.canAskAgain);
    }

    if (this.session && this.session.groupId !== groupId) {
      await this.stop('switch');
    }

    const now = Date.now();
    const untilStopped = durationMs >= MAX_SHARING_DURATION_MS;
    const duration = Math.min(Math.max(durationMs, 60_000), MAX_SHARING_DURATION_MS);
    this.session = { v: 1, groupId, startedAt: now, expiresAt: now + duration, untilStopped, owner: stored.authUserId };
    this.permissionDenied = false;
    this.lastSentAt = null;
    this.lastErrorAt = null;
    this.lastFix = null;
    this.lastAttemptAt = 0;
    this.persist();
    this.publish();

    const session = this.session;
    // Send the current position now so a membership problem surfaces immediately.
    const current = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 10_000);
    if (this.session !== session) {
      return;
    }
    if (current) {
      this.lastFix = toCoords(current);
      try {
        await shareLocation(groupId, this.lastFix);
        this.lastAttemptAt = Date.now();
        this.lastSentAt = Date.now();
      } catch (error) {
        if (isAppErrorCode(error, 'not_group_member') || getErrorCode(error) === 'session_missing') {
          await this.stop(isAppErrorCode(error, 'not_group_member') ? 'removed' : 'session_lost');
          throw error;
        }
        // Offline or a timeout: keep sharing; the watcher and heartbeat retry.
        this.lastErrorAt = Date.now();
      }
      this.publish();
    }

    await this.resume();
  };

  /** Local teardown only (no server call). */
  private clearLocal(): void {
    this.generation += 1;
    this.teardownRuntime();
    this.session = null;
    this.permissionDenied = false;
    this.lastFix = null;
    this.lastSentAt = null;
    this.lastErrorAt = null;
    this.lastAttemptAt = 0;
    this.resendAfterFlight = false;
    this.persist();
    this.publish();
  }

  /** Stops sharing: local teardown first (instant), then the server row, bounded by 3 s. Never throws. */
  stop = async (reason: StopReason = 'user'): Promise<void> => {
    this.ensureLoaded();
    const groupId = this.session?.groupId ?? null;
    this.clearLocal();
    // After `removed`/`left` the server already deleted the row; without a session the call cannot run.
    if (!groupId || reason === 'removed' || reason === 'session_lost' || getStoredSession() === null) {
      return;
    }
    await withTimeout(stopSharingLocation(groupId), STOP_TIMEOUT_MS);
  };

  /**
   * Local teardown when the stored session is gone or belongs to someone else (a lost session signs out
   * without `stopLocationSharingNow`). No server call: without a session it could not run.
   */
  clearLocalIfSessionGone = (): void => {
    this.ensureLoaded();
    if (this.session && !this.sessionBelongsToCurrentUser(this.session)) {
      this.clearLocal();
    }
  };

  /** Stops only when sharing with `groupId` (e.g. before leaving that crew). */
  stopForGroup = async (groupId: string, reason: StopReason = 'left'): Promise<void> => {
    this.ensureLoaded();
    if (this.session?.groupId === groupId) {
      await this.stop(reason);
    }
  };
}

const controller = new LocationSharingController();

/* ─── React bindings ────────────────────────────────────── */

const LocationSharingContext = createContext<LocationSharingState | null>(null);

function useControllerState(): LocationSharingState {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return useMemo(
    () => ({
      ...snapshot,
      start: controller.start,
      stop: () => controller.stop('user'),
    }),
    [snapshot],
  );
}

/** Mounted once by `AppProviders`: owns the AppState wiring and resumes a persisted session. */
export function LocationSharingProvider({ children }: React.PropsWithChildren) {
  useEffect(() => controller.attach(), []);
  // Stop the watcher the moment the session disappears, not at the next fix or heartbeat.
  const hasSession = useHasStoredSession();
  useEffect(() => {
    if (!hasSession) controller.clearLocalIfSessionGone();
  }, [hasSession]);
  const value = useControllerState();
  return <LocationSharingContext.Provider value={value}>{children}</LocationSharingContext.Provider>;
}

/** `{ status, groupId, expiresAt, …, start(groupId, durationMs), stop() }` (§5.6). */
export function useLocationSharing(): LocationSharingState {
  const fromContext = useContext(LocationSharingContext);
  const direct = useControllerState();
  return fromContext ?? direct;
}

/**
 * Stops any active sharing immediately: watcher and timers stop and the persisted session is cleared
 * synchronously, then the server row is deleted (bounded by 3 s). Idempotent; never throws; safe
 * without a session or network. Used by `performSignOut`.
 */
export async function stopLocationSharingNow(): Promise<void> {
  await withTimeout(controller.stop('sign_out'), STOP_TIMEOUT_MS);
}

/** Stops sharing if it is with `groupId` (call before leaving a crew). Never throws. */
export async function stopLocationSharingForGroup(groupId: string): Promise<void> {
  await withTimeout(controller.stopForGroup(groupId, 'left'), STOP_TIMEOUT_MS);
}
