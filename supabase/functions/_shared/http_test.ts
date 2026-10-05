import { assertEquals } from '@std/assert';

import {
  checkMethod,
  clientIpFromForwardedFor,
  describeError,
  errorResponse,
  parseBearerToken,
  readJsonBody,
} from './http.ts';

function post(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/fn', { method: 'POST', body, headers });
}

function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(encoder.encode(part));
      }
      controller.close();
    },
  });
}

Deno.test('clientIpFromForwardedFor uses the last entry (the one the platform proxy appended)', () => {
  assertEquals(clientIpFromForwardedFor('203.0.113.9'), '203.0.113.9');
  assertEquals(clientIpFromForwardedFor('1.1.1.1, 10.0.0.1,198.51.100.7'), '198.51.100.7');
  assertEquals(clientIpFromForwardedFor('spoofed, 198.51.100.7 '), '198.51.100.7');
  assertEquals(clientIpFromForwardedFor('198.51.100.7:4711'), '198.51.100.7');
  assertEquals(clientIpFromForwardedFor('2001:DB8::1'), '2001:db8::1');
  assertEquals(clientIpFromForwardedFor('[2001:db8::1]:443'), '2001:db8::1');
  assertEquals(clientIpFromForwardedFor('::1'), '::1');
  assertEquals(clientIpFromForwardedFor('::ffff:192.0.2.1'), '::ffff:192.0.2.1');
});

Deno.test('clientIpFromForwardedFor rejects missing or non-IP values', () => {
  assertEquals(clientIpFromForwardedFor(null), null);
  assertEquals(clientIpFromForwardedFor(''), null);
  assertEquals(clientIpFromForwardedFor('198.51.100.7, '), null);
  assertEquals(clientIpFromForwardedFor('198.51.100.7, unknown'), null);
  assertEquals(clientIpFromForwardedFor('cafe.babe'), null);
  assertEquals(clientIpFromForwardedFor('1.2.3.4; drop'), null);
  assertEquals(clientIpFromForwardedFor(`1:${'a'.repeat(60)}`), null);
});

Deno.test('parseBearerToken', () => {
  assertEquals(parseBearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
  assertEquals(parseBearerToken('bearer   abc '), 'abc');
  assertEquals(parseBearerToken(null), null);
  assertEquals(parseBearerToken('Bearer'), null);
  assertEquals(parseBearerToken('Basic abc'), null);
  assertEquals(parseBearerToken('Bearer a b'), null);
});

Deno.test('checkMethod: OPTIONS → 204, wrong method → 405, POST passes', async () => {
  const options = checkMethod(new Request('http://localhost/fn', { method: 'OPTIONS' }), 'POST');
  assertEquals(options?.status, 204);
  assertEquals(options?.headers.get('Access-Control-Allow-Origin'), null);

  const get = checkMethod(new Request('http://localhost/fn'), 'POST');
  assertEquals(get?.status, 405);
  assertEquals(get?.headers.get('Allow'), 'POST, OPTIONS');
  assertEquals(await get?.json(), { error: 'method_not_allowed' });

  assertEquals(checkMethod(post(null), 'POST'), null);
});

Deno.test('errorResponse is JSON, uncached', async () => {
  const response = errorResponse(401, 'invalid_code');
  assertEquals(response.status, 401);
  assertEquals(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assertEquals(response.headers.get('Cache-Control'), 'no-store');
  assertEquals(await response.json(), { error: 'invalid_code' });
});

Deno.test('readJsonBody parses JSON within the cap', async () => {
  assertEquals(await readJsonBody(post('{"email":"a@b.co","code":"12345678"}')), {
    ok: true,
    value: { email: 'a@b.co', code: '12345678' },
  });
  assertEquals(await readJsonBody(post(streamOf('{"a":', '1}')), 16), { ok: true, value: { a: 1 } });
});

Deno.test('readJsonBody rejects empty, malformed and non-UTF-8 bodies', async () => {
  const invalid = { ok: false, status: 400, error: 'invalid_input' } as const;
  assertEquals(await readJsonBody(post(null)), invalid);
  assertEquals(await readJsonBody(post('')), invalid);
  assertEquals(await readJsonBody(post('{"a":')), invalid);
  assertEquals(await readJsonBody(post(new Uint8Array([0x7b, 0xff, 0x7d]))), invalid);
});

Deno.test('readJsonBody enforces the size cap with and without Content-Length', async () => {
  const tooLarge = { ok: false, status: 413, error: 'payload_too_large' } as const;
  assertEquals(await readJsonBody(post('{"a":"0123456789"}'), 8), tooLarge);
  // A lying Content-Length is not trusted: the stream itself is capped.
  assertEquals(await readJsonBody(post(streamOf('{"a":"', '0123456789', '"}'), { 'Content-Length': '4' }), 8), tooLarge);
  // Exactly at the cap is fine.
  assertEquals(await readJsonBody(post('{"a":12}'), 8), { ok: true, value: { a: 12 } });
});

Deno.test('describeError keeps name, status and code but never the message', () => {
  const error = Object.assign(new Error('User reviewer@example.com not found'), { status: 404, code: 'user_not_found' });
  assertEquals(describeError(error), { name: 'Error', status: 404, code: 'user_not_found' });
  assertEquals(describeError({ name: 'StorageApiError', statusCode: '500' }), { name: 'StorageApiError', status: 500 });
  assertEquals(describeError({ code: 'has spaces and @' }), { name: 'Error' });
  assertEquals(describeError('boom'), { name: 'string' });
  assertEquals(describeError(null), { name: 'object' });
});
