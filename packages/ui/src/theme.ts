/**
 * Festie Design System — Theme Tokens
 *
 * Adapted from the AI Studio visual language.
 * Single baby-blue theme for v1.
 */

export const colors = {
  /** Primary baby blue — buttons, active tab, accent */
  primary: '#B2CEFE',
  /** Darker primary for pressed states */
  primaryPressed: '#8FB8F8',

  /** Background tint for screens */
  background: '#F0F6FF',
  /** Card / surface white */
  surface: '#FFFFFF',

  /** Text colors */
  textPrimary: '#2C3327',
  textSecondary: 'rgba(44, 51, 39, 0.4)',
  textOnPrimary: '#FFFFFF',

  /** Borders & dividers */
  border: 'rgba(0, 0, 0, 0.05)',
  borderCard: 'rgba(0, 0, 0, 0.05)',

  /** Semantic */
  success: '#B2D8B2',
  warning: '#FFB3B3',
  warningBg: '#FFF5F5',
  info: '#B2CEFE',

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
  pill: 999,
} as const;

export const typography = {
  /** Serif italic for headings — maps to system serif on RN, custom font via expo-font later */
  heading: {
    fontFamily: undefined as string | undefined, // Set via expo-font: 'LibreBaskerville-Italic'
    fontStyle: 'italic' as const,
    fontWeight: '700' as const,
  },
  /** Sans-serif for body */
  body: {
    fontFamily: undefined as string | undefined, // Set via expo-font: 'Inter'
    fontWeight: '400' as const,
  },
  /** Bold sans for labels */
  label: {
    fontFamily: undefined as string | undefined,
    fontWeight: '800' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 2,
    fontSize: 10,
  },
  /** Display font for special text */
  display: {
    fontFamily: undefined as string | undefined, // Set via expo-font: 'SpaceGrotesk'
    fontWeight: '700' as const,
  },
} as const;
