import { describe, expect, it } from 'vitest';
import { describeFrame, loadBundle, loadRows, validateBundle } from './bundle';
import { fromRows } from './data/import';
import type { PivoetteBundle } from './bundle';
import type { ViewSpec } from './pivot/spec';

const rows = [
  { region: 'EU', quarter: 'Q1', revenue: 120, note: null },
  { region: 'US', quarter: 'Q1', revenue: 340, note: 'x' },
];
const frame = fromRows(rows);
const view = {
  pivotRows: [{ field: 'region' }],
  pivotColumns: [{ field: 'quarter' }],
  columns: [{ id: 'rev', source: 'revenue', agg: 'sum', label: 'Revenue' }],
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
          pivotRows: [{ field: 'nope' }],
          columns: [
            { id: 'a', source: 'missing', agg: 'sum' },
            { id: 'a', source: 'note', agg: 'sum' },
            { id: 'c', source: 'revenue', agg: 'bogus' },
          ],
        },
      },
      frame,
    );
    expect(ok).toBe(false);
    // One pass should surface all of them, not just the first.
    expect(problems.some((p) => p.includes('more than one source'))).toBe(true);
    expect(problems.some((p) => p.includes('no column named "nope"'))).toBe(
      true,
    );
    expect(problems.some((p) => p.includes('no column named "missing"'))).toBe(
      true,
    );
    expect(problems.some((p) => p.includes('duplicate id'))).toBe(true);
    expect(
      problems.some((p) => p.includes('is string; sum needs a number')),
    ).toBe(true);
    expect(problems.some((p) => p.includes('unknown agg "bogus"'))).toBe(true);
  });

  it('counts a text column without complaint', () => {
    const { ok } = validateBundle(
      {
        data: { rows },
        view: { ...view, columns: [{ id: 'n', source: 'note', agg: 'count' }] },
      },
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
          pivotRows: [{ field: 'half' }],
        },
      },
      frame,
    );
    expect(ok).toBe(true);
  });

  it('checks a flat view too', () => {
    const { problems } = validateBundle(
      { data: { rows }, view: { columns: [{ id: 'nope' }] } },
      frame,
    );
    expect(problems.some((p) => p.includes('no column named "nope"'))).toBe(
      true,
    );
  });

  it('wants a pivot column to say how it survives the grouping', () => {
    const { problems } = validateBundle(
      {
        data: { rows },
        // `region` is a plain projection, which means nothing once rows are
        // collapsed into groups — the old `mode` flag made this unsayable.
        view: {
          pivotRows: [{ field: 'quarter' }],
          columns: [{ id: 'region' }, { id: 'revenue', agg: 'sum' }],
        },
      },
      frame,
    );
    expect(
      problems.some((p) => p.includes('neither aggregates nor computes')),
    ).toBe(true);
  });

  it('rejects pivot-only options on a flat view', () => {
    const { problems } = validateBundle(
      {
        data: { rows },
        view: {
          columns: [{ id: 'revenue', place: 'append' }],
          showSummary: true,
        },
      },
      frame,
    );
    expect(problems).toContain('view.showSummary needs a pivot view');
    expect(problems.some((p) => p.includes('`place` needs a pivot view'))).toBe(
      true,
    );
  });

  it('rejects computed members the engine would not look for', () => {
    const computed = [
      { id: 'delta', compute: 'a', inputs: { a: { member: 'x' } } },
    ];
    const on = (v: ViewSpec) =>
      validateBundle({ data: { rows }, view: v }, frame).problems;

    // A row level would have to synthesize rows, not cells.
    expect(
      on({
        pivotRows: [{ field: 'region', computed }],
        columns: [{ id: 'revenue', agg: 'sum' }],
      }).some((p) => p.includes('`computed` is supported on `pivotColumns`')),
    ).toBe(true);

    // An outer level's synthetic member would be a whole subtree.
    expect(
      on({
        pivotColumns: [{ field: 'region', computed }, { field: 'quarter' }],
        columns: [{ id: 'revenue', agg: 'sum' }],
      }).some((p) => p.includes('only the innermost column level')),
    ).toBe(true);

    // On the innermost level it is exactly what the engine reads.
    expect(
      on({
        pivotColumns: [{ field: 'region' }, { field: 'quarter', computed }],
        columns: [{ id: 'revenue', agg: 'sum' }],
      }),
    ).toEqual([]);
  });

  it('rejects a flat sort on a pivot', () => {
    const { problems } = validateBundle(
      {
        data: { rows },
        view: {
          pivotRows: [{ field: 'region' }],
          columns: [{ id: 'revenue', agg: 'sum' }],
          sort: [{ field: 'revenue' }],
        },
      },
      frame,
    );
    expect(problems.some((p) => p.includes('view.sort is flat-only'))).toBe(
      true,
    );
  });

  it('wants an axis entry to be an object with a field', () => {
    const { problems } = validateBundle(
      {
        data: { rows },
        view: {
          pivotRows: ['region'] as unknown as { field: string }[],
          columns: [{ id: 'revenue', agg: 'sum' }],
        },
      },
      frame,
    );
    expect(
      problems.some((p) => p.includes('must be an object with a `field`')),
    ).toBe(true);
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

describe('autoScale validation', () => {
  const timed = {
    rows: [{ host: 'a', latency: 12 }],
    meta: {
      latency: { kind: ['duration'], unit: ['second'], scale: ['nano'] },
    },
  };
  const check = (view: unknown) =>
    validateBundle({ data: { rows: timed.rows }, view }, fromRows(timed.rows))
      .problems;

  it('accepts a measurable column', () => {
    expect(
      check({
        meta: timed.meta,
        pivotRows: [{ field: 'host' }],
        columns: [{ id: 'latency', agg: 'mean', autoScale: true }],
      }),
    ).toEqual([]);
  });

  it('names an unknown ladder', () => {
    const problems = check({
      meta: timed.meta,
      pivotRows: [{ field: 'host' }],
      columns: [{ id: 'latency', agg: 'mean', autoScale: 'nope' }],
    });
    expect(
      problems.some((p) => p.includes('unknown scale ladder "nope"')),
    ).toBe(true);
  });

  it('rejects scaling a column with no measurable unit', () => {
    // A rate has no single magnitude to move along.
    const problems = check({
      meta: { latency: { unit: ['token', '1/second'] } },
      pivotRows: [{ field: 'host' }],
      columns: [{ id: 'latency', agg: 'mean', autoScale: true }],
    });
    expect(problems.some((p) => p.includes('measurable'))).toBe(true);
  });

  it('leaves an unmeasurable unit alone when nothing asks to scale it', () => {
    expect(
      check({
        meta: { latency: { unit: ['token', '1/second'] } },
        pivotRows: [{ field: 'host' }],
        columns: [{ id: 'latency', agg: 'mean' }],
      }),
    ).toEqual([]);
  });

  it('wants a pool to agree with itself', () => {
    const problems = check({
      meta: timed.meta,
      pivotRows: [{ field: 'host' }],
      columns: [
        {
          id: 'a',
          source: 'latency',
          agg: 'mean',
          autoScale: 'duration',
          scalePool: 'p',
        },
        {
          id: 'b',
          source: 'latency',
          agg: 'max',
          autoScale: 'si',
          scalePool: 'p',
        },
      ],
    });
    expect(problems.some((p) => p.includes('about the ladder'))).toBe(true);
  });

  it('rejects a pool that also asks for a per-value scale', () => {
    const problems = check({
      meta: timed.meta,
      pivotRows: [{ field: 'host' }],
      columns: [
        {
          id: 'latency',
          agg: 'mean',
          autoScale: { per: 'value' },
          scalePool: 'p',
        },
      ],
    });
    expect(problems.some((p) => p.includes('conflict'))).toBe(true);
  });

  it('wants a pool to come with something to pool', () => {
    const problems = check({
      meta: timed.meta,
      pivotRows: [{ field: 'host' }],
      columns: [{ id: 'latency', agg: 'mean', scalePool: 'p' }],
    });
    expect(problems.some((p) => p.includes('needs `autoScale`'))).toBe(true);
  });
});
