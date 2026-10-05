import { assertEquals } from '@std/assert';

import {
  createDemoLoginHandler,
  type DemoLoginConfig,
  type DemoLoginDeps,
  parseDemoCredentials,
  readDemoLoginConfig,
} from './handler.ts';

const EMAIL = 'reviewer@festie.example';
const CODE = '24681357';
const REVIEWER_ID = '0b6f8f0e-4c1a-4f55-8d43-3e0f3f7f2a01';

function env(values: Record<string, string>) {
  return (name: string) => values[name];
}

async function enabledConfig(): Promise<DemoLoginConfig> {
  const config = await readDemoLoginConfig(env({ DEMO_LOGIN_EMAIL: ` ${EMAIL.toUpperCase()} `, DEMO_LOGIN_CODE: CODE }));
  if (!config) {
    throw new Error('expected an enabled config');
  }
  return config;
}

interface Fake extends DemoLoginDeps {
  calls: string[];
  events: Map<string, number>;
  logged: string[];
}

function fakeDeps(options: { failEnsure?: boolean; failPrepare?: boolean; failRateLimit?: boolean } = {}): Fake {
  const fake: Fake = {
    calls: [],
    events: new Map(),
    logged: [],
    checkRateLimit(key, action, max, window) {
      fake.calls.push(`limit:${key}|${action}|${max}|${window}`);
      if (options.failRateLimit) {
        return Promise.reject(new Error('db down'));
      }
      const id = `${key}|${action}`;
      const count = fake.events.get(id) ?? 0;
      if (count >= max) {
        return Promise.resolve(false);
      }
      fake.events.set(id, count + 1);
      return Promise.resolve(true);
    },
    ensureAuthUser(email) {
      fake.calls.push(`ensure:${email}`);
      return options.failEnsure ? Promise.reject(new Error('auth down')) : Promise.resolve();
    },
    generateMagicLink(email) {
      fake.calls.push(`link:${email}`);
      return Promise.resolve({ authUserId: REVIEWER_ID, tokenHash: 'hashed-token', verificationType: 'magiclink' });
    },
    prepareDemoAccount(authUserId) {
      fake.calls.push(`prepare:${authUserId}`);
      return options.failPrepare ? Promise.reject(new Error('P0001')) : Promise.resolve();
    },
    logError(step) {
      fake.logged.push(step);
    },
  };
  return fake;
}

function login(body: unknown, ip = '198.51.100.7', init: RequestInit = {}): Request {
  return new Request('http://localhost/functions/v1/demo-login', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.1.2.3, ${ip}` },
    ...init,
  });
}

Deno.test('readDemoLoginConfig: enabled only with an email and an 8–10 digit code', async () => {
  const config = await enabledConfig();
  assertEquals(config.email, EMAIL);
  assertEquals(await readDemoLoginConfig(env({ DEMO_LOGIN_EMAIL: EMAIL, DEMO_LOGIN_CODE: '1234567890' })) !== null, true);
  const disabled: Array<Record<string, string>> = [
    {},
    { DEMO_LOGIN_EMAIL: EMAIL },
    { DEMO_LOGIN_CODE: CODE },
    { DEMO_LOGIN_EMAIL: EMAIL, DEMO_LOGIN_CODE: '1234567' },
    { DEMO_LOGIN_EMAIL: EMAIL, DEMO_LOGIN_CODE: '12345678901' },
    { DEMO_LOGIN_EMAIL: EMAIL, DEMO_LOGIN_CODE: '1234abcd' },
    { DEMO_LOGIN_EMAIL: 'not-an-email', DEMO_LOGIN_CODE: CODE },
    { DEMO_LOGIN_EMAIL: '', DEMO_LOGIN_CODE: CODE },
  ];
  for (const values of disabled) {
    assertEquals(await readDemoLoginConfig(env(values)), null, JSON.stringify(values));
  }
});

Deno.test('parseDemoCredentials normalises like the app and rejects other shapes', () => {
  assertEquals(parseDemoCredentials({ email: ' Reviewer@Festie.Example ', code: '2468 1357' }), {
    email: EMAIL,
    code: CODE,
  });
  assertEquals(parseDemoCredentials(null), null);
  assertEquals(parseDemoCredentials([EMAIL, CODE]), null);
  assertEquals(parseDemoCredentials({ email: EMAIL }), null);
  assertEquals(parseDemoCredentials({ email: EMAIL, code: 24681357 }), null);
});

Deno.test('disabled → 404 for every request', async () => {
  const deps = fakeDeps();
  const handler = createDemoLoginHandler(null, deps);
  for (const request of [login({ email: EMAIL, code: CODE }), login('', undefined, { method: 'OPTIONS' }), login('x')]) {
    const response = await handler(request);
    assertEquals(response.status, 404);
  }
  assertEquals(deps.calls, []);
});

Deno.test('match → user ensured, link minted, account prepared, then 200 { token_hash, verification_type }', async () => {
  const deps = fakeDeps();
  const response = await createDemoLoginHandler(await enabledConfig(), deps)(
    login({ email: 'Reviewer@Festie.Example', code: CODE }),
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { token_hash: 'hashed-token', verification_type: 'magiclink' });
  assertEquals(deps.calls, [
    'limit:demo-login:ip:198.51.100.7|attempt|20|1 hour',
    'limit:demo-login:global|fail|30|1 hour',
    `ensure:${EMAIL}`,
    `link:${EMAIL}`,
    `prepare:${REVIEWER_ID}`,
  ]);
});

Deno.test('wrong email and wrong code get the identical 401', async () => {
  const config = await enabledConfig();
  const bodies = [];
  for (const credentials of [{ email: 'someone@festie.example', code: CODE }, { email: EMAIL, code: '13572468' }]) {
    const deps = fakeDeps();
    const response = await createDemoLoginHandler(config, deps)(login(credentials));
    assertEquals(response.status, 401);
    bodies.push(await response.text());
    assertEquals(deps.calls.some((call) => call.startsWith('ensure:')), false);
    // Exactly two rate-limiter calls either way: per IP, then the email's bucket.
    assertEquals(deps.calls.length, 2);
  }
  assertEquals(bodies[0], bodies[1]);
  assertEquals(JSON.parse(bodies[0]), { error: 'invalid_code' });
});

Deno.test('near-miss credentials (unicode, length, extra digits) → 401', async () => {
  const config = await enabledConfig();
  const nearMisses = [
    { email: `${EMAIL}​`, code: CODE },
    { email: `${EMAIL}${'x'.repeat(300)}`, code: CODE },
    { email: EMAIL, code: `${CODE}0` },
    { email: EMAIL, code: CODE.slice(0, 7) },
    { email: EMAIL, code: '２４６８１３５７' },
  ];
  for (const credentials of nearMisses) {
    const deps = fakeDeps();
    const response = await createDemoLoginHandler(config, deps)(login(credentials));
    assertEquals(response.status, 401, JSON.stringify(credentials));
    assertEquals(deps.calls.some((call) => call.startsWith('ensure:')), false);
  }
  // Whitespace inside the code is stripped, as in the app.
  const deps = fakeDeps();
  assertEquals((await createDemoLoginHandler(config, deps)(login({ email: EMAIL, code: ' 2468 1357 ' }))).status, 200);
});

Deno.test('per-IP limit: the 21st attempt in an hour from one address → 429 without comparing', async () => {
  const config = await enabledConfig();
  const deps = fakeDeps();
  const handler = createDemoLoginHandler(config, deps);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    assertEquals((await handler(login({ email: EMAIL, code: '11111111' }, '203.0.113.5'))).status, 401);
  }
  const limited = await handler(login({ email: EMAIL, code: CODE }, '203.0.113.5'));
  assertEquals(limited.status, 429);
  assertEquals(await limited.json(), { error: 'rate_limited' });
  assertEquals(deps.calls.some((call) => call.startsWith('ensure:')), false);
  // Another address is unaffected.
  assertEquals((await handler(login({ email: EMAIL, code: CODE }, '203.0.113.6'))).status, 200);
});

Deno.test('global limit: after 30 compared attempts in an hour even the right code is refused', async () => {
  const config = await enabledConfig();
  const deps = fakeDeps();
  const handler = createDemoLoginHandler(config, deps);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    assertEquals((await handler(login({ email: EMAIL, code: '11111111' }, `192.0.2.${attempt}`))).status, 401);
  }
  const locked = await handler(login({ email: EMAIL, code: CODE }, '192.0.2.200'));
  assertEquals(locked.status, 401);
  assertEquals(deps.calls.some((call) => call.startsWith('ensure:')), false);
});

Deno.test('a full global cap is indistinguishable from a wrong email (no enumeration oracle)', async () => {
  const config = await enabledConfig();
  const deps = fakeDeps();
  deps.events.set('demo-login:global|fail', 30);
  const handler = createDemoLoginHandler(config, deps);
  const probe = async (email: string) => {
    const response = await handler(login({ email, code: '11111111' }, '198.51.100.20'));
    return { status: response.status, headers: [...response.headers], body: await response.text() };
  };
  const demoEmail = await probe(EMAIL);
  const otherEmail = await probe('guess@festie.example');
  assertEquals(demoEmail.status, 401);
  assertEquals(demoEmail, otherEmail);
});

Deno.test('only attempts naming the demo email count toward the global cap', async () => {
  const config = await enabledConfig();
  const deps = fakeDeps();
  const handler = createDemoLoginHandler(config, deps);
  // Ordinary users mistyping their real 8-digit codes, and strangers sending junk.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await handler(login({ email: `user${attempt}@example.com`, code: '11111111' }, `192.0.2.${attempt}`));
    assertEquals(response.status, 401);
  }
  // A stranger who guesses the code but not the email gets nothing either.
  assertEquals((await handler(login({ email: 'stranger@example.com', code: CODE }, '192.0.2.150'))).status, 401);
  assertEquals(deps.events.get('demo-login:global|fail'), undefined);
  assertEquals(deps.events.get('demo-login:other|attempt'), 41);
  assertEquals(deps.calls.at(-1), 'limit:demo-login:other|attempt|1000|1 hour');
  assertEquals((await handler(login({ email: EMAIL, code: CODE }, '192.0.2.200'))).status, 200);
});

Deno.test('a full other-email bucket still answers 401, never 429', async () => {
  const config = await enabledConfig();
  const deps = fakeDeps();
  deps.events.set('demo-login:other|attempt', 1000);
  const handler = createDemoLoginHandler(config, deps);
  const response = await handler(login({ email: 'someone@festie.example', code: CODE }));
  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: 'invalid_code' });
  assertEquals((await handler(login({ email: EMAIL, code: CODE }, '198.51.100.8'))).status, 200);
});

Deno.test('spoofed X-Forwarded-For prefixes do not change the rate-limit key', async () => {
  const deps = fakeDeps();
  await createDemoLoginHandler(await enabledConfig(), deps)(
    login({ email: EMAIL, code: '11111111' }, '198.51.100.7', {
      headers: { 'X-Forwarded-For': '1.2.3.4, 5.6.7.8, 198.51.100.7' },
    }),
  );
  assertEquals(deps.calls[0], 'limit:demo-login:ip:198.51.100.7|attempt|20|1 hour');
});

Deno.test('malformed bodies → 400/413 before any database call', async () => {
  const config = await enabledConfig();
  const deps = fakeDeps();
  const handler = createDemoLoginHandler(config, deps);
  assertEquals((await handler(login('not json'))).status, 400);
  assertEquals((await handler(login({ email: EMAIL }))).status, 400);
  assertEquals((await handler(login({ email: EMAIL, code: 'x'.repeat(10_000) }))).status, 413);
  assertEquals((await handler(login('', undefined, { method: 'GET', body: undefined }))).status, 405);
  assertEquals((await handler(login('', undefined, { method: 'OPTIONS', body: undefined }))).status, 204);
  assertEquals(deps.calls, []);
});

Deno.test('backend failures → 500 server_error and no token', async () => {
  const config = await enabledConfig();
  for (const [deps, step] of [
    [fakeDeps({ failRateLimit: true }), 'rate_limit'],
    [fakeDeps({ failEnsure: true }), 'ensure_auth_user'],
    [fakeDeps({ failPrepare: true }), 'prepare_demo_account'],
  ] as const) {
    const response = await createDemoLoginHandler(config, deps)(login({ email: EMAIL, code: CODE }));
    assertEquals(response.status, 500);
    assertEquals(await response.json(), { error: 'server_error' });
    assertEquals(deps.logged, [step]);
  }
});
