import { describe, expect, it } from 'vitest';
import { testMeta } from '../test-meta';
import { fromRows } from '../data/import';
import { tickFormatter, tickSpec } from './axis-format';

const frame = fromRows([{ v: 1 }]);
const render = (
  meta: Parameters<typeof tickFormatter>[0],
  rescaled: boolean,
  decimals: number,
  values: number[],
) => {
  const fn = tickFormatter(
    meta,
    frame,
    tickSpec(meta, rescaled, decimals, 'en-US'),
  );
  return values.map(fn);
};

describe('tickSpec', () => {
  it('takes its precision from the step, not from the column', () => {
    // The column deduces two decimals, which describes one price. An axis
    // stepping in hundreds gains nothing from `200.00`.
    const money = testMeta({ kind: 'price', unit: 'dollar' });
    expect(render(money, false, 0, [0, 200, 1000])).toEqual([
      '0',
      '200',
      '1,000',
    ]);
  });

  it('still shows the digits a fractional step needs', () => {
    const money = testMeta({ kind: 'price', unit: 'dollar' });
    expect(render(money, false, 2, [0.25, 0.5])).toEqual(['0.25', '0.50']);
  });

  it('does the same for a percentage, which deduces one decimal', () => {
    const pct = testMeta({ kind: 'percentage' });
    expect(render(pct, false, 0, [0, 25, 50])).toEqual(['0', '25', '50']);
  });

  it('leaves a format that answers with a name alone', () => {
    // A step has no opinion about `Mar`; only about how many digits to print.
    const month = testMeta({ kind: 'month', type: 'int' });
    expect(render(month, false, 0, [1, 3])).toEqual(['Jan', 'Mar']);
  });

  it('ignores the column entirely once a ladder has moved the point', () => {
    const money = testMeta({ kind: 'price', unit: 'dollar', scale: 'kilo' });
    expect(render(money, true, 1, [372.9])).toEqual(['372.9']);
  });

  it('groups thousands, which is what the margin has to allow for', () => {
    const plain = testMeta({});
    expect(render(plain, false, 0, [1_000_000])).toEqual(['1,000,000']);
  });
});
