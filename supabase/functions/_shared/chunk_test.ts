import { assertEquals, assertThrows } from '@std/assert';

import { chunk, STORAGE_REMOVE_BATCH } from './chunk.ts';

Deno.test('chunk splits in order without empty batches', () => {
  assertEquals(chunk([], 3), []);
  assertEquals(chunk([1, 2, 3], 3), [[1, 2, 3]]);
  assertEquals(chunk([1, 2, 3, 4, 5, 6, 7], 3), [[1, 2, 3], [4, 5, 6], [7]]);
  assertEquals(chunk(['a'], 1000), [['a']]);
});

Deno.test('chunk keeps storage batches at 1000 or fewer', () => {
  const paths = Array.from({ length: 2501 }, (_, index) => `g/m/${index}.jpg`);
  const batches = chunk(paths, STORAGE_REMOVE_BATCH);
  assertEquals(batches.map((batch) => batch.length), [1000, 1000, 501]);
  assertEquals(batches.flat(), paths);
});

Deno.test('chunk rejects a non-positive or fractional size', () => {
  assertThrows(() => chunk([1], 0), RangeError);
  assertThrows(() => chunk([1], -1), RangeError);
  assertThrows(() => chunk([1], 1.5), RangeError);
});
