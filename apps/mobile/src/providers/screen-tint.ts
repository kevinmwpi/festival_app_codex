import { deriveAccentColors } from '@festival/ui';

import { useAppStore } from '@/src/state/app-store';

/**
 * Screen wash for the active festival (the same `bgTint` the tabs use), so screens outside the tabs —
 * Settings — keep the festival's colour when pushed over them. Drawn over `colors.background`.
 */
export function useFestivalScreenTint(): string {
  const accent = useAppStore((state) => state.activeFestivalAccent);
  return deriveAccentColors(accent).bgTint;
}
