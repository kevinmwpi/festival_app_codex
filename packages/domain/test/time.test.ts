import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  festivalDayKey,
  festivalDayMinutesRange,
  festivalTimeZoneLabel,
  formatFestivalDate,
  formatFestivalTime,
  formatFestivalTimeRange,
  getFestivalTimeZoneInfo,
  getSetsByDay,
  getZonedParts,
  listFestivalDays,
  minutesIntoFestivalDay,
  resetFestivalTimeCachesForTests,
  timesAreDeviceLocal,
  type Set,
} from '../src';

function deviceClock(iso: string): string {
  const date = new Date(iso);
  const hour = date.getHours();
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(date.getMinutes()).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

describe('formatFestivalTime', () => {
  it.each([
    ['America/Los_Angeles', '2026-04-11T04:30:00Z'], // PDT, UTC-7
    ['America/Chicago', '2026-08-01T02:30:00Z'], // CDT, UTC-5
    ['Europe/Berlin', '2026-07-10T19:30:00Z'], // CEST, UTC+2
    ['Australia/Sydney', '2026-01-10T10:30:00Z'], // AEDT, UTC+11
  ])('renders 9:30 PM in %s', (timeZone, iso) => {
    expect(formatFestivalTime(iso, timeZone)).toBe('9:30 PM');
  });

  it('renders midnight and noon on a 12-hour clock (h23 parsing, 24 → 00)', () => {
    expect(formatFestivalTime('2026-07-10T22:00:00Z', 'Europe/Berlin')).toBe('12:00 AM');
    expect(formatFestivalTime('2026-07-10T10:00:00Z', 'Europe/Berlin')).toBe('12:00 PM');
    expect(getZonedParts('2026-07-10T22:00:00Z', 'Europe/Berlin')).toMatchObject({ day: 11, hour: 0, minute: 0 });
  });

  it('formats ranges', () => {
    expect(formatFestivalTimeRange('2026-04-11T04:30:00Z', '2026-04-11T05:45:00Z', 'America/Los_Angeles')).toBe('9:30 PM – 10:45 PM');
  });

  it('handles the US spring-forward gap (America/Chicago)', () => {
    expect(formatFestivalTime('2026-03-08T07:59:00Z', 'America/Chicago')).toBe('1:59 AM');
    expect(formatFestivalTime('2026-03-08T08:00:00Z', 'America/Chicago')).toBe('3:00 AM');
  });

  it('handles the US fall-back overlap (America/Los_Angeles)', () => {
    expect(formatFestivalTime('2026-11-01T08:30:00Z', 'America/Los_Angeles')).toBe('1:30 AM');
    expect(formatFestivalTime('2026-11-01T09:30:00Z', 'America/Los_Angeles')).toBe('1:30 AM');
  });
});

describe('festivalDayKey', () => {
  it('puts a 1:00 AM set on the previous festival day', () => {
    // 1:00 AM PDT on Apr 11.
    expect(festivalDayKey('2026-04-11T08:00:00Z', 'America/Los_Angeles')).toBe('2026-04-10');
    // 6:00 AM PDT starts the new festival day.
    expect(festivalDayKey('2026-04-11T13:00:00Z', 'America/Los_Angeles')).toBe('2026-04-11');
    // 1:00 AM AEDT on Jan 11.
    expect(festivalDayKey('2026-01-10T14:00:00Z', 'Australia/Sydney')).toBe('2026-01-10');
    // 11:00 PM CDT on Jul 31 is still Jul 31.
    expect(festivalDayKey('2026-08-01T04:00:00Z', 'America/Chicago')).toBe('2026-07-31');
  });

  it('respects a custom day start hour', () => {
    expect(festivalDayKey('2026-04-11T08:00:00Z', 'America/Los_Angeles', 0)).toBe('2026-04-11');
  });

  it('keeps date-only input unchanged', () => {
    expect(festivalDayKey('2026-04-10', 'Australia/Sydney')).toBe('2026-04-10');
  });

  it('buckets across the Europe/Berlin DST switch', () => {
    // 01:30 CET and 03:30 CEST on Mar 29 both belong to the Mar 28 festival day.
    expect(festivalDayKey('2026-03-29T00:30:00Z', 'Europe/Berlin')).toBe('2026-03-28');
    expect(festivalDayKey('2026-03-29T01:30:00Z', 'Europe/Berlin')).toBe('2026-03-28');
    expect(formatFestivalTime('2026-03-29T01:30:00Z', 'Europe/Berlin')).toBe('3:30 AM');
  });
});

describe('minutesIntoFestivalDay', () => {
  it('counts wall-clock minutes from the day start', () => {
    expect(minutesIntoFestivalDay('2026-04-10T13:00:00Z', 'America/Los_Angeles')).toBe(0); // 6:00 AM
    expect(minutesIntoFestivalDay('2026-04-11T04:30:00Z', 'America/Los_Angeles')).toBe(15 * 60 + 30); // 9:30 PM
    expect(minutesIntoFestivalDay('2026-04-11T08:00:00Z', 'America/Los_Angeles')).toBe(19 * 60); // 1:00 AM
  });

  it('follows the wall clock across DST', () => {
    expect(minutesIntoFestivalDay('2026-03-29T00:30:00Z', 'Europe/Berlin')).toBe(19 * 60 + 30); // 01:30 CET
    expect(minutesIntoFestivalDay('2026-03-29T01:30:00Z', 'Europe/Berlin')).toBe(21 * 60 + 30); // 03:30 CEST
  });

  it('places items that run past the next day start', () => {
    expect(festivalDayMinutesRange('2026-04-11T06:00:00Z', '2026-04-11T08:00:00Z', 'America/Los_Angeles')).toEqual({
      dayKey: '2026-04-10',
      startMinutes: 17 * 60,
      endMinutes: 19 * 60,
    });
    expect(festivalDayMinutesRange('2026-04-11T11:00:00Z', '2026-04-11T13:00:00Z', 'America/Los_Angeles')).toEqual({
      dayKey: '2026-04-10',
      startMinutes: 22 * 60,
      endMinutes: 24 * 60,
    });
  });
});

describe('festivalDayMinutesRange across DST', () => {
  // EU DST ends 2026-10-25 03:00 CEST -> 02:00 CET (e.g. the last night of Amsterdam Dance Event).
  const AMS = 'Europe/Amsterdam';

  it('uses the real duration on a fall-back night', () => {
    const twoHours = festivalDayMinutesRange('2026-10-25T00:00:00Z', '2026-10-25T02:00:00Z', AMS); // 02:00 CEST -> 03:00 CET
    expect(twoHours.dayKey).toBe('2026-10-24');
    expect(twoHours.startMinutes).toBe(20 * 60);
    expect(twoHours.endMinutes - twoHours.startMinutes).toBe(120);

    const repeatedWallClock = festivalDayMinutesRange('2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z', AMS); // 02:30 CEST -> 02:30 CET
    expect(repeatedWallClock.endMinutes - repeatedWallClock.startMinutes).toBe(60);
  });

  it('uses the real duration on a spring-forward night', () => {
    const oneHour = festivalDayMinutesRange('2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z', AMS); // 01:30 CET -> 03:30 CEST
    expect(oneHour.startMinutes).toBe(19 * 60 + 30);
    expect(oneHour.endMinutes - oneHour.startMinutes).toBe(60);
  });

  it('never yields a negative height', () => {
    const inverted = festivalDayMinutesRange('2026-04-11T08:00:00Z', '2026-04-11T06:00:00Z', 'America/Los_Angeles');
    expect(inverted.endMinutes).toBe(inverted.startMinutes);
  });
});

describe('formatFestivalDate', () => {
  it('formats date-only strings as calendar dates regardless of zone', () => {
    for (const timeZone of ['America/Los_Angeles', 'Australia/Sydney', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      expect(formatFestivalDate('2026-04-10', timeZone)).toBe('Fri, Apr 10');
    }
    expect(formatFestivalDate('2026-04-10', 'Not/AZone', { month: 'long', day: 'numeric', year: 'numeric' })).toBe('April 10, 2026');
  });

  it('formats timestamps in the festival zone', () => {
    expect(formatFestivalDate('2026-04-11T04:30:00Z', 'America/Los_Angeles')).toBe('Fri, Apr 10');
    expect(formatFestivalDate('2026-04-11T04:30:00Z', 'Australia/Sydney')).toBe('Sat, Apr 11');
  });
});

describe('listFestivalDays', () => {
  it('lists calendar days plus set days outside the range', () => {
    const festival = { start_date: '2026-04-10', end_date: '2026-04-12', timezone: 'America/Los_Angeles' };
    const sets = [
      { start_time: '2026-04-13T09:00:00Z' }, // 2 AM Apr 13 → Apr 12 festival day
      { start_time: '2026-04-09T20:00:00Z' }, // 1 PM Apr 9 → outside the range
      { start_time: '2026-04-11T03:00:00Z' }, // 8 PM Apr 10
    ];
    expect(listFestivalDays(festival, sets)).toEqual(['2026-04-09', '2026-04-10', '2026-04-11', '2026-04-12']);
  });

  it('crosses month boundaries', () => {
    expect(listFestivalDays({ start_date: '2026-07-30', end_date: '2026-08-02', timezone: 'America/Chicago' })).toEqual([
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
  });
});

describe('getSetsByDay', () => {
  it('buckets late-night sets on the previous day', () => {
    const base = { artist_id: 'a', stage_id: 's', festival_id: 'f' };
    const evening: Set = { ...base, id: 'evening', start_time: '2026-04-11T04:00:00Z', end_time: '2026-04-11T05:00:00Z' };
    const late: Set = { ...base, id: 'late', start_time: '2026-04-11T08:00:00Z', end_time: '2026-04-11T09:00:00Z' };
    expect(getSetsByDay([late, evening], 'America/Los_Angeles')).toEqual({ '2026-04-10': [evening, late] });
  });
});

describe('time zone label & device fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetFestivalTimeCachesForTests();
  });

  it('returns a non-empty label that changes across DST', () => {
    const winter = festivalTimeZoneLabel('Europe/Berlin', new Date('2026-01-15T12:00:00Z'));
    const summer = festivalTimeZoneLabel('Europe/Berlin', new Date('2026-07-15T12:00:00Z'));
    expect(winter.length).toBeGreaterThan(0);
    expect(summer.length).toBeGreaterThan(0);
    expect(winter).not.toBe(summer);
  });

  it('uses the festival zone when the runtime supports it', () => {
    expect(timesAreDeviceLocal('Australia/Sydney')).toBe(false);
    expect(getFestivalTimeZoneInfo('Australia/Sydney').timesAreDeviceLocal).toBe(false);
  });

  it('falls back to device time for an unknown zone', () => {
    const iso = '2026-04-11T04:30:00Z';
    expect(timesAreDeviceLocal('Not/AZone')).toBe(true);
    expect(formatFestivalTime(iso, 'Not/AZone')).toBe(deviceClock(iso));
    expect(festivalTimeZoneLabel('Not/AZone').length).toBeGreaterThan(0);
    const info = getFestivalTimeZoneInfo('Not/AZone');
    expect(info.timesAreDeviceLocal).toBe(true);
  });

  it('falls back to device time when Intl rejects every timeZone option', () => {
    const RealDateTimeFormat = Intl.DateTimeFormat;
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(((locale?: string | string[], options?: Intl.DateTimeFormatOptions) => {
      if (options?.timeZone) {
        throw new RangeError('Time zones are not supported');
      }
      return new RealDateTimeFormat(locale, options);
    }) as unknown as typeof Intl.DateTimeFormat);
    resetFestivalTimeCachesForTests();

    const iso = '2026-07-10T19:30:00Z';
    expect(timesAreDeviceLocal('Europe/Berlin')).toBe(true);
    expect(formatFestivalTime(iso, 'Europe/Berlin')).toBe(deviceClock(iso));
    expect(formatFestivalDate('2026-04-10', 'Europe/Berlin')).toBe('Fri, Apr 10');
    expect(festivalTimeZoneLabel('Europe/Berlin').length).toBeGreaterThan(0);
  });
});
