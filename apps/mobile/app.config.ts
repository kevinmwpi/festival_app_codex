/**
 * Dynamic Expo config. Everything static lives in `app.json`; this file only adds release guards.
 *
 * Store builds (EAS profiles `preview` and `production`) refuse to build without the public runtime
 * configuration the app needs to work and to pass App Review: Supabase (sign-in and data), the support
 * email and support page (shown in Settings), and the hosted privacy policy (linked from Settings and
 * the App Store listing). The values are `EXPO_PUBLIC_*`, i.e. embedded in the app binary — none of them
 * is secret. Set them as EAS environment variables (plain text or sensitive visibility, so the EAS CLI
 * can read them while resolving this config) for the matching EAS environment; see
 * docs/native-beta-release.md. Development builds and local runs never throw: the app shows its
 * configuration-error screen instead.
 */
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
  { names: ['EXPO_PUBLIC_SUPPORT_EMAIL'], check: isEmail, expectation: 'an email address' },
  { names: ['EXPO_PUBLIC_PRIVACY_POLICY_URL'], check: isHttpsUrl, expectation: 'an https URL' },
  { names: ['EXPO_PUBLIC_SUPPORT_URL'], check: isHttpsUrl, expectation: 'an https URL' },
];

function readEnv(name: string): string {
  return (process.env[name] ?? '').trim();
}

/** Human-readable problems with the release configuration; empty when everything is set. */
function releaseConfigProblems(): string[] {
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

export default ({ config }: ConfigContext): ExpoConfig => {
  const profile = process.env.EAS_BUILD_PROFILE;
  if (profile && RELEASE_PROFILES.has(profile)) {
    const problems = releaseConfigProblems();
    if (problems.length > 0) {
      throw new Error(
        `Festie "${profile}" builds need their public runtime configuration:\n` +
          problems.map((problem) => `  - ${problem}`).join('\n') +
          `\nSet these as EAS environment variables for the "${profile}" environment ` +
          '(see docs/native-beta-release.md).',
      );
    }
  }

  return {
    ...config,
    name: config.name ?? 'Festie',
    slug: config.slug ?? 'festival-app',
  };
};
