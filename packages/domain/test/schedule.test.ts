import { describe, expect, it } from 'vitest';

import { detectConflict, getConflictsForSet, getNextUpcomingSet, getSetsByDay, type Set } from '../src';

function createSet(overrides: Partial<Set>): Set {
  return {
    id: overrides.id ?? 'set-1',
    artist_id: overrides.artist_id ?? 'artist-1',
    stage_id: overrides.stage_id ?? 'stage-1',
    festival_id: overrides.festival_id ?? 'festival-1',
    start_time: overrides.start_time ?? '2026-08-21T18:00:00.000Z',
    end_time: overrides.end_time ?? '2026-08-21T19:00:00.000Z',
  };
}

describe('schedule helpers', () => {
  it('returns false for non-overlapping sets', () => {
    const first = createSet({
      id: 'a',
      start_time: '2026-08-21T18:00:00.000Z',
      end_time: '2026-08-21T19:00:00.000Z',
    });
    const second = createSet({
      id: 'b',
      start_time: '2026-08-21T19:30:00.000Z',
      end_time: '2026-08-21T20:30:00.000Z',
    });

    expect(detectConflict(first, second)).toBe(false);
  });

  it('detects overlapping sets', () => {
    const first = createSet({
      id: 'a',
      start_time: '2026-08-21T18:00:00.000Z',
      end_time: '2026-08-21T19:30:00.000Z',
    });
    const second = createSet({
      id: 'b',
      start_time: '2026-08-21T19:00:00.000Z',
      end_time: '2026-08-21T20:00:00.000Z',
    });

    expect(detectConflict(first, second)).toBe(true);
  });

  it('treats adjacent sets as non-conflicting', () => {
    const first = createSet({
      id: 'a',
      start_time: '2026-08-21T18:00:00.000Z',
      end_time: '2026-08-21T19:00:00.000Z',
    });
    const second = createSet({
      id: 'b',
      start_time: '2026-08-21T19:00:00.000Z',
      end_time: '2026-08-21T20:00:00.000Z',
    });

    expect(detectConflict(first, second)).toBe(false);
  });

  it('returns no conflicts for a single selected set', () => {
    const selection = createSet({ id: 'solo' });
    expect(getConflictsForSet(selection, [selection])).toEqual([]);
  });

  it('groups sets by calendar day', () => {
    const first = createSet({
      id: 'a',
      start_time: '2026-08-21T18:00:00.000Z',
      end_time: '2026-08-21T19:00:00.000Z',
    });
    const second = createSet({
      id: 'b',
      start_time: '2026-08-22T18:00:00.000Z',
      end_time: '2026-08-22T19:00:00.000Z',
    });

    expect(getSetsByDay([second, first])).toEqual({
      '2026-08-21': [first],
      '2026-08-22': [second],
    });
  });

  it('finds the next upcoming set', () => {
    const first = createSet({
      id: 'early',
      start_time: '2026-08-21T18:00:00.000Z',
      end_time: '2026-08-21T19:00:00.000Z',
    });
    const second = createSet({
      id: 'late',
      start_time: '2026-08-21T20:00:00.000Z',
      end_time: '2026-08-21T21:00:00.000Z',
    });

    expect(getNextUpcomingSet([second, first], new Date('2026-08-21T19:15:00.000Z'))).toEqual(second);
  });
});
