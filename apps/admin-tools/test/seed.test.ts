import { describe, expect, it } from 'vitest';

import { nextFestivalVersion } from '../src/festival/seed';

describe('nextFestivalVersion', () => {
  it('always bumps past the stored version', () => {
    expect(nextFestivalVersion(null, undefined)).toBe(1);
    expect(nextFestivalVersion(3, undefined)).toBe(4);
    expect(nextFestivalVersion(3, 2)).toBe(4);
    expect(nextFestivalVersion(3, 10)).toBe(10);
    expect(nextFestivalVersion(null, 5)).toBe(5);
  });
});
