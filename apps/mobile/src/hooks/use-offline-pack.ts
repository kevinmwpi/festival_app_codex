import type { Festival } from '@festival/data-access';
import { getFestivalBounds } from '@festival/map-utils';
import Mapbox from '@rnmapbox/maps';
import { onlineManager } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export type OfflinePackState =
  | { kind: 'unavailable' }
  | { kind: 'checking' }
  | { kind: 'none' }
  | { kind: 'downloading'; percent: number }
  /** Part of the area is saved; the download continues once the device is back online. */
  | { kind: 'paused'; percent: number }
  /**
   * The festival area is saved. `updateAvailable`: the festival's map area changed since, and the pack
   * is replaced as soon as the device is online — until then the saved map stays usable.
   */
  | { kind: 'complete'; updateAvailable: boolean }
  | { kind: 'error'; message: string };

export const OFFLINE_MAP_STYLE = Mapbox.StyleURL.Street;
const MIN_ZOOM = 12;
const MAX_ZOOM = 17;

const DOWNLOAD_FAILED = "The offline map couldn't download. Check your connection and try again.";
const CHECK_FAILED = "Couldn't check the offline map.";
const REMOVE_FAILED = "Couldn't remove the offline map.";
/** Connectivity has to hold this long before a reconnect re-checks (and resumes) the pack. */
const ONLINE_SETTLE_MS = 2_000;

function packName(festivalId: string): string {
  return `festival-${festivalId}`;
}

interface PackStatus {
  state: number | string;
  percentage: number | null;
  requiredResourceCount?: number | null;
}

/**
 * A status describes a real tile region only when it has resources to load and a finite percentage.
 * A region the native side never created (the download failed before the tileset descriptors
 * resolved) reports 0/0 — `hasCompleted()` is true there and the percentage is NaN — or no progress at all.
 */
function isUsable(status: PackStatus): boolean {
  const required = status.requiredResourceCount;
  if (typeof required === 'number' && !(required > 0)) return false;
  return typeof status.percentage === 'number' && Number.isFinite(status.percentage);
}

function isComplete(status: PackStatus): boolean {
  if (!isUsable(status)) return false;
  return status.state === Mapbox.OfflinePackDownloadState.Complete || (status.percentage ?? 0) >= 100;
}

function clampPercent(percentage: number | null | undefined): number {
  if (typeof percentage !== 'number' || !Number.isFinite(percentage)) return 0;
  return Math.max(0, Math.min(99, Math.round(percentage)));
}

/*
 * Download events are routed through module-level listeners so the record of which native loads are
 * running survives the map screen unmounting or re-rendering. The hook only registers a handler for
 * its own pack.
 */
type PackEvent = { type: 'progress'; status: PackStatus } | { type: 'error' };

const packHandlers = new Map<string, (event: PackEvent) => void>();
/** Packs whose native load was started in this app session and hasn't completed or failed yet. */
const loadsInFlight = new Set<string>();

function onPackProgress(pack: { name?: string } | undefined, status: PackStatus & { name?: string }) {
  const name = status.name ?? pack?.name;
  if (!name) return;
  if (isComplete(status)) {
    loadsInFlight.delete(name);
  } else {
    loadsInFlight.add(name);
    if (status.state === Mapbox.OfflinePackDownloadState.Complete) {
      // The native side reports a 0/0 region as complete and the offline manager drops the listeners
      // right after this call; subscribe again so the rest of the download is still reported.
      setTimeout(() => void listenToPack(name), 0);
    }
  }
  packHandlers.get(name)?.({ type: 'progress', status });
}

function onPackError(pack: { name?: string } | undefined, error: { name?: string }) {
  const name = error.name ?? pack?.name;
  if (!name) return;
  loadsInFlight.delete(name);
  packHandlers.get(name)?.({ type: 'error' });
}

function listenToPack(name: string): Promise<void> {
  return Mapbox.offlineManager.subscribe(name, onPackProgress, onPackError);
}

function stopListeningToPack(name: string): void {
  loadsInFlight.delete(name);
  Mapbox.offlineManager.unsubscribe(name);
}

interface PackMetadata {
  version: number | null;
  regionKey: string | null;
}

function readMetadata(metadata: unknown): PackMetadata {
  if (!metadata || typeof metadata !== 'object') return { version: null, regionKey: null };
  const raw = metadata as { version?: unknown; regionKey?: unknown };
  const version =
    typeof raw.version === 'number' ? raw.version : typeof raw.version === 'string' && raw.version !== '' ? Number(raw.version) : null;
  return {
    version: version !== null && Number.isFinite(version) ? version : null,
    regionKey: typeof raw.regionKey === 'string' ? raw.regionKey : null,
  };
}

interface PackPlan {
  name: string;
  festivalId: string;
  version: number;
  /** Everything that decides which tiles the pack holds: style, zoom range and bounds. */
  regionKey: string;
  bounds: [[number, number], [number, number]];
}

function buildPlan(festival: Festival | null): PackPlan | null {
  if (!festival) return null;
  const bounds = getFestivalBounds(festival);
  if (!bounds) return null;
  const round = (value: number) => value.toFixed(5);
  const regionKey = [
    OFFLINE_MAP_STYLE,
    `${MIN_ZOOM}-${MAX_ZOOM}`,
    bounds.ne.map(round).join(','),
    bounds.sw.map(round).join(','),
  ].join('|');
  return {
    name: packName(festival.id),
    festivalId: festival.id,
    version: festival.version,
    regionKey,
    bounds: [
      [bounds.ne[0], bounds.ne[1]],
      [bounds.sw[0], bounds.sw[1]],
    ],
  };
}

/**
 * A saved pack is outdated when `festival.version` changed **and** the area it covers changed.
 * A version bump from a lineup re-seed leaves the same tiles, so the pack is kept rather than thrown
 * away and downloaded again. (Packs without a recorded region fall back to the version alone.)
 */
function isOutdated(metadata: PackMetadata, plan: PackPlan): boolean {
  if (metadata.version === plan.version) return false;
  return metadata.regionKey === null || metadata.regionKey !== plan.regionKey;
}

function subscribeOnline(listener: () => void): () => void {
  return onlineManager.subscribe(listener);
}

function isOnlineSnapshot(): boolean {
  return onlineManager.isOnline();
}

/**
 * Connectivity as the pack check sees it: a change only counts once it has held for
 * `ONLINE_SETTLE_MS`, so a flapping connection at a crowded site doesn't re-check and resume the
 * download on every flip.
 */
function useSettledOnline(): boolean {
  const isOnline = useSyncExternalStore(subscribeOnline, isOnlineSnapshot, isOnlineSnapshot);
  const [settled, setSettled] = useState(isOnline);
  useEffect(() => {
    if (isOnline === settled) return;
    const timer = setTimeout(() => setSettled(isOnline), ONLINE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [isOnline, settled]);
  return settled;
}

type NativePack = {
  metadata: unknown;
  status: () => Promise<PackStatus>;
  resume: () => Promise<void>;
  pause: () => Promise<void>;
};

/** Reads the pack's status; `null` when the native side has no tile region for it. */
async function readStatus(pack: NativePack): Promise<PackStatus | null> {
  try {
    return await pack.status();
  } catch {
    return null;
  }
}

/**
 * Offline map pack for a festival (§5.6): `getPack('festival-<id>')` first; status from
 * `pack.status()`; `createPack(options, onProgress, onError)` to download. When `festival.version`
 * changed and the festival's map area with it, the pack is deleted and recreated — but only while
 * online: offline, the saved (older) map stays and the replacement runs on reconnect. A pack whose
 * download failed before the tile region existed is replaced too, so "Try again" really retries.
 */
export function useOfflinePack(festival: Festival | null, enabled: boolean) {
  // Keyed by content so a re-read bundle (a new festival object, same pack) doesn't re-run the check.
  const nextPlan = buildPlan(enabled ? festival : null);
  const planKey = nextPlan ? `${nextPlan.name}|${nextPlan.version}|${nextPlan.regionKey}` : null;
  const planCache = useRef<{ key: string | null; plan: PackPlan | null }>({ key: null, plan: null });
  if (planCache.current.key !== planKey) {
    planCache.current = { key: planKey, plan: nextPlan };
  }
  const plan = planCache.current.plan;
  const isOnline = useSettledOnline();

  const [state, setState] = useState<OfflinePackState>({ kind: plan ? 'checking' : 'unavailable' });
  const stateRef = useRef(state);
  /** The pack the last check looked at. */
  const checkedNameRef = useRef<string | null>(null);
  const planRef = useRef(plan);
  planRef.current = plan;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Ignores updates after unmount or for a pack that is no longer this hook's. */
  const safeSet = useCallback((name: string | null, next: OfflinePackState) => {
    if (!mounted.current) return;
    if (name !== null && planRef.current?.name !== name) return;
    stateRef.current = next;
    setState(next);
  }, []);

  /** Percent to show for a load that is already running: keep what is on screen. */
  const currentPercent = useCallback(() => {
    const current = stateRef.current;
    return current.kind === 'downloading' || current.kind === 'paused' ? current.percent : 0;
  }, []);

  // Download events for this hook's pack. The native load keeps running (and keeps being tracked)
  // when the screen unmounts; only the handler goes.
  const planName = plan?.name ?? null;
  useEffect(() => {
    if (!planName) return;
    const handler = (event: PackEvent) => {
      if (event.type === 'error') {
        safeSet(planName, { kind: 'error', message: DOWNLOAD_FAILED });
      } else if (isComplete(event.status)) {
        safeSet(planName, { kind: 'complete', updateAvailable: false });
      } else {
        safeSet(planName, { kind: 'downloading', percent: clampPercent(event.status.percentage) });
      }
    };
    packHandlers.set(planName, handler);
    return () => {
      if (packHandlers.get(planName) === handler) packHandlers.delete(planName);
    };
  }, [planName, safeSet]);

  /** Fresh download. Callers make sure no pack with this name is registered. */
  const createFresh = useCallback(
    async (target: PackPlan) => {
      safeSet(target.name, { kind: 'downloading', percent: 0 });
      loadsInFlight.add(target.name);
      try {
        await Mapbox.offlineManager.createPack(
          {
            name: target.name,
            styleURL: OFFLINE_MAP_STYLE,
            bounds: target.bounds,
            minZoom: MIN_ZOOM,
            maxZoom: MAX_ZOOM,
            metadata: { festivalId: target.festivalId, version: target.version, regionKey: target.regionKey },
          },
          onPackProgress,
          onPackError,
        );
      } catch (error) {
        loadsInFlight.delete(target.name);
        throw error;
      }
    },
    [safeSet],
  );

  /** Deletes the registered pack (outdated, or never got a tile region) and downloads it afresh. */
  const replace = useCallback(
    async (target: PackPlan) => {
      stopListeningToPack(target.name);
      await Mapbox.offlineManager.deletePack(target.name);
      await createFresh(target);
    },
    [createFresh],
  );

  /** Continues an existing pack that covers the right area: resumes it, or replaces it when unusable. */
  const resumeExisting = useCallback(
    async (target: PackPlan, pack: NativePack) => {
      if (loadsInFlight.has(target.name)) {
        // A load started in this session is still running. Resuming would start a second native load
        // next to it (whose failures reach the listeners of the first), so just follow it.
        safeSet(target.name, { kind: 'downloading', percent: currentPercent() });
        await listenToPack(target.name);
        return;
      }
      const status = await readStatus(pack);
      if (status && isComplete(status)) {
        safeSet(target.name, { kind: 'complete', updateAvailable: false });
        return;
      }
      if (!status || !isUsable(status)) {
        await replace(target);
        return;
      }
      safeSet(target.name, { kind: 'downloading', percent: clampPercent(status.percentage) });
      await listenToPack(target.name);
      loadsInFlight.add(target.name);
      try {
        await pack.resume();
      } catch (error) {
        loadsInFlight.delete(target.name);
        throw error;
      }
    },
    [currentPercent, replace, safeSet],
  );

  /**
   * Download (or finish downloading) the festival area. Safe to call again after an error: a pack the
   * offline manager already knows is resumed when it covers the right area and has a tile region,
   * otherwise replaced — `createPack` alone would reject with "already exists".
   */
  const download = useCallback(async () => {
    const target = planRef.current;
    if (!target) return;
    if (!onlineManager.isOnline()) {
      safeSet(target.name, { kind: 'error', message: "You're offline. The map downloads once you're back online." });
      return;
    }
    try {
      const existing = await Mapbox.offlineManager.getPack(target.name);
      if (!existing) {
        await createFresh(target);
      } else if (isOutdated(readMetadata(existing.metadata), target)) {
        await replace(target);
      } else {
        await resumeExisting(target, existing);
      }
    } catch {
      safeSet(target.name, { kind: 'error', message: DOWNLOAD_FAILED });
    }
  }, [createFresh, replace, resumeExisting, safeSet]);

  // Look up the saved pack; replace an outdated one only while online. Re-runs on (settled) reconnect.
  useEffect(() => {
    if (!plan) {
      checkedNameRef.current = null;
      safeSet(null, { kind: 'unavailable' });
      return;
    }
    const { name } = plan;
    let cancelled = false;
    // Re-checks of the same pack (e.g. on reconnect) keep showing the current state instead of flashing.
    if (checkedNameRef.current !== name || stateRef.current.kind === 'unavailable') {
      checkedNameRef.current = name;
      safeSet(name, { kind: 'checking' });
    }
    void (async () => {
      let downloading = false;
      try {
        const pack = await Mapbox.offlineManager.getPack(name);
        if (cancelled) return;
        if (!pack) {
          safeSet(name, { kind: 'none' });
          return;
        }
        const outdated = isOutdated(readMetadata(pack.metadata), plan);
        if (outdated && isOnline) {
          downloading = true;
          await replace(plan);
          return;
        }
        if (!outdated && loadsInFlight.has(name)) {
          // A load from this session is still running: follow it rather than reading its status (a
          // region that is still being set up has none yet) or starting a second load.
          if (isOnline) {
            downloading = true;
            await resumeExisting(plan, pack);
          } else {
            safeSet(name, { kind: 'paused', percent: currentPercent() });
          }
          return;
        }
        const status = await readStatus(pack);
        if (cancelled) return;
        if (status && isComplete(status)) {
          safeSet(name, { kind: 'complete', updateAvailable: outdated });
        } else if (!isOnline) {
          // Keep whatever part is saved; the download resumes on reconnect (this effect re-runs).
          safeSet(name, { kind: 'paused', percent: status && isUsable(status) ? clampPercent(status.percentage) : 0 });
        } else {
          downloading = true;
          await resumeExisting(plan, pack);
        }
      } catch {
        if (!cancelled) {
          safeSet(name, { kind: 'error', message: downloading ? DOWNLOAD_FAILED : CHECK_FAILED });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentPercent, isOnline, plan, replace, resumeExisting, safeSet]);

  const remove = useCallback(async () => {
    const target = planRef.current;
    if (!target) return;
    try {
      stopListeningToPack(target.name);
      // getPack re-reads the native packs first, so a pack whose download failed is found and deleted too.
      const existing = await Mapbox.offlineManager.getPack(target.name);
      if (existing) {
        // Stop a running load first so it doesn't write the region back after the delete.
        await existing.pause().catch(() => undefined);
        await Mapbox.offlineManager.deletePack(target.name);
      }
      safeSet(target.name, { kind: 'none' });
    } catch {
      safeSet(target.name, { kind: 'error', message: REMOVE_FAILED });
    }
  }, [safeSet]);

  return { state, download, remove };
}
