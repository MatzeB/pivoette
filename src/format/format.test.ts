import { describe, expect, it } from 'vitest';
import { testMeta as meta } from '../test-meta';
import { deduceFormat, resolveFormatSpec } from './deduce';
import { resolveFormat } from './format';
import type { CellCtx } from './context';
import type { FormatSpec } from '../pivot/spec';
import type { DataFrame } from '../data/types';

function ctx(value: unknown): CellCtx {
  return {
    value,
    inputs: {},
    rowPath: [],
    colPath: [],
    column: { id: 'c', label: 'c', align: 'right' },
    frame: {} as DataFrame,
  };
}

const fmt = (spec: FormatSpec, value: unknown) =>
  resolveFormat(spec)(ctx(value));

describe('duration formatter', () => {
  it('auto-scales across ns / µs / ms / s / m with 3 sig figs', () => {
    const d: FormatSpec = { fnName: 'duration' };
    expect(fmt(d, 999)).toBe('999 ns');
    expect(fmt(d, 1_000)).toBe('1.00 µs');
    expect(fmt(d, 1_500_000)).toBe('1.50 ms');
    expect(fmt(d, 2_000_000_000)).toBe('2.00 s');
    expect(fmt(d, 90_000_000_000)).toBe('1.50 m'); // 90 s = 1.5 min
    expect(fmt(d, 3_600_000_000_000)).toBe('1.00 h');
  });

  it('honors a prefix (e.g. ± spread)', () => {
    expect(fmt({ fnName: 'duration', options: { prefix: '± ' } }, 5_000)).toBe(
      '± 5.00 µs',
    );
  });

  it('renders null as the empty display', () => {
    expect(resolveFormat({ fnName: 'duration' }, '—')(ctx(null))).toBe('—');
  });
});

describe('intl-backed formatters', () => {
  it('number with explicit + sign', () => {
    // Money is a plain 2-decimal number; the `$` is a unit label placed by the
    // table (see the currency-prefix cases in DataTable.test.tsx).
    const spec: FormatSpec = {
      fnName: 'number',
      options: { decimals: 2, signDisplay: 'exceptZero' },
    };
    expect(fmt(spec, 12.5)).toBe('+12.50');
    expect(fmt(spec, -3)).toBe('-3.00');
  });

  it('rejects a format that is not registered', () => {
    // `percent` was removed: a ratio is scaled by the column's `factor` and
    // labelled by `scale: ['percent']`, so no format transforms a number.
    expect(() => fmt({ fnName: 'percent' }, 0.125)).toThrow(/Unknown format/);
  });

  it('compact notation gives K/M/B', () => {
    expect(
      fmt({ fnName: 'number', options: { compact: true } }, 1_500_000),
    ).toBe('1.5M');
  });
});

describe('deduceFormat', () => {
  it('maps the known kinds to a format', () => {
    expect(deduceFormat(meta({ kind: 'price' }))).toEqual({
      fnName: 'number',
      options: { decimals: 2 },
    });
    expect(deduceFormat(meta({ kind: 'count' }))).toEqual({
      fnName: 'integer',
    });
    expect(deduceFormat(meta({ kind: 'percentage' }))).toEqual({
      fnName: 'number',
      options: { decimals: 1 },
    });
  });

  it('falls back to the unit when the kind has no rule', () => {
    // No kind at all: the `%` label still implies 1 decimal.
    expect(deduceFormat(meta({ scale: 'percent' }))).toEqual({
      fnName: 'number',
      options: { decimals: 1 },
    });
    expect(deduceFormat(meta({ unit: 'dollar' }))).toEqual({
      fnName: 'number',
      options: { decimals: 2 },
    });
    // A kind rule still wins over the unit fallback.
    expect(deduceFormat(meta({ kind: 'count', scale: 'percent' }))).toEqual({
      fnName: 'integer',
    });
  });

  it('returns nothing for an unmapped or absent kind', () => {
    expect(deduceFormat(meta({ kind: 'weekday' }))).toBeUndefined();
    expect(deduceFormat(meta({}))).toBeUndefined();
    expect(deduceFormat(undefined)).toBeUndefined();
    // A compound kind has its own key and is not mapped by default.
    expect(
      deduceFormat(meta({ kind: ['price', '1/duration'] })),
    ).toBeUndefined();
  });
});

describe('resolveFormatSpec', () => {
  const deduced = { fnName: 'number', options: { decimals: 1 } };

  it('merges options when both name the same built-in', () => {
    expect(
      resolveFormatSpec(
        { fnName: 'number', options: { signDisplay: 'exceptZero' } },
        deduced,
      ),
    ).toEqual({
      fnName: 'number',
      options: { decimals: 1, signDisplay: 'exceptZero' },
    });
  });

  it('lets the explicit option win on a conflict', () => {
    expect(
      resolveFormatSpec(
        { fnName: 'number', options: { decimals: 3 } },
        deduced,
      ),
    ).toEqual({ fnName: 'number', options: { decimals: 3 } });
  });

  it('replaces outright when the built-ins differ', () => {
    expect(resolveFormatSpec({ fnName: 'integer' }, deduced)).toEqual({
      fnName: 'integer',
    });
  });

  it('replaces outright for an inline fn or expression', () => {
    const spec = { expression: 'String(value)' };
    expect(resolveFormatSpec(spec, deduced)).toBe(spec);
  });

  it('adopts the deduced built-in for an options-only spec', () => {
    expect(
      resolveFormatSpec({ options: { signDisplay: 'exceptZero' } }, deduced),
    ).toEqual({
      fnName: 'number',
      options: { decimals: 1, signDisplay: 'exceptZero' },
    });
  });

  it('falls back to `number` for an options-only spec with no deduction', () => {
    expect(resolveFormatSpec({ options: { decimals: 3 } }, undefined)).toEqual({
      fnName: 'number',
      options: { decimals: 3 },
    });
  });

  it('uses the explicit format verbatim when inherit is false', () => {
    expect(
      resolveFormatSpec(
        { fnName: 'number', options: { signDisplay: 'exceptZero' } },
        deduced,
        false,
      ),
    ).toEqual({ fnName: 'number', options: { signDisplay: 'exceptZero' } });
  });

  it('opts out of deduction entirely when inherit is false', () => {
    expect(resolveFormatSpec(undefined, deduced, false)).toBeUndefined();
  });

  it('passes either side through when the other is absent', () => {
    expect(resolveFormatSpec(undefined, deduced)).toBe(deduced);
    expect(resolveFormatSpec({ fnName: 'integer' }, undefined)).toEqual({
      fnName: 'integer',
    });
    expect(resolveFormatSpec(undefined, undefined)).toBeUndefined();
  });
});

describe('resolveFormat with an options-only spec', () => {
  it('formats as `number` when handed options alone', () => {
    const fn = resolveFormat({ options: { decimals: 2 } });
    expect(fn({ value: 1.5 } as unknown as CellCtx)).toBe('1.50');
  });
});
