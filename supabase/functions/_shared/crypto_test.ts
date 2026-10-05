import { assertEquals } from '@std/assert';

import { digestMatches, sha256, timingSafeEqual } from './crypto.ts';

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

Deno.test('sha256 matches the known digest', async () => {
  assertEquals(hex(await sha256('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assertEquals((await sha256('')).byteLength, 32);
});

Deno.test('timingSafeEqual compares every byte', () => {
  assertEquals(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assertEquals(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assertEquals(timingSafeEqual(new Uint8Array([9, 2, 3]), new Uint8Array([1, 2, 3])), false);
  assertEquals(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);
  assertEquals(timingSafeEqual(new Uint8Array(), new Uint8Array()), true);
});

Deno.test('digestMatches compares a candidate against a stored digest', async () => {
  const expected = await sha256('12345678');
  assertEquals(await digestMatches('12345678', expected), true);
  assertEquals(await digestMatches('12345679', expected), false);
  assertEquals(await digestMatches('', expected), false);
  assertEquals(await digestMatches('12345678'.repeat(100), expected), false);
});
