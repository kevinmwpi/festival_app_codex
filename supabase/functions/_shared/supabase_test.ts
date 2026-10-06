import { assertEquals, assertThrows } from '@std/assert';

import { createServiceClient, resolveServiceKey } from './supabase.ts';

function envOf(vars: Record<string, string>): (name: string) => string | undefined {
  return (name) => vars[name];
}

Deno.test('resolveServiceKey prefers the default entry of SUPABASE_SECRET_KEYS', () => {
  const env = envOf({
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_new', other: 'sb_secret_other' }),
    SUPABASE_SERVICE_ROLE_KEY: 'legacy.jwt.value',
  });
  assertEquals(resolveServiceKey(env), 'sb_secret_new');
});

Deno.test('resolveServiceKey works when only the new secret keys are injected (legacy keys disabled)', () => {
  const env = envOf({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_only"}' });
  assertEquals(resolveServiceKey(env), 'sb_secret_only');
});

Deno.test('resolveServiceKey falls back to the legacy SUPABASE_SERVICE_ROLE_KEY', () => {
  assertEquals(resolveServiceKey(envOf({ SUPABASE_SERVICE_ROLE_KEY: 'legacy.jwt.value' })), 'legacy.jwt.value');
  // Present but unusable secret-key maps fall back too.
  const unusable = ['', 'not json', '[]', 'null', '{}', '{"default":""}', '{"default":42}', '{"named":"sb_secret_x"}'];
  for (const raw of unusable) {
    assertEquals(
      resolveServiceKey(envOf({ SUPABASE_SECRET_KEYS: raw, SUPABASE_SERVICE_ROLE_KEY: 'legacy.jwt.value' })),
      'legacy.jwt.value',
      raw,
    );
  }
});

Deno.test('resolveServiceKey returns null when no key is available', () => {
  assertEquals(resolveServiceKey(envOf({})), null);
  assertEquals(resolveServiceKey(envOf({ SUPABASE_SECRET_KEYS: 'garbage', SUPABASE_SERVICE_ROLE_KEY: '' })), null);
});

Deno.test('createServiceClient builds a client from either key and throws without one', () => {
  const url = 'https://example.supabase.co';
  const secretKeys = '{"default":"sb_secret_x"}';
  createServiceClient(envOf({ SUPABASE_URL: url, SUPABASE_SECRET_KEYS: secretKeys }));
  createServiceClient(envOf({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'legacy.jwt.value' }));
  assertThrows(() => createServiceClient(envOf({ SUPABASE_URL: url })), Error, 'must be set');
  assertThrows(() => createServiceClient(envOf({ SUPABASE_SECRET_KEYS: secretKeys })), Error, 'must be set');
});
