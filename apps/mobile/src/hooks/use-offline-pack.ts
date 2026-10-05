import type { Festival } from '@festival/data-access';
import { getFestivalBounds } from '@festival/map-utils';
import Mapbox from '@rnmapbox/maps';
import { useCallback, useEffect, useRef, useState } from 'react';

export type OfflinePackState =
  | { kind: 'unavailable' }
  | { kind: 'checking' }
  | { kind: 'none' }
  | { kind: 'downloading'; percent: number }
  | { kind: 'complete' }
  | { kind: 'error'; message: string };

export const OFFLINE_MAP_STYLE = Mapbox.StyleURL.Street;
const MIN_ZOOM = 12;
const MAX_ZOOM = 17;

function packName(festivalId: string): string {
  return `festival-${festivalId}`;
}

function isComplete(state: number | string): boolean {
  return state === Mapbox.OfflinePackDownloadState.Complete;
}

function readVersion(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const version = (metadata as { version?: unknown }).version;
  return typeof version === 'number' ? version : typeof version === 'string' ? Number(version) : null;
}

/**
 * Offline map pack for a festival (§5.6): `getPack('festival-<id>')` first; status from
 * `pack.status()`; `createPack(options, onProgress, onError)` to download; a pack recorded for an older
 * `festival.version` is deleted and downloaded again.
 */
export function useOfflinePack(festival: Festival | null, enabled: boolean) {
  const [state, setState] = useState<OfflinePackState>({ kind: enabled && festival ? 'checking' : 'unavailable' });
  const nameRef = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const safeSet = useCallback((next: OfflinePackState) => {
    if (mounted.current) setState(next);
  }, []);

  const onProgress = useCallback(
    (_pack: unknown, status: { state: number; percentage: number }) => {
      if (isComplete(status.state) || status.percentage >= 100) {
        safeSet({ kind: 'complete' });
      } else {
        safeSet({ kind: 'downloading', percent: Math.max(0, Math.min(99, Math.round(status.percentage))) });
      }
    },
    [safeSet],
  );

  const onError = useCallback(
    (_pack: unknown, error: { message: string }) => {
      safeSet({ kind: 'error', message: error.message || "The offline map couldn't download." });
    },
    [safeSet],
  );

  const create = useCallback(async () => {
    if (!festival) return;
    const bounds = getFestivalBounds(festival);
    if (!bounds) {
      safeSet({ kind: 'unavailable' });
      return;
    }
    const name = packName(festival.id);
    safeSet({ kind: 'downloading', percent: 0 });
    try {
      await Mapbox.offlineManager.createPack(
        {
          name,
          styleURL: OFFLINE_MAP_STYLE,
          bounds: [bounds.ne, bounds.sw],
          minZoom: MIN_ZOOM,
          maxZoom: MAX_ZOOM,
          metadata: { festivalId: festival.id, version: festival.version },
        },
        onProgress,
        onError,
      );
    } catch (error) {
      safeSet({ kind: 'error', message: error instanceof Error ? error.message : "The offline map couldn't download." });
    }
  }, [festival, onError, onProgress, safeSet]);

  // Look up an existing pack; recreate it when the festival version changed.
  useEffect(() => {
    if (!enabled || !festival) {
      setState({ kind: 'unavailable' });
      return;
    }
    const name = packName(festival.id);
    nameRef.current = name;
    let cancelled = false;
    setState({ kind: 'checking' });
    void (async () => {
      try {
        const pack = await Mapbox.offlineManager.getPack(name);
        if (cancelled) return;
        if (!pack) {
          safeSet({ kind: 'none' });
          return;
        }
        const version = readVersion(pack.metadata);
        if (version !== festival.version) {
          await Mapbox.offlineManager.deletePack(name);
          if (!cancelled) await create();
          return;
        }
        const status = await pack.status();
        if (cancelled) return;
        if (isComplete(status.state) || status.percentage >= 100) {
          safeSet({ kind: 'complete' });
        } else {
          safeSet({ kind: 'downloading', percent: Math.round(status.percentage) });
          await Mapbox.offlineManager.subscribe(name, onProgress, onError);
          await pack.resume();
        }
      } catch (error) {
        if (!cancelled) {
          safeSet({ kind: 'error', message: error instanceof Error ? error.message : "Couldn't check the offline map." });
        }
      }
    })();
    return () => {
      cancelled = true;
      Mapbox.offlineManager.unsubscribe(name);
    };
    // festival.version is part of the identity: a new version re-runs the check.
  }, [create, enabled, festival, onError, onProgress, safeSet]);

  const remove = useCallback(async () => {
    if (!festival) return;
    try {
      await Mapbox.offlineManager.deletePack(packName(festival.id));
      safeSet({ kind: 'none' });
    } catch (error) {
      safeSet({ kind: 'error', message: error instanceof Error ? error.message : "Couldn't remove the offline map." });
    }
  }, [festival, safeSet]);

  return { state, download: create, remove };
}
