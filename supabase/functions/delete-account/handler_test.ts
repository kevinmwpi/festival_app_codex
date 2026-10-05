import { assertEquals } from '@std/assert';

import { type CallerLookup, createDeleteAccountHandler, type DeleteAccountDeps } from './handler.ts';

const AUTH_USER_ID = '7d8c1c1e-2f0e-4a51-9a7e-1d5d0c2b9f10';

interface Fake extends DeleteAccountDeps {
  calls: string[];
  removed: string[][];
  logged: Array<{ step: string; details: Record<string, unknown> }>;
}

function fakeDeps(options: {
  caller?: CallerLookup | Error;
  paths?: string[];
  failStorageBatch?: number;
  failDelete?: boolean;
  failPrepare?: boolean;
} = {}): Fake {
  const fake: Fake = {
    calls: [],
    removed: [],
    logged: [],
    lookupCaller(jwt) {
      fake.calls.push(`lookup:${jwt}`);
      const caller = options.caller ?? { kind: 'user', authUserId: AUTH_USER_ID };
      return caller instanceof Error ? Promise.reject(caller) : Promise.resolve(caller);
    },
    prepareAccountDeletion(authUserId) {
      fake.calls.push(`prepare:${authUserId}`);
      if (options.failPrepare) {
        return Promise.reject(Object.assign(new Error('db down'), { code: '57014' }));
      }
      return Promise.resolve(options.paths ?? []);
    },
    removeTotems(paths) {
      fake.calls.push(`remove:${paths.length}`);
      fake.removed.push(paths);
      if (options.failStorageBatch === fake.removed.length) {
        return Promise.reject(Object.assign(new Error('storage g/m/x.jpg'), { name: 'StorageApiError', status: 500 }));
      }
      return Promise.resolve();
    },
    deleteAuthUser(authUserId) {
      fake.calls.push(`delete:${authUserId}`);
      return options.failDelete ? Promise.reject(new Error('auth down')) : Promise.resolve();
    },
    logError(step, details) {
      fake.logged.push({ step, details });
    },
  };
  return fake;
}

function request(init: RequestInit & { token?: string | null } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.token !== null) {
    headers.set('Authorization', `Bearer ${init.token ?? 'jwt-token'}`);
  }
  return new Request('http://localhost/functions/v1/delete-account', { method: 'POST', ...init, headers });
}

Deno.test('deletes storage in batches of ≤ 1000, then the auth user → 200 { deleted: true }', async () => {
  const paths = Array.from({ length: 2300 }, (_, index) => `g/m/${index}.jpg`);
  const deps = fakeDeps({ paths });
  const response = await createDeleteAccountHandler(deps)(request());

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { deleted: true });
  assertEquals(deps.calls, [
    'lookup:jwt-token',
    `prepare:${AUTH_USER_ID}`,
    'remove:1000',
    'remove:1000',
    'remove:300',
    `delete:${AUTH_USER_ID}`,
  ]);
  assertEquals(deps.removed.flat(), paths);
});

Deno.test('no photos: storage is not called', async () => {
  const deps = fakeDeps({ paths: [] });
  const response = await createDeleteAccountHandler(deps)(request());
  assertEquals(response.status, 200);
  assertEquals(deps.calls, ['lookup:jwt-token', `prepare:${AUTH_USER_ID}`, `delete:${AUTH_USER_ID}`]);
});

Deno.test('a token whose user is already gone → 200 { deleted: true } (idempotent)', async () => {
  const deps = fakeDeps({ caller: { kind: 'gone' } });
  const response = await createDeleteAccountHandler(deps)(request());
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { deleted: true });
  assertEquals(deps.calls, ['lookup:jwt-token']);
});

Deno.test('missing or rejected token → 401, nothing deleted', async () => {
  const missing = fakeDeps();
  const noToken = await createDeleteAccountHandler(missing)(request({ token: null }));
  assertEquals(noToken.status, 401);
  assertEquals(await noToken.json(), { error: 'not_authenticated' });
  assertEquals(missing.calls, []);

  const rejected = fakeDeps({ caller: { kind: 'unauthorized' } });
  const badToken = await createDeleteAccountHandler(rejected)(request());
  assertEquals(badToken.status, 401);
  assertEquals(rejected.calls, ['lookup:jwt-token']);
});

Deno.test('a storage failure is a retryable 500 and the auth user is kept', async () => {
  const deps = fakeDeps({ paths: Array.from({ length: 1500 }, (_, index) => `g/m/${index}.jpg`), failStorageBatch: 2 });
  const response = await createDeleteAccountHandler(deps)(request());
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: 'server_error' });
  assertEquals(deps.calls.includes(`delete:${AUTH_USER_ID}`), false);
  // Logged without the message (which contains a path).
  assertEquals(deps.logged, [{ step: 'remove_totems', details: { name: 'StorageApiError', status: 500 } }]);
});

Deno.test('prepare, auth-delete and lookup failures are retryable 500s', async () => {
  for (const [deps, step] of [
    [fakeDeps({ failPrepare: true }), 'prepare_account_deletion'],
    [fakeDeps({ failDelete: true }), 'delete_auth_user'],
    [fakeDeps({ caller: new Error('network') }), 'lookup_caller'],
  ] as const) {
    const response = await createDeleteAccountHandler(deps)(request());
    assertEquals(response.status, 500);
    assertEquals(deps.logged.map((entry) => entry.step), [step]);
  }
});

Deno.test('method handling: OPTIONS → 204, GET → 405', async () => {
  const deps = fakeDeps();
  const handler = createDeleteAccountHandler(deps);
  assertEquals((await handler(request({ method: 'OPTIONS' }))).status, 204);
  assertEquals((await handler(request({ method: 'GET' }))).status, 405);
  assertEquals(deps.calls, []);
});
