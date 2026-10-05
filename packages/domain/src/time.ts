/**
 * Festival-time helpers.
 *
 * Every schedule label in the app is rendered in the festival's own IANA time zone
 * (`festivals.timezone`), never the device's. If the JS runtime cannot resolve the time
 * zone (an `Intl.DateTimeFormat(..., { timeZone })` call throws), times fall back to
 * the device's zone and `timesAreDeviceLocal(tz)` reports `true` so the UI can say
 * "Times shown in your device's time zone".
 */

export const DEFAULT_DAY_START_HOUR = 6;

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;
const MAX_LISTED_DAYS = 62;

export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface FestivalTimeZoneInfo {
  /** The festival time zone as stored in the database. */
  timeZone: string;
  /** Short label such as `PDT` or `GMT+2` (runtime dependent — never assert a specific abbreviation). */
  label: string;
  /** `true` when the runtime cannot resolve `timeZone` and times are shown in device time. */
  timesAreDeviceLocal: boolean;
}

export interface FestivalDateRange {
  start_date: string;
  end_date: string;
  timezone: string;
}

export interface TimedItem {
  start_time: string;
}

const PARTS_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
};

const partsFormatterCache = new Map<string, Intl.DateTimeFormat | null>();

function createFormatter(timeZone: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat('en-US', timeZone ? { ...options, timeZone } : options);
  } catch {
    return null;
  }
}

function getPartsFormatter(timeZone: string): Intl.DateTimeFormat | null {
  if (!partsFormatterCache.has(timeZone)) {
    partsFormatterCache.set(timeZone, createFormatter(timeZone, PARTS_OPTIONS));
  }

  return partsFormatterCache.get(timeZone) ?? null;
}

/** Clears memoised formatters. Only needed by tests that stub `Intl.DateTimeFormat`. */
export function resetFestivalTimeCachesForTests(): void {
  partsFormatterCache.clear();
}

/** True when `timeZone` cannot be resolved by this runtime, so times are rendered in device time. */
export function timesAreDeviceLocal(timeZone: string | null | undefined): boolean {
  if (!timeZone) {
    return true;
  }

  return getPartsFormatter(timeZone) === null;
}

export function isDateOnly(value: string): boolean {
  return DATE_ONLY_PATTERN.test(value);
}

function toDate(value: string | Date): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid date value: ${String(value)}`);
  }

  return date;
}

function parseDateOnly(value: string): { year: number; month: number; day: number } {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }

  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function deviceParts(date: Date): ZonedDateParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

/**
 * Wall-clock parts of `value` in `timeZone` (24-hour clock; some engines emit `24` for midnight,
 * which is mapped to `0`). Falls back to device time when the zone cannot be resolved.
 */
export function getZonedParts(value: string | Date, timeZone: string): ZonedDateParts {
  const date = toDate(value);
  const formatter = timeZone ? getPartsFormatter(timeZone) : null;
  if (!formatter) {
    return deviceParts(date);
  }

  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatter.formatToParts(date)) {
    parts[part.type] = part.value;
  }

  const hour = Number(parts.hour);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: hour === 24 ? 0 : hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

function formatDayKeyFromUtc(utcMs: number): string {
  const date = new Date(utcMs);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function formatClock(hour: number, minute: number): string {
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** `9:30 PM` — the wall-clock time of `iso` in the festival time zone. */
export function formatFestivalTime(iso: string | Date, timeZone: string): string {
  const parts = getZonedParts(iso, timeZone);
  return formatClock(parts.hour, parts.minute);
}

/** `9:30 PM – 10:45 PM` in the festival time zone. */
export function formatFestivalTimeRange(startIso: string | Date, endIso: string | Date, timeZone: string): string {
  return `${formatFestivalTime(startIso, timeZone)} – ${formatFestivalTime(endIso, timeZone)}`;
}

const DEFAULT_DATE_OPTIONS: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };

/**
 * Formats a festival date.
 *
 * - Date-only strings (`YYYY-MM-DD`, e.g. `festivals.start_date` or a day key) are calendar dates and
 *   are formatted as such, independent of any time zone.
 * - Timestamps are formatted in the festival time zone (device time if it cannot be resolved).
 */
export function formatFestivalDate(
  value: string | Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_OPTIONS,
): string {
  if (typeof value === 'string' && isDateOnly(value)) {
    const { year, month, day } = parseDateOnly(value);
    const utcFormatter = createFormatter('UTC', options);
    if (utcFormatter) {
      return utcFormatter.format(new Date(Date.UTC(year, month - 1, day)));
    }
    // No time zone support at all: local midnight of the same calendar date formats to that date.
    return new Intl.DateTimeFormat('en-US', options).format(new Date(year, month - 1, day, 12));
  }

  const date = toDate(value);
  const formatter =
    (timeZone && !timesAreDeviceLocal(timeZone) ? createFormatter(timeZone, options) : null) ??
    new Intl.DateTimeFormat('en-US', options);
  return formatter.format(date);
}

/**
 * `YYYY-MM-DD` of the festival day `iso` belongs to. Festival days run from `dayStartHour`
 * (default 06:00) local time to the same hour the next morning, so a 1:00 AM set belongs to the
 * previous calendar day. Date-only input is returned unchanged.
 */
export function festivalDayKey(iso: string | Date, timeZone: string, dayStartHour = DEFAULT_DAY_START_HOUR): string {
  if (typeof iso === 'string' && isDateOnly(iso)) {
    return iso;
  }

  const parts = getZonedParts(iso, timeZone);
  const calendarDayUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  return formatDayKeyFromUtc(parts.hour < dayStartHour ? calendarDayUtc - MS_PER_DAY : calendarDayUtc);
}

/**
 * Wall-clock minutes elapsed since `dayStartHour` on the festival day `iso` belongs to
 * (0 at 06:00, 1140 at 01:00 the next morning). Wall-clock based, so it lines up with hour labels.
 * On a DST fall-back night the repeated hour maps to the same values twice (02:30 CEST and
 * 02:30 CET both give 1230); for item heights use `festivalDayMinutesRange`, which uses the real
 * elapsed duration.
 */
export function minutesIntoFestivalDay(iso: string | Date, timeZone: string, dayStartHour = DEFAULT_DAY_START_HOUR): number {
  const parts = getZonedParts(iso, timeZone);
  const hoursIntoDay = (parts.hour - dayStartHour + 24) % 24;
  return hoursIntoDay * 60 + parts.minute;
}

/**
 * Timeline placement of an item on the festival day it starts on.
 *
 * - `startMinutes` is wall-clock based (`minutesIntoFestivalDay`) so blocks line up with hour labels.
 * - `endMinutes = startMinutes + real elapsed minutes`, so heights are correct across the day boundary
 *   (it keeps counting past 1440 instead of wrapping) and across DST changes: a two-hour set over a
 *   fall-back night is two hours tall, not one (or zero). Because labels follow the wall clock, two
 *   items inside the repeated fall-back hour can share a start position and overlap, and blocks after
 *   a spring-forward gap end one hour "early" relative to the labels; durations are always truthful.
 */
export function festivalDayMinutesRange(
  startIso: string | Date,
  endIso: string | Date,
  timeZone: string,
  dayStartHour = DEFAULT_DAY_START_HOUR,
): { dayKey: string; startMinutes: number; endMinutes: number } {
  const dayKey = festivalDayKey(startIso, timeZone, dayStartHour);
  const startMinutes = minutesIntoFestivalDay(startIso, timeZone, dayStartHour);
  const durationMinutes = Math.round((toDate(endIso).getTime() - toDate(startIso).getTime()) / 60_000);
  return { dayKey, startMinutes, endMinutes: startMinutes + Math.max(0, durationMinutes) };
}

/**
 * Day keys to show as schedule tabs: every calendar day from `start_date` to `end_date` (inclusive)
 * plus the festival day of any set that falls outside that range. Sorted ascending.
 */
export function listFestivalDays(
  festival: FestivalDateRange,
  sets: TimedItem[] = [],
  dayStartHour = DEFAULT_DAY_START_HOUR,
): string[] {
  const days = new Set<string>();

  if (isDateOnly(festival.start_date) && isDateOnly(festival.end_date)) {
    const start = parseDateOnly(festival.start_date);
    const end = parseDateOnly(festival.end_date);
    const startUtc = Date.UTC(start.year, start.month - 1, start.day);
    const endUtc = Date.UTC(end.year, end.month - 1, end.day);
    for (let current = startUtc, count = 0; current <= endUtc && count < MAX_LISTED_DAYS; current += MS_PER_DAY, count += 1) {
      days.add(formatDayKeyFromUtc(current));
    }
  }

  for (const set of sets) {
    try {
      days.add(festivalDayKey(set.start_time, festival.timezone, dayStartHour));
    } catch {
      // Ignore malformed timestamps rather than breaking the whole schedule.
    }
  }

  return [...days].sort();
}

/**
 * Short label for the festival time zone at `at` (default now), e.g. `PDT` or `GMT+2`.
 * Falls back to the device zone's label when the festival zone cannot be resolved.
 */
export function festivalTimeZoneLabel(timeZone: string, at: Date = new Date()): string {
  const options: Intl.DateTimeFormatOptions = { timeZoneName: 'short', hourCycle: 'h23' };
  const formatter =
    (timeZone && !timesAreDeviceLocal(timeZone) ? createFormatter(timeZone, options) : null) ??
    createFormatter(undefined, options);
  const label = formatter?.formatToParts(at).find((part) => part.type === 'timeZoneName')?.value;
  return label ?? (timeZone || 'local time');
}

export function getFestivalTimeZoneInfo(timeZone: string, at: Date = new Date()): FestivalTimeZoneInfo {
  return {
    timeZone,
    label: festivalTimeZoneLabel(timeZone, at),
    timesAreDeviceLocal: timesAreDeviceLocal(timeZone),
  };
}
