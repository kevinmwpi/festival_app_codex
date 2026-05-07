/**
 * Festie Design System — Theme Tokens
 *
 * Matches the AI Studio prototype palette exactly.
 * Primary = pastel blue #B2CEFE (global CTA).
 * Screen backgrounds and tab bar tint are driven per-festival
 * via deriveAccentColors(festival.accent_color).
 */

export const colors = {
  /** Pastel blue — global CTA buttons, active chips, add/check buttons */
  primary: '#B2CEFE',
  /** Darker pressed state */
  primaryPressed: '#8FB8F8',

  /** Default background (Coachella soft pink — overridden per festival at runtime) */
  background: '#FFF5F9',
  /** Card / surface white */
  surface: '#FFFFFF',

  /** Text — dark forest-green, matches reference #2C3327 */
  textPrimary: '#2C3327',
  textSecondary: 'rgba(44, 51, 39, 0.4)',
  textOnPrimary: '#2C3327',   // reference buttons use dark text on pastel bg
  textOnAccent: '#2C3327',

  /** Borders */
  border: 'rgba(0, 0, 0, 0.05)',
  borderCard: 'rgba(0, 0, 0, 0.05)',

  /** Semantic */
  success: '#B2D8B2',           // pastel green — attending / selected
  successBg: '#E8F5E8',
  warning: '#FDFD96',           // pastel yellow
  warningBg: '#FEFEE8',
  conflict: '#FFB3B3',          // pastel red
  conflictBg: '#FFF5F5',
  info: '#B2CEFE',

  /** Input bg tint */
  inputBg: '#F0F4FF',

  /** Shadows */
  shadow: 'rgba(0, 0, 0, 0.06)',

  /** Offline banner */
  offlineBg: '#ffd166',
  offlineText: '#2d1800',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const radii = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  /** 40px — the reference's dominant card radius */
  card: 40,
  pill: 999,
} as const;

/**
 * Typography tokens.
 * Georgia is the closest system serif italic to Libre Baskerville on iOS & Android.
 * Install @expo-google-fonts/libre-baskerville + inter + space-grotesk and swap
 * the fontFamily strings here for the exact reference fonts.
 */
export const typography = {
  heading: {
    fontFamily: 'Georgia' as string | undefined,
    fontStyle: 'italic' as const,
    fontWeight: '700' as const,
  },
  body: {
    fontFamily: undefined as string | undefined,
    fontWeight: '400' as const,
  },
  label: {
    fontFamily: undefined as string | undefined,
    fontWeight: '800' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 2,
    fontSize: 10,
  },
  display: {
    fontFamily: undefined as string | undefined,
    fontWeight: '700' as const,
  },
} as const;

/* ─── Festival accent utilities ─────────────────────────── */

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return [178, 206, 254]; // #B2CEFE fallback
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Derive soft tints from a festival's accent_color for festival-aware screens.
 *
 * bgTint  → very soft screen background (replaces global colors.background)
 * solid   → the accent hex itself (for tab bar, icon boxes, CTA buttons)
 * shadow  → drop shadow colour matching the accent
 */
export function deriveAccentColors(accentHex: string) {
  return {
    /** ~5% opacity screen background */
    bgTint: rgba(accentHex, 0.07),
    /** Card wash */
    surfaceTint: rgba(accentHex, 0.12),
    /** Active chip fill */
    chipBg: rgba(accentHex, 0.18),
    solid: accentHex,
    shadow: rgba(accentHex, 0.2),
    text: accentHex,
  };
}
