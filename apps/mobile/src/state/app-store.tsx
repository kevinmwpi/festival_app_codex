import React, { createContext, useContext, useRef } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

export const DEFAULT_FESTIVAL_ID = '11111111-1111-4111-8111-111111111111';
/** Default accent matches Coachella pastel pink */
const DEFAULT_ACCENT = '#FFB3D9';

interface AppStoreState {
  activeFestivalId: string;
  /** The selected festival's accent_color — drives tab bar + screen tints */
  activeFestivalAccent: string;
  selectedGroupId: string | null;
  mapDownloaded: boolean;
  setActiveFestivalId: (festivalId: string) => void;
  setActiveFestivalAccent: (accent: string) => void;
  setSelectedGroupId: (groupId: string | null) => void;
  setMapDownloaded: (downloaded: boolean) => void;
}

type AppStore = StoreApi<AppStoreState>;

const AppStoreContext = createContext<AppStore | null>(null);

function createAppStore() {
  return createStore<AppStoreState>((set) => ({
    activeFestivalId: DEFAULT_FESTIVAL_ID,
    activeFestivalAccent: DEFAULT_ACCENT,
    selectedGroupId: null,
    mapDownloaded: false,
    setActiveFestivalId: (festivalId) => set({ activeFestivalId: festivalId }),
    setActiveFestivalAccent: (accent) => set({ activeFestivalAccent: accent }),
    setSelectedGroupId: (groupId) => set({ selectedGroupId: groupId }),
    setMapDownloaded: (downloaded) => set({ mapDownloaded: downloaded }),
  }));
}

export function AppStoreProvider({ children }: React.PropsWithChildren) {
  const storeRef = useRef<AppStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createAppStore();
  }

  return <AppStoreContext.Provider value={storeRef.current}>{children}</AppStoreContext.Provider>;
}

export function useAppStore<T>(selector: (state: AppStoreState) => T): T {
  const store = useContext(AppStoreContext);
  if (!store) {
    throw new Error('useAppStore must be used within AppStoreProvider.');
  }

  return useStore(store, selector);
}
