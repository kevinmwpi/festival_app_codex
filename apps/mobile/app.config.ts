/**
 * Dynamic Expo config. Everything static lives in `app.json`; this file only adds release guards.
 *
 * Store builds (EAS profiles `preview` and `production`) refuse to build without the public runtime
 * configuration the app needs to work and to pass App Review: Supabase (sign-in and data), the Mapbox
 * public token (the Map tab and meetup pins — without it the Map tab shows its fallback, an incomplete
 * feature under guideline 2.1), the support email and support page (shown in Settings), and the hosted
 * privacy policy (linked from Settings and the App Store listing). The values are `EXPO_PUBLIC_*`, i.e. embedded in the app binary — none of them
 * is secret. Set them as EAS environment variables (plain text or sensitive visibility, so the EAS CLI
 * can read them while resolving this config) for the matching EAS environment; see
 * docs/release-runbook.md §5.1. Development builds and local runs never throw: the app shows its
 * configuration-error screen instead.
 *
 * The same builds also refuse to ship what App Review rejects outright (guidelines 2.1, 2.3.8, 5.1.1):
 * the create-expo-app template icon or splash artwork, an app icon that is not a 1024×1024 PNG without
 * alpha, and in-app Terms of Use / Privacy Policy screens that still contain `__PLACEHOLDER__` tokens
 * (fill docs/legal/values.json and run `node docs/legal/generate.mjs --release`, runbook §4).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

const RELEASE_PROFILES = new Set(['preview', 'production']);

type Check = (value: string) => boolean;

const isHttpsUrl: Check = (value) => /^https:\/\/[^\s/?#@:]+\.[^\s/?#@:]+(?::\d+)?(?:[/?#]\S*)?$/i.test(value);
const isEmail: Check = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isPresent: Check = (value) => value.length > 0;

interface Requirement {
  /** Variable names; the first one that is set is used (aliases). */
  names: string[];
  check: Check;
  expectation: string;
}

const RELEASE_REQUIREMENTS: Requirement[] = [
  { names: ['EXPO_PUBLIC_SUPABASE_URL'], check: isHttpsUrl, expectation: 'an https URL' },
  {
    names: ['EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_KEY'],
    check: isPresent,
    expectation: 'the Supabase anon (publishable) key',
  },
  {
    names: ['EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN'],
    // Same rule as src/config/app-info.ts: only a public `pk.` token enables the map.
    check: (value) => value.startsWith('pk.'),
    expectation: 'a Mapbox public token (pk.…)',
  },
  { names: ['EXPO_PUBLIC_SUPPORT_EMAIL'], check: isEmail, expectation: 'an email address' },
  { names: ['EXPO_PUBLIC_PRIVACY_POLICY_URL'], check: isHttpsUrl, expectation: 'an https URL' },
  { names: ['EXPO_PUBLIC_SUPPORT_URL'], check: isHttpsUrl, expectation: 'an https URL' },
];

/** MD5 of the create-expo-app template images (SDK 52–55), keyed by their path in this project. */
export const TEMPLATE_ARTWORK_MD5: Readonly<Record<string, string>> = {
  'assets/images/icon.png': 'cb975bba2216ce10a60e6c0ffe9941a2',
  'assets/images/splash-icon.png': '97dae5a0e62ad8551d8a31897b425e63',
  'assets/images/android-icon-foreground.png': '72e71a9c846c6aa4ae32476641a00e18',
  'assets/images/android-icon-background.png': '2d65569cc0e2afdcea0af9f9902d4173',
  'assets/images/android-icon-monochrome.png': '1e097dab989759fc0b69440092ca22cd',
  'assets/images/favicon.png': 'd9f444efbdfbe7931aa93beada07318a',
};

/** Bundled legal screens generated from docs/legal/*.md (docs/legal/generate.mjs). */
export const BUNDLED_LEGAL_SCREENS = ['app/legal/terms-of-use.tsx', 'app/legal/privacy-policy.tsx'] as const;

/** Same token syntax as docs/legal/generate.mjs. */
const PLACEHOLDER = /__[A-Z][A-Z0-9_]*__/g;
/** A template variable filled at runtime from EXPO_PUBLIC_SUPPORT_EMAIL, not a placeholder. */
const RUNTIME_TOKENS = new Set(['__SUPPORT_EMAIL__']);

const PNG_SIGNATURE = '89504e470d0a1a0a';

function readEnv(name: string): string {
  return (process.env[name] ?? '').trim();
}

/** Human-readable problems with the release configuration; empty when everything is set. */
export function releaseConfigProblems(): string[] {
  const problems: string[] = [];
  for (const requirement of RELEASE_REQUIREMENTS) {
    const label = requirement.names.join(' (or ') + (requirement.names.length > 1 ? ')' : '');
    const name = requirement.names.find((candidate) => readEnv(candidate).length > 0);
    if (!name) {
      problems.push(`${label} is not set`);
    } else if (!requirement.check(readEnv(name))) {
      problems.push(`${name} must be ${requirement.expectation}`);
    }
  }
  return problems;
}

/** Whether an ancillary chunk of `type` appears before the image data (where tRNS must be). */
function pngHasChunkBeforeImageData(png: Uint8Array, type: string): boolean {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = view.getUint32(offset);
    const chunk = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    if (chunk === type) return true;
    if (chunk === 'IDAT' || chunk === 'IEND') return false;
    offset += 12 + length;
  }
  return false;
}

/** Template artwork still in place, and an App Store icon that is not a 1024×1024 PNG without alpha. */
export function releaseArtworkProblems(
  projectRoot: string,
  iconPath = 'assets/images/icon.png',
  templates: Readonly<Record<string, string>> = TEMPLATE_ARTWORK_MD5,
): string[] {
  const problems: string[] = [];
  for (const [path, templateHash] of Object.entries(templates)) {
    const file = join(projectRoot, path);
    if (existsSync(file) && createHash('md5').update(readFileSync(file)).digest('hex') === templateHash) {
      problems.push(`${path} is still the Expo template artwork; replace it with Festie artwork`);
    }
  }

  const iconFile = join(projectRoot, iconPath.replace(/^\.\//, ''));
  if (!existsSync(iconFile)) {
    problems.push(`${iconPath} (the app icon) does not exist`);
    return problems;
  }
  const png = readFileSync(iconFile);
  // IHDR is always the first chunk: width (16–19), height (20–23), colour type (25).
  if (png.length < 33 || png.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) {
    problems.push(`${iconPath} must be a PNG`);
    return problems;
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const colourType = png[25];
  if (width !== 1024 || height !== 1024) {
    problems.push(`${iconPath} must be 1024×1024 (it is ${width}×${height})`);
  }
  // 4 = grey + alpha, 6 = RGBA; a tRNS chunk adds transparency to the other types.
  if (colourType === 4 || colourType === 6 || pngHasChunkBeforeImageData(png, 'tRNS')) {
    problems.push(`${iconPath} must not have an alpha channel (App Store icons are opaque)`);
  }
  return problems;
}

/** `__PLACEHOLDER__` tokens left in the bundled legal screens (the runtime support-email token excepted). */
export function legalPlaceholderProblems(projectRoot: string): string[] {
  const problems: string[] = [];
  for (const path of BUNDLED_LEGAL_SCREENS) {
    const file = join(projectRoot, path);
    if (!existsSync(file)) {
      problems.push(`${path} is missing; run node docs/legal/generate.mjs`);
      continue;
    }
    const tokens = [...new Set(readFileSync(file, 'utf8').match(PLACEHOLDER) ?? [])].filter((token) => !RUNTIME_TOKENS.has(token));
    if (tokens.length > 0) {
      problems.push(`${path} still contains ${tokens.sort().join(', ')}`);
    }
  }
  return problems;
}

export default ({ config, projectRoot }: ConfigContext): ExpoConfig => {
  const profile = process.env.EAS_BUILD_PROFILE;
  if (profile && RELEASE_PROFILES.has(profile)) {
    const configProblems = releaseConfigProblems();
    const contentProblems = [
      ...releaseArtworkProblems(projectRoot, config.icon ?? undefined),
      ...legalPlaceholderProblems(projectRoot),
    ];
    if (configProblems.length > 0 || contentProblems.length > 0) {
      const sections: string[] = [];
      if (configProblems.length > 0) {
        sections.push(
          `Festie "${profile}" builds need their public runtime configuration:\n` +
            configProblems.map((problem) => `  - ${problem}`).join('\n') +
            `\nSet these as EAS environment variables for the "${profile}" environment ` +
            '(see docs/release-runbook.md §5.1).',
        );
      }
      if (contentProblems.length > 0) {
        sections.push(
          `Festie "${profile}" builds can't ship placeholder content App Review rejects:\n` +
            contentProblems.map((problem) => `  - ${problem}`).join('\n') +
            '\nFill docs/legal/values.json and run `node docs/legal/generate.mjs --release` (docs/release-runbook.md §4), ' +
            'and replace any template artwork in apps/mobile/assets/images/.',
        );
      }
      throw new Error(sections.join('\n\n'));
    }
  }

  return {
    ...config,
    name: config.name ?? 'Festie',
    slug: config.slug ?? 'festival-app',
  };
};
