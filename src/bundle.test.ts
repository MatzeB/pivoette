import { describe, expect, it } from 'vitest';
import { describeFrame, loadBundle, loadRows, validateBundle } from './bundle';
import { fromRows } from './data/import';
import type { PivoetteBundle } from './bundle';

const rows = [
  { region: 'EU', quarter: 'Q1', revenue: 120, note: null },
  { region: 'US', quarter: 'Q1', revenue: 340, note: 'x' },
];
const frame = fromRows(rows);
const view = {
  rows: ['region'],
  columns: ['quarter'],
  values: [{ id: 'rev', field: 'revenue', agg: 'sum', label: 'Revenue' }],
};

describe('loading data', () => {
  it('takes inline rows or inline csv', async () => {
    expect(await loadRows({ rows })).toBe(rows);
    expect(await loadRows({ csv: 'a,b\n1,x\n' })).toEqual([{ a: 1, b: 'x' }]);
  });

  it('refuses a bundle with no source', async () => {
    await expect(loadRows({})).rejects.toThrow(/rows.*csv.*url/);
  });

  it('builds a frame with the bundle metadata applied', async () => {
    const bundle: PivoetteBundle = {
      data: { rows },
      meta: { revenue: { kind: ['price'], unit: ['dollar'] } },
      view,
    };
    const built = await loadBundle(bundle);
    expect(built.columnByName.get('revenue')!.meta.unitShort).toEqual(['$']);
  });
});

describe('validation', () => {
  it('accepts a good bundle', () => {
    expect(validateBundle({ data: { rows }, view }, frame)).toEqual({
      ok: true,
      problems: [],
    });
  });

  it('reports every problem at once', () => {
    const { ok, problems } = validateBundle(
      {
        data: { rows, csv: 'a\n1' },
        view: {
          rows: ['nope'],
          columns: [],
          values: [
            { id: 'a', field: 'missing', agg: 'sum' },
            { id: 'a', field: 'note', agg: 'sum' },
            { id: 'c', field: 'revenue', agg: 'bogus' },
          ],
        },
      },
      frame,
    );
    expect(ok).toBe(false);
    // One pass should surface all of them, not just the first.
    expect(problems.some((p) => p.includes('more than one source'))).toBe(true);
    expect(problems.some((p) => p.includes('no column named "nope"'))).toBe(true);
    expect(problems.some((p) => p.includes('no column named "missing"'))).toBe(true);
    expect(problems.some((p) => p.includes('duplicate id'))).toBe(true);
    expect(problems.some((p) => p.includes('is string; sum needs a number'))).toBe(true);
    expect(problems.some((p) => p.includes('unknown agg "bogus"'))).toBe(true);
  });

  it('counts a text column without complaint', () => {
    const { ok } = validateBundle(
      { data: { rows }, view: { ...view, values: [{ id: 'n', field: 'note', agg: 'count' }] } },
      frame,
    );
    expect(ok).toBe(true);
  });

  it('knows about derived fields', () => {
    const { ok } = validateBundle(
      {
        data: { rows },
        view: {
          ...view,
          derive: { half: { compute: 'revenue / 2' } },
          rows: ['half'],
        },
      },
      frame,
    );
    expect(ok).toBe(true);
  });

  it('checks a flat view too', () => {
    const { problems } = validateBundle(
      { data: { rows }, view: { mode: 'flat', columns: [{ id: 'nope' }] } },
      frame,
    );
    expect(problems.some((p) => p.includes('no column named "nope"'))).toBe(true);
  });
});

describe('describeFrame', () => {
  it('summarizes what an agent needs to pick fields', () => {
    const summary = describeFrame(frame);
    expect(summary.map((c) => `${c.name}:${c.category}`)).toEqual([
      'region:index',
      'quarter:index',
      'revenue:data',
      'note:index',
    ]);
    const revenue = summary.find((c) => c.name === 'revenue')!;
    expect(revenue.type).toBe('int');
    expect(revenue.distinct).toBe(2);
    expect(revenue.samples).toEqual([120, 340]);
    expect(summary.find((c) => c.name === 'note')!.nulls).toBe(1);
  });
});
