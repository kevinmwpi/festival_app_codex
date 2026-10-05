/**
 * App-wide constants and build-time configuration.
 *
 * `EXPO_PUBLIC_*` variables are inlined by Metro at build time, so each one must be read as a
 * literal `process.env.EXPO_PUBLIC_…` expression (no dynamic lookups). Optional values resolve to
 * `null` when unset or malformed; the UI then falls back (e.g. to the in-app legal screens).
 * `app.config.ts` makes preview/production builds fail when the release-required values are unset.
 */
import * as Application from 'expo-application';
import Constants from 'expo-constants';

/** Digits in the email sign-in code (matches Supabase `[auth.email] otp_length`). */
export const OTP_LENGTH = 8;

/** Custom URL scheme registered in app.json (`scheme`). */
export const DEEP_LINK_SCHEME = 'festivalapp';

/** Public App Store listing, used in invite share text. */
export const APP_STORE_URL = 'https://apps.apple.com/app/id6761392490';

function readText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * https URL with a dotted host. A regex rather than `new URL()`: React Native's URL polyfill does
 * not validate its input.
 */
const HTTPS_URL_PATTERN = /^https:\/\/[^\s/?#@:]+\.[^\s/?#@:]+(?::\d+)?(?:[/?#]\S*)?$/i;

function readHttpsUrl(value: string | undefined): string | null {
  const text = readText(value);
  return text && HTTPS_URL_PATTERN.test(text) ? text : null;
}

function readEmail(value: string | undefined): string | null {
  const text = readText(value);
  return text && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : null;
}

/* ─── Mapbox ────────────────────────────────────────────── */

/** Mapbox public access token (`pk.…`), or `null` when unset. Secret `sk.` tokens are rejected. */
export const MAPBOX_ACCESS_TOKEN: string | null = (() => {
  const token = readText(process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN);
  return token && token.startsWith('pk.') ? token : null;
})();

/** True when the map can render; otherwise screens show the non-map fallback card. */
export function isMapboxConfigured(): boolean {
  return MAPBOX_ACCESS_TOKEN !== null;
}

/* ─── Support & legal ───────────────────────────────────── */

/** Support mailbox for `mailto:` links, or `null` when unset. */
export const SUPPORT_EMAIL: string | null = readEmail(process.env.EXPO_PUBLIC_SUPPORT_EMAIL);

/** Public support page (https), or `null` when unset. */
export const SUPPORT_URL: string | null = readHttpsUrl(process.env.EXPO_PUBLIC_SUPPORT_URL);

/** Hosted privacy policy (https), or `null` → use the in-app `/legal/privacy-policy` screen. */
export const PRIVACY_POLICY_URL: string | null = readHttpsUrl(process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL);

/** Hosted terms of use (https), or `null` → use the in-app `/legal/terms-of-use` screen. */
export const TERMS_URL: string | null = readHttpsUrl(process.env.EXPO_PUBLIC_TERMS_URL);

/* ─── Version ───────────────────────────────────────────── */

/** Marketing version, e.g. "1.0.0" (native value; app config as a fallback in dev). */
export const APP_VERSION: string =
  Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0';

/** Native build number (CFBundleVersion / versionCode), or `null` when unknown (e.g. web). */
export const APP_BUILD: string | null = Application.nativeBuildVersion ?? null;

/** "1.0.0 (12)" for the About screen. */
export const APP_VERSION_LABEL: string = APP_BUILD ? `${APP_VERSION} (${APP_BUILD})` : APP_VERSION;

/* ─── Invites (§5.4) ────────────────────────────────────── */

/** `festivalapp://group/join?code=ABC123` */
export function buildInviteDeepLink(inviteCode: string): string {
  return `${DEEP_LINK_SCHEME}://group/join?code=${encodeURIComponent(inviteCode)}`;
}

/** Share-sheet text for a new crew, exactly as specified in §5.4. */
export function buildInviteShareMessage(groupName: string, inviteCode: string): string {
  return `Join my crew "${groupName}" on Festie. Code: ${inviteCode} — open ${buildInviteDeepLink(inviteCode)} — get the app: ${APP_STORE_URL}`;
}
