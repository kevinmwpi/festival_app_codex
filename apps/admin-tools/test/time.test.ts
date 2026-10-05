import { describe, expect, it } from 'vitest';

import {
  addDays,
  daysBetween,
  festivalDayOf,
  formatInstantInZone,
  isValidDateString,
  isValidTimeZone,
  localDateOf,
  offsetMinutesAt,
  parseLocalDateTime,
  parseOffsetTimestamp,
  shiftWallTimeByDays,
  wallTimeExists,
  wallTimeIn,
  zonedTimeToInstant,
} from '../src/lib/time';

describe('calendar dates', () => {
  it('validates real calendar dates', () => {
    expect(isValidDateString('2027-06-18')).toBe(true);
    expect(isValidDateString('2028-02-29')).toBe(true);
    expect(isValidDateString('2027-02-29')).toBe(false);
    expect(isValidDateString('2027-13-01')).toBe(false);
    expect(isValidDateString('2027-6-18')).toBe(false);
    expect(isValidDateString(20270618)).toBe(false);
  });

  it('adds days across month, year and leap boundaries', () => {
    expect(addDays('2027-06-30', 1)).toBe('2027-07-01');
    expect(addDays('2027-12-31', 1)).toBe('2028-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2027-06-18', '2027-06-20')).toBe(2);
    expect(daysBetween('2027-06-20', '2027-06-18')).toBe(-2);
    expect(daysBetween('2027-03-13', '2027-03-15')).toBe(2);
  });
});

describe('time zones', () => {
  it('accepts IANA zones only', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('EST')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('reports offsets with DST', () => {
    expect(offsetMinutesAt(new Date('2027-06-18T16:00:00Z'), 'America/New_York')).toBe(-240);
    expect(offsetMinutesAt(new Date('2027-01-18T16:00:00Z'), 'America/New_York')).toBe(-300);
    expect(offsetMinutesAt(new Date('2027-06-18T16:00:00Z'), 'Asia/Kolkata')).toBe(330);
  });

  it('converts wall time to instants and back', () => {
    const wall = { year: 2027, month: 6, day: 18, hour: 19, minute: 30, second: 0 };
    const instant = zonedTimeToInstant(wall, 'America/New_York');
    expect(instant.toISOString()).toBe('2027-06-18T23:30:00.000Z');
    expect(wallTimeIn(instant, 'America/New_York')).toEqual(wall);
    expect(formatInstantInZone(instant, 'America/New_York')).toBe('2027-06-18T19:30:00-04:00');
    expect(formatInstantInZone(instant, 'UTC')).toBe('2027-06-18T23:30:00+00:00');
  });

  it('detects wall times skipped by spring-forward', () => {
    const skipped = { year: 2027, month: 3, day: 14, hour: 2, minute: 30, second: 0 };
    expect(wallTimeExists(skipped, 'America/New_York')).toBe(false);
    expect(wallTimeExists({ ...skipped, hour: 3 }, 'America/New_York')).toBe(true);
  });

  it('picks the earlier instant for repeated fall-back times', () => {
    const repeated = { year: 2027, month: 11, day: 7, hour: 1, minute: 30, second: 0 };
    expect(formatInstantInZone(zonedTimeToInstant(repeated, 'America/New_York'), 'America/New_York')).toBe(
      '2027-11-07T01:30:00-04:00',
    );
  });

  it('gives local dates and festival days (late-night sets belong to the previous day)', () => {
    const lateNight = new Date('2027-06-19T04:30:00Z'); // 00:30 in New York
    expect(localDateOf(lateNight, 'America/New_York')).toBe('2027-06-19');
    expect(festivalDayOf(lateNight, 'America/New_York')).toBe('2027-06-18');
    expect(festivalDayOf(new Date('2027-06-19T14:00:00Z'), 'America/New_York')).toBe('2027-06-19');
  });

  it('shifts wall times by calendar days', () => {
    expect(shiftWallTimeByDays({ year: 2027, month: 6, day: 30, hour: 23, minute: 0, second: 0 }, 2)).toEqual({
      year: 2027, month: 7, day: 2, hour: 23, minute: 0, second: 0,
    });
  });
});

describe('timestamp parsing', () => {
  it('requires an explicit offset', () => {
    expect(parseOffsetTimestamp('2027-06-18T19:30:00-04:00')?.toISOString()).toBe('2027-06-18T23:30:00.000Z');
    expect(parseOffsetTimestamp('2027-06-18T23:30Z')?.toISOString()).toBe('2027-06-18T23:30:00.000Z');
    expect(parseOffsetTimestamp('2027-06-18T19:30:00')).toBeNull();
    expect(parseOffsetTimestamp('2027-06-18 19:30:00-04:00')).toBeNull();
    expect(parseOffsetTimestamp('2027-02-30T19:30:00Z')).toBeNull();
    expect(parseOffsetTimestamp('2027-06-18T24:00:00Z')).toBeNull();
    expect(parseOffsetTimestamp('2027-06-18T19:30:00+15:00')).toBeNull();
  });

  it('parses local date-times', () => {
    expect(parseLocalDateTime('2027-06-18 19:30')).toEqual({ year: 2027, month: 6, day: 18, hour: 19, minute: 30, second: 0 });
    expect(parseLocalDateTime('2027-06-18T19:30:15')).toEqual({ year: 2027, month: 6, day: 18, hour: 19, minute: 30, second: 15 });
    expect(parseLocalDateTime('2027-06-18 7:30 PM')).toBeNull();
    expect(parseLocalDateTime('2027-06-31 19:30')).toBeNull();
  });
});
