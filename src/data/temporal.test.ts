import { describe, expect, it } from 'vitest';
import {
  decodeTime,
  firstDayOfWeek,
  isoWeek,
  parseTime,
  resolveTimeZone,
  temporalHelpers,
  timeParts,
  zoneOffset,
} from './temporal';
import { normalizeMeta } from './meta';
import { unitLabels } from './meta';
import type { ColumnMetaInput } from './meta';

const meta = (input: ColumnMetaInput) =>
  normalizeMeta({ dataName: 't', type: 'string', category: 'index' }, input);

const rfc = meta({ encoding: 'rfc3339' });
/** 23:00 UTC on a Saturday — Sunday morning in Tokyo. */
const LATE_SATURDAY = '2026-03-14T23:00:00Z';

describe('encoding', () => {
  it('deduces the timestamp kind, and survives a round-trip', () => {
    expect(rfc.kind).toEqual(['timestamp']);
    expect(rfc.encoding).toBe('rfc3339');
    const again = normalizeMeta(
      { dataName: 't', type: 'string', category: 'index' },
      JSON.parse(JSON.stringify(rfc)) as ColumnMetaInput,
    );
    expect(again).toEqual(rfc);
  });

  it('does not overwrite an explicit kind', () => {
    expect(meta({ encoding: 'rfc3339', kind: ['date'] }).kind).toEqual([
      'date',
    ]);
  });

  it('stays out of the unit label', () => {
    // The reason it is not a `unit` entry: it would be rendered on every cell.
    expect(unitLabels(rfc).full).toBe('');
  });
});

describe('decodeTime', () => {
  it('decodes declared text', () => {
    expect(decodeTime(LATE_SATURDAY, rfc)).toBe(Date.parse(LATE_SATURDAY));
  });

  it('never guesses for an undeclared column', () => {
    const plain = meta({});
    expect(decodeTime(LATE_SATURDAY, plain)).toBeNull();
    expect(decodeTime(1_773_529_200_000, plain)).toBeNull();
    expect(decodeTime(LATE_SATURDAY, undefined)).toBeNull();
  });

  it('passes nulls and unparseable text through as null', () => {
    expect(decodeTime(null, rfc)).toBeNull();
    expect(decodeTime('not a date', rfc)).toBeNull();
    expect(parseTime('not a date')).toBeNull();
  });
});

describe('zones', () => {
  it('resolves auto to the runtime zone', () => {
    expect(resolveTimeZone('auto')).toBeUndefined();
    expect(resolveTimeZone(undefined)).toBeUndefined();
    expect(resolveTimeZone('Asia/Tokyo')).toBe('Asia/Tokyo');
  });

  it('puts an instant on different days in different zones', () => {
    const ms = decodeTime(LATE_SATURDAY, rfc)!;
    expect(timeParts(ms, 'UTC')).toMatchObject({ day: 14, isoWeekday: 6 });
    expect(timeParts(ms, 'Asia/Tokyo')).toMatchObject({
      day: 15,
      isoWeekday: 7,
    });
  });
});

describe('zoneOffset', () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const at = (iso: string, tz: string) => zoneOffset(Date.parse(iso), tz);

  it('is zero for UTC', () => {
    expect(at('2026-03-14T23:00:00Z', 'UTC')).toBe(0);
  });

  it('follows daylight saving', () => {
    expect(at('2026-01-15T12:00:00Z', 'Europe/Berlin')).toBe(HOUR);
    expect(at('2026-07-15T12:00:00Z', 'Europe/Berlin')).toBe(2 * HOUR);
  });

  it('handles zones that are not on the hour', () => {
    // The reason `TimeParts` carries minutes: rounding to whole hours would
    // put every Indian tick 30 minutes out.
    expect(at('2026-03-14T23:00:00Z', 'Asia/Kolkata')).toBe(
      5 * HOUR + 30 * MIN,
    );
    expect(at('2026-03-14T23:00:00Z', 'Asia/Kathmandu')).toBe(
      5 * HOUR + 45 * MIN,
    );
  });

  it('handles a half-hour daylight-saving shift', () => {
    // Lord Howe moves by 30 minutes, not an hour — the case that a
    // whole-hour offset gets wrong even in a zone that starts on the half.
    expect(at('2026-07-15T00:00:00Z', 'Australia/Lord_Howe')).toBe(
      10 * HOUR + 30 * MIN,
    );
    expect(at('2026-01-15T00:00:00Z', 'Australia/Lord_Howe')).toBe(11 * HOUR);
  });

  it('ignores the instant’s own sub-second remainder', () => {
    const ms = Date.parse('2026-07-15T12:00:00Z') + 837;
    expect(zoneOffset(ms, 'Europe/Berlin')).toBe(2 * HOUR);
  });

  it('inverts timeParts: parts read as UTC, minus the offset', () => {
    const ms = Date.parse('2026-07-15T12:34:56Z');
    const p = timeParts(ms, 'Asia/Kolkata');
    const wall = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
    );
    expect(wall - zoneOffset(ms, 'Asia/Kolkata')).toBe(ms);
  });
});

describe('firstDayOfWeek', () => {
  it('reads the locale', () => {
    expect(firstDayOfWeek('en-US')).toBe(7); // Sunday
    expect(firstDayOfWeek('de-DE')).toBe(1); // Monday
    expect(firstDayOfWeek('ar-EG')).toBe(6); // Saturday
  });
});

describe('helpers', () => {
  const ms = Date.parse(LATE_SATURDAY);

  it('numbers the weekday from the locale first day', () => {
    // Saturday: index 6 where the week starts Sunday, 5 where it starts Monday.
    expect(temporalHelpers('en-US', 'UTC').weekday!(ms)).toBe(6);
    expect(temporalHelpers('de-DE', 'UTC').weekday!(ms)).toBe(5);
    // ISO is the same number everywhere.
    expect(temporalHelpers('en-US', 'UTC').isoWeekday!(ms)).toBe(6);
    expect(temporalHelpers('de-DE', 'UTC').isoWeekday!(ms)).toBe(6);
  });

  it('follows the zone across a day boundary', () => {
    expect(temporalHelpers('en-US', 'UTC').weekday!(ms)).toBe(6); // Sat
    expect(temporalHelpers('en-US', 'Asia/Tokyo').weekday!(ms)).toBe(0); // Sun
  });

  it('extracts the other parts', () => {
    const h = temporalHelpers('en-US', 'UTC');
    expect(h.year!(ms)).toBe(2026);
    expect(h.quarter!(ms)).toBe(1);
    expect(h.month!(ms)).toBe(3);
    expect(h.day!(ms)).toBe(14);
    expect(h.hour!(ms)).toBe(23);
    expect(h.dateOnly!(ms)).toBe('2026-03-14');
    expect(h.isoWeek!(ms)).toBe(11);
  });

  it('accepts raw strings and returns null for null', () => {
    const h = temporalHelpers('en-US', 'UTC');
    expect(h.weekday!(LATE_SATURDAY)).toBe(6);
    expect(h.weekday!(null)).toBeNull();
  });

  it('numbers ISO weeks from the first Thursday', () => {
    expect(isoWeek(Date.parse('2026-01-01T12:00:00Z'), 'UTC')).toBe(1);
    expect(isoWeek(Date.parse('2026-12-31T12:00:00Z'), 'UTC')).toBe(53);
  });
});
