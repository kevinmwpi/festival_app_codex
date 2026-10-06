/**
 * Live location sharing (§5.6).
 *
 * - One sharing session at a time, persisted in MMKV (`{ groupId, startedAt, expiresAt, owner }`) so it
 *   survives restarts; a session recorded for another account is discarded.
 * - Foreground only: a `watchPositionAsync({ accuracy: Balanced, distanceInterval: 25 })` watcher runs
 *   while sharing, the permission is granted and the app is active. AppState `background` pauses it
 *   (`inactive` — Control Centre, the app switcher, a permission dialog — changes nothing); `active`
 *   resumes it. Nothing runs in the background and no background permission is ever requested.
 * - Heartbeat every 120 s while sharing re-sends the last fix of this foreground run (or the OS's last
 *   known position when it is at most 2 minutes old), so a stationary user stays visible; nothing is sent
 *   without a fresh fix, and a fix from before the app went to the background is never re-sent. Sends are
 *   throttled client-side to one per 15 s (the latest fix is sent when the window opens).
 * - Every `active` checks expiry first: an expired session is stopped on the server and cleared before
 *   anything resumes. A timer also stops it at `expiresAt` while the app is open.
 * - Stops on: the user, expiry, `not_group_member` (left/removed — the server already deleted the row),
 *   leaving the crew (`stopLocationSharingForGroup`), sign-out (`stopLocationSharingNow`) and a lost
 *   session (the provider watches the stored session and tears down locally as soon as it is gone).
 * - Status is truthful: `sharing` only while the watcher can run, `paused` in the background,
 *   `permission_denied` when location access or Location Services were turned off mid-session (or an
 *   iOS "Allow Once" grant expired — then `canAskAgain` is true and `requestAccess()` asks again).
 * - Stopping waits briefly for a position send already on the wire, then deletes the server row, so a
 *   late `share_location` cannot put the row back; a send that still lands after the delete triggers
 *   one more delete. `stop()` reports whether the server row is gone.
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
/** How long `stop()` waits for a position send already in flight before deleting the row. */
const IN_FLIGHT_WAIT_MS = 1_500;
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
  /**
   * With `permission_denied`: `true` when the OS can still show the permission prompt (e.g. an iOS
   * "Allow Once" grant expired), so `requestAccess()` can fix it; `false` when only Settings can.
   */
  canAskAgain: boolean;
}

export interface LocationSharingState extends LocationSharingSnapshot {
  /**
   * Starts sharing with `groupId` for `durationMs` (capped at 24 h), replacing any other session.
   * Asks for foreground location permission if needed.
   * @throws LocationPermissionError when access is denied or Location Services are off;
   *   `not_group_member` / auth errors from the first send.
   */
  start: (groupId: string, durationMs: number) => Promise<void>;
  /**
   * Stops sharing (user action). Sharing stops on this phone at once. Resolves `true` when the server
   * row is gone too, `false` when the delete could not be confirmed (offline, timeout) — the last
   * position then stays visible to the crew until it expires (at most 15 minutes). Never throws.
   */
  stop: () => Promise<boolean>;
  /**
   * After `permission_denied` with `canAskAgain`: shows the OS permission prompt and resumes sharing
   * when access is granted. Resolves whether sharing could resume. Never throws.
   */
  requestAccess: () => Promise<boolean>;
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

/** `true` when `promise` fulfils within `ms`; `false` when it rejects or takes longer. Never rejects. */
function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return withTimeout(
    promise.then(() => true),
    ms,
  ).then((value) => value === true);
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
  canAskAgain: false,
};

/* ─── Controller (module singleton) ─────────────────────── */

class LocationSharingController {
  private storage: MMKV | null = null;
  private loaded = false;
  private session: PersistedSession | null = null;
  private appActive = AppState.currentState !== 'background';
  private permissionDenied = false;
  private permissionCanAskAgain = false;

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
  /** `share_location` calls on the wire; each resolves (never rejects) once its request settles. */
  private inFlightShares = new Set<Promise<void>>();
  /** Sessions whose server row `stop()` deleted; a send of theirs that lands later is deleted again. */
  private deletedSessions = new WeakSet<PersistedSession>();
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
        canAskAgain: this.permissionDenied && this.permissionCanAskAgain,
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
        this.lastFix = null;
      }
    };
  }

  private handleAppState = (state: AppStateStatus): void => {
    if (state === 'background') {
      // Pause: nothing runs while Festie is not open (no background location).
      this.appActive = false;
      this.generation += 1;
      this.teardownRuntime();
      // A fix from before the pause no longer says where the user is; resume waits for a fresh one.
      this.lastFix = null;
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
      this.permissionCanAskAgain = access.canAskAgain;
      this.publish();
      return;
    }
    this.permissionDenied = false;
    this.permissionCanAskAgain = false;
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
        this.permissionCanAskAgain = false;
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
      // Only a recent OS fix stands in for the current position (the server stamps it "now"); with
      // none, nothing is sent and the crew sees the last real position age out.
      const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: MAX_LAST_KNOWN_AGE_MS }).catch(() => null);
      if (lastKnown && !this.lastFix && this.session && this.appActive) {
        this.lastFix = toCoords(lastKnown);
      }
    }
    // A heartbeat re-sends this foreground run's fix (the watcher only reports moves of 25 m or more)
    // so the server's 15-minute visibility window stays open for a stationary user.
    void this.send();
  }

  private async checkAccess(request: boolean): Promise<{ ok: true } | { ok: false; reason: 'permission' | 'services_disabled'; canAskAgain: boolean }> {
    try {
      // Location Services first: with them off system-wide, iOS reports every app's authorization as
      // denied, which would otherwise send the user to Festie's own Settings page instead.
      const servicesEnabled = await Location.hasServicesEnabledAsync().catch(() => true);
      if (!servicesEnabled) {
        return { ok: false, reason: 'services_disabled', canAskAgain: false };
      }
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted && request && permission.canAskAgain) {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (!permission.granted) {
        return { ok: false, reason: 'permission', canAskAgain: permission.canAskAgain };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'permission', canAskAgain: false };
    }
  }

  /**
   * `shareLocation` for `session`, tracked so `stop()` can wait for it. When it may have written the row
   * after `stop()` deleted it (and no newer session for that crew wants the row), the row is deleted
   * again.
   */
  private shareTracked(session: PersistedSession, fix: LocationCoords): Promise<void> {
    const request = shareLocation(session.groupId, fix);
    const settled = request.then(
      () => true,
      // A refused send wrote nothing; anything else (timeout, lost response) may have.
      (error: unknown) => !isAppErrorCode(error, 'not_group_member') && getErrorCode(error) !== 'session_missing',
    );
    const tracked = settled.then((mayHaveWritten) => {
      this.inFlightShares.delete(tracked);
      if (
        mayHaveWritten &&
        this.deletedSessions.has(session) &&
        this.session?.groupId !== session.groupId &&
        getStoredSession() !== null
      ) {
        void settlesWithin(stopSharingLocation(session.groupId), STOP_TIMEOUT_MS);
      }
    });
    this.inFlightShares.add(tracked);
    return request;
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
      await this.shareTracked(session, fix);
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
    this.permissionCanAskAgain = false;
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
        await this.shareTracked(session, this.lastFix);
        if (this.session !== session) {
          return;
        }
        this.lastAttemptAt = Date.now();
        this.lastSentAt = Date.now();
      } catch (error) {
        if (this.session !== session) {
          return;
        }
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
    this.permissionCanAskAgain = false;
    this.lastFix = null;
    this.lastSentAt = null;
    this.lastErrorAt = null;
    this.lastAttemptAt = 0;
    this.resendAfterFlight = false;
    this.persist();
    this.publish();
  }

  /**
   * Stops sharing: local teardown first (instant), then — after a position send already in flight has
   * landed (at most 1.5 s) — the server row, bounded by 3 s. Resolves `true` when the row is gone (or
   * there was none), `false` when the delete was not confirmed or could not be sent. Never throws.
   */
  stop = async (reason: StopReason = 'user'): Promise<boolean> => {
    this.ensureLoaded();
    const session = this.session;
    this.clearLocal();
    if (!session || reason === 'removed') {
      // Nothing was shared, or the server already deleted the row (left/removed).
      return true;
    }
    if (reason === 'session_lost' || getStoredSession() === null) {
      // Without a session the call cannot run; the row expires on its own.
      return false;
    }
    if (this.inFlightShares.size > 0) {
      // A share that reached the server after the delete would put the row back with a fresh timestamp.
      await withTimeout(Promise.all([...this.inFlightShares]), IN_FLIGHT_WAIT_MS);
    }
    if (getStoredSession() === null) {
      return false;
    }
    this.deletedSessions.add(session);
    return settlesWithin(stopSharingLocation(session.groupId), STOP_TIMEOUT_MS);
  };

  /** Asks for location access again after it lapsed mid-session, then resumes. Never throws. */
  requestAccess = async (): Promise<boolean> => {
    this.ensureLoaded();
    const session = this.session;
    if (!session) {
      return false;
    }
    const access = await this.checkAccess(true);
    if (this.session !== session) {
      return false;
    }
    if (!access.ok) {
      this.permissionDenied = true;
      this.permissionCanAskAgain = access.canAskAgain;
      this.publish();
      return false;
    }
    this.permissionDenied = false;
    this.permissionCanAskAgain = false;
    this.publish();
    await this.resume();
    return this.session === session && !this.permissionDenied;
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

/** @internal The singleton, for unit tests only (test/location-sharing.test.ts). */
export const locationSharingControllerForTests = controller;

/* ─── React bindings ────────────────────────────────────── */

const LocationSharingContext = createContext<LocationSharingState | null>(null);

function useControllerState(): LocationSharingState {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return useMemo(
    () => ({
      ...snapshot,
      start: controller.start,
      stop: () => controller.stop('user'),
      requestAccess: controller.requestAccess,
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

/** `{ status, groupId, expiresAt, …, start(groupId, durationMs), stop(), requestAccess() }` (§5.6). */
export function useLocationSharing(): LocationSharingState {
  const fromContext = useContext(LocationSharingContext);
  const direct = useControllerState();
  return fromContext ?? direct;
}

/**
 * Stops any active sharing immediately: watcher and timers stop and the persisted session is cleared
 * synchronously, then the server row is deleted (after an in-flight send lands; bounded by 4.5 s in
 * all). Idempotent; never throws; safe without a session or network. Used by `performSignOut`.
 */
export async function stopLocationSharingNow(): Promise<void> {
  await withTimeout(controller.stop('sign_out'), IN_FLIGHT_WAIT_MS + STOP_TIMEOUT_MS);
}

/** Stops sharing if it is with `groupId` (call before leaving a crew). Never throws. */
export async function stopLocationSharingForGroup(groupId: string): Promise<void> {
  await withTimeout(controller.stopForGroup(groupId, 'left'), IN_FLIGHT_WAIT_MS + STOP_TIMEOUT_MS);
}

/** Message for a `stop()` that resolved `false`: sharing stopped here, the server copy expires on its own. */
export const STOP_NOT_CONFIRMED_MESSAGE =
  "Couldn't reach the server. Sharing stopped on this phone; your last position expires within 15 minutes.";
