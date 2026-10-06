import { describe, expect, it } from 'vitest';

import { formatFestivalDayLabel, formatTimeFromDay, isAfterMidnight } from '../src/hooks/festival-time-labels';

const TZ = 'Europe/Berlin';
// Friday 2027-07-02 and the night after it, in CEST (UTC+2).
const FRI_9PM = '2027-07-02T19:00:00Z';
const SAT_1AM = '2027-07-02T23:00:00Z';
const SAT_2PM = '2027-07-03T12:00:00Z';

describe('festival day labels', () => {
  it('labels an after-midnight set with the festival day it is listed under', () => {
    expect(isAfterMidnight(SAT_1AM, TZ)).toBe(true);
    expect(isAfterMidnight(FRI_9PM, TZ)).toBe(false);
    expect(formatFestivalDayLabel(SAT_1AM, TZ)).toBe('Fri night');
    expect(formatFestivalDayLabel(FRI_9PM, TZ)).toBe('Fri');
    expect(formatFestivalDayLabel(SAT_2PM, TZ)).toBe('Sat');
    expect(formatFestivalDayLabel(SAT_1AM, TZ, { weekday: 'short', month: 'short', day: 'numeric' })).toBe('Fri, Jul 2 night');
  });
});

describe('times relative to a day', () => {
  it('shows only the time on the same festival day, else the day too', () => {
    expect(formatTimeFromDay(SAT_1AM, FRI_9PM, TZ)).toBe('1:00 AM');
    expect(formatTimeFromDay(SAT_2PM, FRI_9PM, TZ)).toBe('Sat 2:00 PM');
    expect(formatTimeFromDay(SAT_1AM, Date.parse(SAT_2PM), TZ)).toBe('Fri night 1:00 AM');
    expect(formatTimeFromDay(SAT_2PM, Date.parse('2027-07-03T08:00:00Z'), TZ)).toBe('2:00 PM');
  });
});
