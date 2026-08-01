import { describe, expect, it } from 'vitest';
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
    const d: FormatSpec = { name: 'duration' };
    expect(fmt(d, 999)).toBe('999 ns');
    expect(fmt(d, 1_000)).toBe('1.00 µs');
    expect(fmt(d, 1_500_000)).toBe('1.50 ms');
    expect(fmt(d, 2_000_000_000)).toBe('2.00 s');
    expect(fmt(d, 90_000_000_000)).toBe('1.50 m'); // 90 s = 1.5 min
    expect(fmt(d, 3_600_000_000_000)).toBe('1.00 h');
  });

  it('honors a prefix (e.g. ± spread)', () => {
    expect(fmt({ name: 'duration', options: { prefix: '± ' } }, 5_000)).toBe(
      '± 5.00 µs',
    );
  });

  it('renders null as the empty display', () => {
    expect(resolveFormat({ name: 'duration' }, '—')(ctx(null))).toBe('—');
  });
});

describe('intl-backed formatters', () => {
  it('currency with explicit + sign', () => {
    const spec: FormatSpec = {
      name: 'currency',
      options: { decimals: 2, signDisplay: 'exceptZero' },
    };
    expect(fmt(spec, 12.5)).toBe('+$12.50');
    expect(fmt(spec, -3)).toBe('-$3.00');
  });

  it('percent with decimals', () => {
    expect(fmt({ name: 'percent', options: { decimals: 1 } }, 0.125)).toBe(
      '12.5%',
    );
  });

  it('compact notation gives K/M/B', () => {
    expect(fmt({ name: 'number', options: { compact: true } }, 1_500_000)).toBe(
      '1.5M',
    );
  });
});
