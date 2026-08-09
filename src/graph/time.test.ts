import { describe, expect, it } from 'vitest';
import { firstDayOfWeek, timeParts } from '../data/temporal';
import {
  addTime,
  chooseInterval,
  floorTime,
  timeScale,
  timeTicks,
} from './time';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const at = (iso: string) => Date.parse(iso);
/** Every assertion pins its zone; the runner's own is never in play. */
const iso = (ms: number) => new Date(ms).toISOString();

describe('chooseInterval', () => {
  const pick = (span: number) => {
    const { unit, every } = chooseInterval(span, 5);
    return `${every} ${unit}`;
  };

  it('climbs the calendar as the span grows', () => {
    expect(pick(3 * SECOND)).toBe('500 millisecond');
    expect(pick(3 * MINUTE)).toBe('30 second');
    expect(pick(3 * HOUR)).toBe('30 minute');
    expect(pick(3 * DAY)).toBe('12 hour');
    expect(pick(90 * DAY)).toBe('1 month');
    expect(pick(3 * 365 * DAY)).toBe('6 month');
    // The rungs reach a whole year, so nothing between a quarter and the
    // numeric year steps falls back to quarters.
    expect(pick(4 * 365 * DAY)).toBe('1 year');
  });

  it('steps years on the 1/2/5 rule once the ladder runs out', () => {
    expect(pick(30 * 365.25 * DAY)).toBe('5 year');
    expect(pick(120 * 365.25 * DAY)).toBe('20 year');
  });

  it('answers the finest rung for a degenerate span', () => {
    expect(chooseInterval(0, 5).unit).toBe('millisecond');
    expect(chooseInterval(NaN, 5).unit).toBe('millisecond');
  });
});

describe('floorTime', () => {
  it('floors to local midnight, not to UTC midnight', () => {
    // India is +05:30, so its midnight is 18:30 UTC the day before. A design
    // that rounded the offset to whole hours would answer 19:00 or 18:00.
    const ms = at('2026-03-14T12:00:00Z');
    expect(iso(floorTime(ms, 'day', 'Asia/Kolkata'))).toBe(
      '2026-03-13T18:30:00.000Z',
    );
    expect(iso(floorTime(ms, 'day', 'UTC'))).toBe('2026-03-14T00:00:00.000Z');
  });

  it('lands on local midnight across a half-hour daylight shift', () => {
    // Lord Howe moves by 30 minutes. +11:00 in January, +10:30 in July.
    expect(
      iso(floorTime(at('2026-01-15T05:00:00Z'), 'day', 'Australia/Lord_Howe')),
    ).toBe('2026-01-14T13:00:00.000Z');
    expect(
      iso(floorTime(at('2026-07-15T05:00:00Z'), 'day', 'Australia/Lord_Howe')),
    ).toBe('2026-07-14T13:30:00.000Z');
  });

  it('handles the day daylight saving skips an hour', () => {
    // 2026-03-29 in Berlin: 02:00 never happens. Local midnight is 23:00 UTC.
    const ms = at('2026-03-29T12:00:00Z');
    expect(iso(floorTime(ms, 'day', 'Europe/Berlin'))).toBe(
      '2026-03-28T23:00:00.000Z',
    );
  });

  it('handles the day daylight saving repeats an hour', () => {
    const ms = at('2026-10-25T12:00:00Z');
    expect(iso(floorTime(ms, 'day', 'Europe/Berlin'))).toBe(
      '2026-10-24T22:00:00.000Z',
    );
  });

  it('floors months and years to the first of the period', () => {
    const ms = at('2026-03-14T12:34:56Z');
    expect(iso(floorTime(ms, 'month', 'UTC'))).toBe('2026-03-01T00:00:00.000Z');
    expect(iso(floorTime(ms, 'year', 'UTC'))).toBe('2026-01-01T00:00:00.000Z');
  });

  it('floors the week to the locale’s first day', () => {
    // 2026-03-14 is a Saturday.
    const ms = at('2026-03-14T12:00:00Z');
    const monday = floorTime(ms, 'week', 'UTC', firstDayOfWeek('de-DE'));
    const sunday = floorTime(ms, 'week', 'UTC', firstDayOfWeek('en-US'));
    expect(iso(monday)).toBe('2026-03-09T00:00:00.000Z');
    expect(iso(sunday)).toBe('2026-03-08T00:00:00.000Z');
  });
});

describe('addTime', () => {
  it('keeps a day at local midnight across a daylight boundary', () => {
    // 2026-10-25 is the 25-hour day in Berlin: plain millisecond addition
    // would land the next tick on 23:00 rather than midnight.
    const start = floorTime(at('2026-10-25T12:00:00Z'), 'day', 'Europe/Berlin');
    const next = addTime(start, 'day', 1, 'Europe/Berlin');
    expect(timeParts(next, 'Europe/Berlin')).toMatchObject({
      day: 26,
      hour: 0,
    });
    expect(next - start).toBe(25 * HOUR);
  });

  it('treats an hour as an hour, boundary or not', () => {
    const ms = at('2026-10-25T00:00:00Z');
    expect(addTime(ms, 'hour', 3, 'Europe/Berlin') - ms).toBe(3 * HOUR);
  });

  it('adds calendar months and years', () => {
    const ms = at('2026-01-31T00:00:00Z');
    // 31 January + 1 month overflows into March, as Date.UTC does.
    expect(iso(addTime(ms, 'month', 1, 'UTC'))).toBe(
      '2026-03-03T00:00:00.000Z',
    );
    expect(iso(addTime(ms, 'year', 1, 'UTC'))).toBe('2027-01-31T00:00:00.000Z');
  });
});

describe('timeTicks', () => {
  it('starts on a boundary inside the range, not on the range’s own start', () => {
    const lo = at('2026-03-14T04:37:00Z');
    const hi = at('2026-03-16T04:37:00Z');
    const { ticks, interval } = timeTicks(lo, hi, 5, 'UTC');
    expect(interval).toMatchObject({ unit: 'hour', every: 12 });
    expect(ticks.every((t) => t >= lo && t <= hi)).toBe(true);
    expect(iso(ticks[0]!)).toBe('2026-03-14T12:00:00.000Z');
  });

  it('rises monotonically and stays bounded', () => {
    const lo = at('2020-01-01T00:00:00Z');
    const hi = at('2030-01-01T00:00:00Z');
    const { ticks } = timeTicks(lo, hi, 6, 'UTC');
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks.length).toBeLessThan(500);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]!).toBeGreaterThan(ticks[i - 1]!);
    }
  });

  it('lands multi-year ticks on round years', () => {
    const { ticks } = timeTicks(
      at('2013-06-01T00:00:00Z'),
      at('2043-06-01T00:00:00Z'),
      5,
      'UTC',
    );
    const years = ticks.map((t) => timeParts(t, 'UTC').year);
    expect(years).toEqual([2015, 2020, 2025, 2030, 2035, 2040]);
  });

  it('keeps daily ticks on local midnight in a half-hour zone', () => {
    const { ticks } = timeTicks(
      at('2026-03-01T00:00:00Z'),
      at('2026-03-08T00:00:00Z'),
      5,
      'Asia/Kolkata',
    );
    for (const t of ticks) {
      expect(timeParts(t, 'Asia/Kolkata')).toMatchObject({
        hour: 0,
        minute: 0,
      });
    }
  });

  it('moves the weekly gridlines with the locale', () => {
    const lo = at('2026-03-01T00:00:00Z');
    const hi = at('2026-04-05T00:00:00Z');
    const de = timeTicks(lo, hi, 5, 'UTC', firstDayOfWeek('de-DE'));
    const us = timeTicks(lo, hi, 5, 'UTC', firstDayOfWeek('en-US'));
    expect(de.interval.unit).toBe('week');
    expect(de.ticks.every((t) => timeParts(t, 'UTC').isoWeekday === 1)).toBe(
      true,
    );
    expect(us.ticks.every((t) => timeParts(t, 'UTC').isoWeekday === 7)).toBe(
      true,
    );
  });

  it('returns nothing for an impossible range', () => {
    expect(timeTicks(NaN, NaN, 5, 'UTC').ticks).toEqual([]);
    expect(
      timeTicks(
        at('2026-03-02T00:00:00Z'),
        at('2026-03-01T00:00:00Z'),
        5,
        'UTC',
      ).ticks,
    ).toEqual([]);
  });
});

describe('the ladder has no gaps a reader would see', () => {
  const DAY = 86400000;
  const lo = Date.parse('2016-01-01T00:00:00Z');

  it('never explodes into an unreadable row of labels', () => {
    // The month rungs used to stop at a quarter while the year branch only
    // engaged at a full year, so a four-year span drew sixteen `Mon YYYY`
    // labels — nothing downstream thins them.
    for (const years of [0.5, 1, 1.5, 2, 3, 4, 4.9, 5, 10, 30]) {
      const span = years * 365.25 * DAY;
      const { ticks } = timeTicks(lo, lo + span, 5, 'UTC');
      expect(ticks.length, `${years}y`).toBeGreaterThan(2);
      expect(ticks.length, `${years}y`).toBeLessThanOrEqual(8);
    }
  });
});

describe('timeScale', () => {
  it('rounds its domain out to calendar boundaries', () => {
    const s = timeScale({
      domain: [at('2026-03-14T04:37:00Z'), at('2026-03-16T09:12:00Z')],
      range: [0, 400],
      timeZone: 'UTC',
    });
    expect(iso(s.domain[0])).toBe('2026-03-14T00:00:00.000Z');
    expect(s.domain[1]).toBeGreaterThanOrEqual(at('2026-03-16T09:12:00Z'));
  });

  it('maps and inverts', () => {
    const lo = at('2026-01-01T00:00:00Z');
    const hi = at('2027-01-01T00:00:00Z');
    const s = timeScale({
      domain: [lo, hi],
      range: [0, 365],
      timeZone: 'UTC',
      nice: false,
    });
    expect(s.at(lo)).toBe(0);
    expect(s.at(hi)).toBe(365);
    expect(s.invert(0)).toBe(lo);
  });

  it('reports the interval it chose, for the axis to format against', () => {
    const s = timeScale({
      domain: [at('2020-01-01T00:00:00Z'), at('2030-01-01T00:00:00Z')],
      range: [0, 400],
      timeZone: 'UTC',
    });
    const t = s.ticks(5);
    expect(t.interval?.unit).toBe('year');
    expect(t.decimals).toBe(0);
    expect(t.ticks[0]!.pos).toBeGreaterThanOrEqual(0);
  });
});
