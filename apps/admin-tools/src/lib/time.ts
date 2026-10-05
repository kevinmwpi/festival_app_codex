/**
 * Calendar and time-zone helpers built on Intl only (no dependencies).
 *
 * Festival data stores absolute instants as ISO 8601 strings with an explicit
 * offset, and calendar dates as YYYY-MM-DD. Wall-clock conversions go through
 * the festival's IANA time zone so DST is handled correctly.
 */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const OFFSET_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const LOCAL_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const IANA_ZONE_PATTERN = /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+)$/;

const MS_PER_DAY = 86_400_000;

export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function parseDateParts(value: string): { year: number; month: number; day: number } | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && parseDateParts(value) !== null;
}

function dateToUtcMs(value: string): number {
  const parts = parseDateParts(value);
  if (!parts) {
    throw new Error(`Invalid date "${value}" (expected YYYY-MM-DD)`);
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function utcMsToDate(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Adds whole calendar days to a YYYY-MM-DD date. */
export function addDays(value: string, days: number): string {
  return utcMsToDate(dateToUtcMs(value) + days * MS_PER_DAY);
}

/** Calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((dateToUtcMs(to) - dateToUtcMs(from)) / MS_PER_DAY);
}

/** True for an IANA zone name the runtime knows (e.g. America/Chicago, UTC). */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !IANA_ZONE_PATTERN.test(value)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Parses an ISO 8601 timestamp that carries an explicit offset (Z or ±HH:MM). */
export function parseOffsetTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = OFFSET_TIMESTAMP_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  if (!isValidDateString(`${match[1]}-${match[2]}-${match[3]}`)) {
    return null;
  }
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  const offset = match[8];
  if (offset !== 'Z') {
    const offsetHours = Number(offset.slice(1, 3));
    const offsetMinutes = Number(offset.slice(4, 6));
    if (offsetHours > 14 || offsetMinutes > 59) {
      return null;
    }
  }
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** Parses a wall-clock time without offset: "YYYY-MM-DD HH:MM[:SS]" or with a "T". */
export function parseLocalDateTime(value: unknown): WallTime | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = LOCAL_DATETIME_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  const date = parseDateParts(`${match[1]}-${match[2]}-${match[3]}`);
  if (!date) {
    return null;
  }
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  return { ...date, hour, minute, second };
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock time of an instant in a time zone. */
export function wallTimeIn(instant: Date, timeZone: string): WallTime {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour === 24 ? 0 : values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function wallTimeToUtcMs(wall: WallTime): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

/** Offset of the zone from UTC at the given instant, in minutes (east positive). */
export function offsetMinutesAt(instant: Date, timeZone: string): number {
  const wholeSecondMs = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((wallTimeToUtcMs(wallTimeIn(new Date(wholeSecondMs), timeZone)) - wholeSecondMs) / 60_000);
}

/**
 * Instant at which the zone's clocks show `wall`. For a time skipped by a DST
 * jump the result is shifted forward by the jump; for a repeated time the
 * earlier instant is returned. Use `wallTimeExists` to detect skipped times.
 */
export function zonedTimeToInstant(wall: WallTime, timeZone: string): Date {
  const asUtc = wallTimeToUtcMs(wall);
  const firstOffset = offsetMinutesAt(new Date(asUtc), timeZone);
  let candidate = asUtc - firstOffset * 60_000;
  const secondOffset = offsetMinutesAt(new Date(candidate), timeZone);
  if (secondOffset !== firstOffset) {
    candidate = asUtc - secondOffset * 60_000;
  }
  // Prefer the earlier of two valid instants (fall-back overlap).
  const earlier = candidate - 3_600_000;
  if (sameWallTime(wallTimeIn(new Date(earlier), timeZone), wall)) {
    return new Date(earlier);
  }
  return new Date(candidate);
}

function sameWallTime(a: WallTime, b: WallTime): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

/** False when the wall time is skipped by a DST transition in the zone. */
export function wallTimeExists(wall: WallTime, timeZone: string): boolean {
  return sameWallTime(wallTimeIn(zonedTimeToInstant(wall, timeZone), timeZone), wall);
}

/** Formats an instant as YYYY-MM-DDTHH:MM:SS±HH:MM in the given zone. */
export function formatInstantInZone(instant: Date, timeZone: string): string {
  const wholeSecond = new Date(Math.floor(instant.getTime() / 1000) * 1000);
  const wall = wallTimeIn(wholeSecond, timeZone);
  const offset = offsetMinutesAt(wholeSecond, timeZone);
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  return (
    `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}` +
    `T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

/** Calendar date (YYYY-MM-DD) of an instant in a zone. */
export function localDateOf(instant: Date, timeZone: string): string {
  const wall = wallTimeIn(instant, timeZone);
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

/**
 * Festival day (YYYY-MM-DD) of an instant: times before `dayStartHour` belong
 * to the previous day (a 1:00 AM set is part of the night before).
 */
export function festivalDayOf(instant: Date, timeZone: string, dayStartHour = 6): string {
  const wall = wallTimeIn(instant, timeZone);
  const date = `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
  return wall.hour < dayStartHour ? addDays(date, -1) : date;
}

/** Shifts a wall-clock time by whole calendar days, keeping the clock time. */
export function shiftWallTimeByDays(wall: WallTime, days: number): WallTime {
  const date = addDays(`${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`, days);
  const parts = parseDateParts(date);
  if (!parts) {
    throw new Error(`Invalid shifted date ${date}`);
  }
  return { ...wall, ...parts };
}
