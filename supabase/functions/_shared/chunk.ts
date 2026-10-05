/** Storage's `remove()` accepts at most 1000 paths per call. */
export const STORAGE_REMOVE_BATCH = 1000;

/** Splits `items` into consecutive batches of at most `size` (order kept, no empty batches). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`chunk size must be a positive integer, got ${size}`);
  }
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
