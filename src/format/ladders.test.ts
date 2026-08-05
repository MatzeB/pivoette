import { describe, expect, it } from 'vitest';
import { normalizeMeta, storedMagnitude, unitLabels } from '../data/meta';
import type { ColumnMetaInput } from '../data/meta';
import {
  chooseStep,
  getLadder,
  hasLadder,
  ladderIds,
  metaForStep,
  registerLadder,
  representative,
} from './ladders';

/** A normalized column meta from the shorthand a view would write. */
function meta(input: ColumnMetaInput) {
  return normalizeMeta(
    { dataName: 'v', type: 'float', category: 'data' },
    input,
  );
}

const nanoseconds = meta({
  kind: ['duration'],
  unit: ['second'],
  scale: ['nano'],
});

/** What a column of these stored values ends up labelled and scaled by. */
function shown(values: number[], m = nanoseconds, ladder = 'duration') {
  const chosen = chooseStep(values, m, ladder)!;
  const stepMeta = metaForStep(m, chosen.step);
  return {
    label: unitLabels(stepMeta).full,
    at: values.map((v) => v * chosen.factor),
  };
}

describe('storedMagnitude', () => {
  it('reads what the declared unit and scale are worth', () => {
    expect(storedMagnitude(nanoseconds)).toBe(1e-9);
    expect(storedMagnitude(meta({ unit: ['second'] }))).toBe(1);
    // A unit that is a multiple rather than a scale.
    expect(storedMagnitude(meta({ unit: ['minute'] }))).toBe(60);
    expect(storedMagnitude(meta({ unit: ['byte'], scale: ['mebi'] }))).toBe(
      2 ** 20,
    );
  });

  it('declines where there is no single magnitude to scale along', () => {
    // Compound: `tok/s` is a rate, not a size.
    expect(
      storedMagnitude(meta({ unit: ['token', '1/second'] })),
    ).toBeUndefined();
    // Squared.
    expect(storedMagnitude(meta({ unit: ['meter', 'meter'] }))).toBeUndefined();
    // Unitless.
    expect(storedMagnitude(meta({}))).toBeUndefined();
  });

  it('declines an unregistered scale, which stays a usable label', () => {
    const odd = meta({ unit: ['second'], scale: ['sqrtFortnight'] });
    expect(storedMagnitude(odd)).toBeUndefined();
    // The point of keeping scales as names: it still renders.
    expect(unitLabels(odd).full).toBe('sqrtFortnights');
  });
});

describe('representative value', () => {
  it('resists an outlier at either end', () => {
    // Nine values around 5 and one enormous one: the cluster holds.
    expect(representative([4, 5, 5, 5, 6, 5, 4, 6, 5, 5_000_000])).toBe(5);
    // …and one tiny one, which a plain minimum would follow all the way down.
    expect(representative([0.000001, 5, 5, 5, 6, 5, 4, 6, 5, 5])).toBe(5);
  });

  it('picks from the low end, not the middle', () => {
    // A column spanning orders of magnitude is scaled for its small values:
    // `0.011` reads worse than `11,000`, so the big end is what gives. The
    // median of these eight is 100; the quartile is 3.
    expect(representative([1, 2, 3, 4, 100, 200, 300, 400])).toBe(3);
  });

  it('ignores nulls, non-numbers and zeroes', () => {
    expect(representative([null, 'x', 0, 7, 7])).toBe(7);
    expect(representative([null, 0, 0])).toBeUndefined();
    expect(representative([])).toBeUndefined();
  });

  it('measures magnitude, not sign', () => {
    expect(representative([-8, -8, -8])).toBe(8);
  });
});

describe('chooseStep', () => {
  it('puts the representative value in [1, 1000)', () => {
    expect(shown([999]).label).toBe('ns');
    expect(shown([1_000]).label).toBe('µs');
    expect(shown([1_500_000]).label).toBe('ms');
    expect(shown([2_000_000_000]).label).toBe('s');
  });

  it('climbs onto the units SI prefixes cannot express', () => {
    // 90 s is 1.5 minutes — 60×, which is no prefix at all.
    expect(shown([90_000_000_000]).label).toBe('min');
    expect(shown([3_600_000_000_000]).label).toBe('h');
  });

  it('sticks to the outermost rung rather than inventing one', () => {
    expect(shown([1]).label).toBe('ns'); // below the bottom
    expect(shown([1e20]).label).toBe('d'); // above the top
  });

  it('scales the values by the step it chose', () => {
    expect(shown([4_340]).at[0]).toBeCloseTo(4.34, 10);
    expect(shown([90_000_000_000]).at[0]).toBeCloseTo(1.5, 10);
  });

  it('starts from the scale the column declares, not from 1', () => {
    // The same 4.34 µs, stored as microseconds instead of nanoseconds.
    const micro = meta({
      kind: ['duration'],
      unit: ['second'],
      scale: ['micro'],
    });
    expect(shown([4.34], micro).label).toBe('µs');
    expect(shown([4.34], micro).at[0]).toBeCloseTo(4.34, 10);
  });

  it('declines a column it cannot measure', () => {
    expect(chooseStep([1, 2], meta({}), 'si')).toBeUndefined();
    expect(chooseStep([], nanoseconds, 'duration')).toBeUndefined();
  });

  it('uses SI prefixes for anything else', () => {
    const tokens = meta({ unit: ['token'] });
    expect(shown([8_700_000], tokens, 'si').label).toBe('Mtok');
    expect(shown([8_700_000], tokens, 'si').at[0]).toBeCloseTo(8.7, 10);
  });

  it('uses binary prefixes for bytes', () => {
    const bytes = meta({ kind: ['memory'], unit: ['byte'] });
    expect(shown([5 * 2 ** 20], bytes, 'bytes').label).toBe('MiB');
    expect(shown([5 * 2 ** 20], bytes, 'bytes').at[0]).toBeCloseTo(5, 10);
  });
});

describe('metaForStep', () => {
  it('re-derives the short label rather than carrying the old one over', () => {
    const stepped = metaForStep(nanoseconds, {
      magnitude: 1e-6,
      scale: 'micro',
    });
    expect(stepped.scale).toEqual(['micro']);
    expect(stepped.scaleShort).toEqual(['µ']);
    expect(unitLabels(stepped).full).toBe('µs');
  });

  it('returns a new object, since unit labels memoize on identity', () => {
    const stepped = metaForStep(nanoseconds, {
      magnitude: 1e-6,
      scale: 'micro',
    });
    expect(stepped).not.toBe(nanoseconds);
    expect(unitLabels(nanoseconds).full).toBe('ns');
  });

  it('swaps the unit itself when the step changes it', () => {
    const stepped = metaForStep(nanoseconds, { magnitude: 60, unit: 'minute' });
    expect(unitLabels(stepped).full).toBe('min');
  });
});

describe('the registry', () => {
  it('ships the built-ins and accepts more', () => {
    expect(ladderIds()).toEqual(
      expect.arrayContaining(['si', 'duration', 'bytes']),
    );
    registerLadder('half-steps', {
      steps: [{ magnitude: 4 }, { magnitude: 1 }, { magnitude: 2 }],
    });
    expect(hasLadder('half-steps')).toBe(true);
    // Sorted on the way in, so a caller need not order its own rungs.
    expect(getLadder('half-steps').steps.map((s) => s.magnitude)).toEqual([
      1, 2, 4,
    ]);
  });

  it('names an unknown ladder rather than silently doing nothing', () => {
    expect(hasLadder('nope')).toBe(false);
    expect(() => getLadder('nope')).toThrow(/Unknown scale ladder "nope"/);
  });
});

describe('a unit that is a multiple of its base', () => {
  const minutes = meta({ kind: ['duration'], unit: ['minute'] });

  it('relabels a converted value with the unit it was converted to', () => {
    // `storedMagnitude` folds the 60 in, so the ladder works in seconds. The
    // label has to follow: 0.5 minutes is 30 s, never "30 min".
    expect(shown([0.5], minutes)).toEqual({ label: 's', at: [30] });
    // Far enough down and it is still seconds, scaled.
    expect(shown([0.0005], minutes)).toEqual({ label: 'ms', at: [30] });
  });

  it('stays on its own rungs when it climbs back to minutes', () => {
    expect(shown([5], minutes)).toEqual({ label: 'min', at: [5] });
  });

  it('declines a ladder whose rungs cannot name the base unit', () => {
    // `si` is SI prefixes over whatever the column says it holds, which is
    // exactly the assumption a minutes column breaks. Better unscaled than
    // relabelled wrongly.
    expect(chooseStep([0.5], minutes, 'si')).toBeUndefined();
    // A column already in its base unit is unaffected.
    expect(chooseStep([0.5], meta({ unit: ['second'] }), 'si')).toBeDefined();
  });
});
