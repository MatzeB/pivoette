import { describe, expect, it } from 'vitest';
import { fromRows } from '../data/import';
import { computeView } from '../pivot/engine';
import type { ViewSpec } from '../pivot/spec';
import { graphFromView, markOf, shortLabel } from './pivot-chart';
import type { ChartDisplay } from './pivot-chart';

// Two suites, two builds, two workloads each: enough for a spread.
const ROWS = [
  { suite: 'zstd', build: 'base', speedup: 1.0 },
  { suite: 'zstd', build: 'base', speedup: 1.2 },
  { suite: 'zstd', build: 'pgo', speedup: 1.1 },
  { suite: 'zstd', build: 'pgo', speedup: 1.3 },
  { suite: 'bzip2', build: 'base', speedup: 0.9 },
  { suite: 'bzip2', build: 'base', speedup: 0.95 },
  { suite: 'bzip2', build: 'pgo', speedup: 1.0 },
  { suite: 'bzip2', build: 'pgo', speedup: 1.05 },
];
const frame = fromRows(ROWS);

const VIEW: ViewSpec = {
  pivotRows: [{ field: 'suite' }],
  pivotColumns: [{ field: 'build' }],
  columns: [
    { id: 'avg', source: 'speedup', agg: 'mean', label: 'mean' },
    { id: 'lo', source: 'speedup', agg: 'min', label: 'min' },
    { id: 'hi', source: 'speedup', agg: 'max', label: 'max' },
    { id: 'mid', source: 'speedup', agg: 'median', label: 'median' },
  ],
};

const draw = (view: ViewSpec, chart?: ChartDisplay) =>
  graphFromView(computeView(frame, view), view, chart);

describe('markOf', () => {
  it('leads with a bar, spreads into the whisker, and marks the rest', () => {
    expect(VIEW.columns.map((_c, i) => markOf(VIEW, undefined, i))).toEqual([
      'bar',
      'range',
      'range',
      'median',
    ]);
  });

  it('defers to what the display says', () => {
    const chart: ChartDisplay = { marks: { avg: 'none', mid: 'bar' } };
    expect(markOf(VIEW, chart, 0)).toBe('none');
    expect(markOf(VIEW, chart, 3)).toBe('bar');
  });
});

describe('shortLabel', () => {
  it('drops the bar’s own name from a value beside it', () => {
    expect(shortLabel('cycles min', 'cycles')).toBe('min');
    expect(shortLabel('cycles', 'cycles')).toBe('cycles');
    expect(shortLabel('cyclesMin', 'cycles')).toBe('cyclesMin');
    expect(shortLabel('ir max', 'cycles')).toBe('ir max');
  });
});

describe('box plot', () => {
  const BOXED: ViewSpec = {
    ...VIEW,
    columns: [
      ...VIEW.columns,
      { id: 'q1', source: 'speedup', agg: 'p25', label: 'p25' },
      { id: 'q3', source: 'speedup', agg: 'p75', label: 'p75' },
    ],
  };

  it('draws quartiles as the box and the median across it', () => {
    const { graph } = draw(BOXED, { plot: 'boxes' });
    const point = graph!.series[0]!.points[0]!; // zstd base: 1.0, 1.2
    expect(point.range).toEqual([1.0, 1.2]);
    expect(point.box![0]).toBeCloseTo(1.05, 10);
    expect(point.box![1]).toBeCloseTo(1.15, 10);
    expect(point.median).toBeCloseTo(1.1, 10);
  });

  it('widens the whisker with the quartiles, and dots the median, as bars', () => {
    const point = draw(BOXED).graph!.series[0]!.points[0]!;
    expect(point.box).toBeUndefined();
    expect(point.median).toBeUndefined();
    expect(point.range).toEqual([1.0, 1.2]);
    expect(point.extras!.find((e) => e.label === 'median')!.as).toBe('dot');
  });
});

describe('graphFromView', () => {
  it('makes rows categories and column members the bars', () => {
    const { graph, problems } = draw(VIEW);
    expect(problems).toEqual([]);
    // In the engine's order: as the rows came, since the axis has no sort.
    expect(graph!.categories).toEqual(['zstd', 'bzip2']);
    expect(graph!.series.map((s) => s.key)).toEqual(['base', 'pgo']);
    const zstdBase = graph!.series[0]!.points[0]!;
    expect(zstdBase.y).toBeCloseTo(1.1, 10);
  });

  it('spans the whisker from the lowest to the highest range value', () => {
    const point = draw(VIEW).graph!.series[0]!.points[0]!;
    expect(point.range).toEqual([1.0, 1.2]);
    // Everything not drawn as the bar is listed for the readout.
    expect(point.extras!.map((e) => [e.label, e.as])).toEqual([
      ['min', 'range'],
      ['max', 'range'],
      ['median', 'dot'],
    ]);
  });

  it('keeps the whisker inside the value axis', () => {
    const { graph } = draw(VIEW);
    // bzip2/base's min is the lowest value anywhere, and only a range has it.
    expect(graph!.yExtent[0]).toBeCloseTo(0.9, 10);
    expect(graph!.yExtent[1]).toBeCloseTo(1.3, 10);
  });

  it('draws one bar per measure when several are bars, named by both', () => {
    const { graph } = draw(VIEW, { marks: { lo: 'bar', hi: 'bar' } });
    expect(graph!.series.map((s) => s.key)).toEqual([
      'base · mean',
      'base · min',
      'base · max',
      'pgo · mean',
      'pgo · min',
      'pgo · max',
    ]);
  });

  it('draws the bars in the order asked, without moving a colour', () => {
    const { graph } = draw(VIEW, { barOrder: ['pgo'] });
    expect(graph!.series.map((s) => s.key)).toEqual(['pgo', 'base']);
    expect(graph!.series.map((s) => s.index)).toEqual([0, 1]);
    expect(graph!.series.map((s) => s.slot)).toEqual([1, 0]);
  });

  it('names a bar by its measure when there are no column fields', () => {
    const view: ViewSpec = { ...VIEW, pivotColumns: undefined };
    const { graph } = draw(view);
    expect(graph!.series.map((s) => s.key)).toEqual(['mean']);
  });

  it('says why when there are no categories', () => {
    const view: ViewSpec = { ...VIEW, pivotRows: undefined };
    const { graph, problems } = draw(view);
    expect(graph).toBeNull();
    expect(problems[0]).toMatch(/Categories/);
  });

  it('says why when nothing is a bar', () => {
    const { graph, problems } = draw(VIEW, {
      marks: { avg: 'none' },
    });
    expect(graph).toBeNull();
    expect(problems[0]).toMatch(/Bar/);
  });

  it('notes a range with only one end', () => {
    const { graph, notes } = draw(VIEW, { marks: { hi: 'dot' } });
    expect(graph).not.toBeNull();
    expect(notes[0]).toMatch(/two values/);
    expect(graph!.series[0]!.points[0]!.range).toBeUndefined();
  });
});

describe('colours', () => {
  const nestedRows = ROWS.flatMap((r) => [
    { ...r, cc: 'foo' },
    { ...r, cc: 'bar' },
  ]);
  const nestedFrame = fromRows(nestedRows);
  const NESTED: ViewSpec = {
    ...VIEW,
    pivotColumns: [{ field: 'cc' }, { field: 'build' }],
  };
  const drawNested = (chart?: ChartDisplay) =>
    graphFromView(computeView(nestedFrame, NESTED), NESTED, chart);

  it('leaves the palette alone for one column field by default', () => {
    const { graph } = draw(VIEW);
    expect(graph!.series.map((s) => s.color)).toEqual([undefined, undefined]);
  });

  it('shades one hue, palest first, when asked', () => {
    const { graph } = draw(VIEW, { colors: 'shades' });
    const [first, last] = graph!.series.map((s) => s.color);
    expect(first).toMatch(/^color-mix\(in oklch, var\(--pv-series-0\) 40%/);
    expect(last).toBe('var(--pv-series-0)');
  });

  it('nests by default for two column fields: hue outside, shade inside', () => {
    const { graph } = drawNested();
    expect(graph!.series.map((s) => [s.group!.label, s.group!.shade])).toEqual([
      ['foo', 'base'],
      ['foo', 'pgo'],
      ['bar', 'base'],
      ['bar', 'pgo'],
    ]);
    expect(graph!.series[1]!.color).toBe('var(--pv-series-0)');
    expect(graph!.series[3]!.color).toBe('var(--pv-series-1)');
  });

  it('keeps a group’s hue when the bars are reordered', () => {
    const { graph } = drawNested({
      barOrder: ['bar · base', 'bar · pgo'],
    });
    expect(graph!.series[0]!.group!.label).toBe('bar');
    expect(graph!.series[1]!.color).toBe('var(--pv-series-1)');
  });

  it('falls back, with a note, where shades would not read', () => {
    const one = draw(VIEW, { colors: 'nested' });
    expect(one.graph!.series[0]!.color).toBeUndefined();
    expect(one.notes[0]).toMatch(/two fields under Bars/);

    const twoBars = draw(VIEW, { colors: 'shades', marks: { lo: 'bar' } });
    expect(twoBars.graph!.series[0]!.color).toBeUndefined();
    // Alongside the note that `hi` is now a range on its own.
    expect(twoBars.notes).toContainEqual(
      expect.stringMatching(/one bar per member/),
    );
  });
});

describe('panels', () => {
  const twoFields = fromRows(ROWS.map((r) => ({ ...r, ir: r.speedup * 0.9 })));
  const VIEW2: ViewSpec = {
    ...VIEW,
    columns: [
      { id: 'speedup', agg: 'mean', label: 'cycles' },
      { id: 'ir', agg: 'mean', label: 'ir' },
      { id: 'irMin', source: 'ir', agg: 'min', label: 'ir min' },
      { id: 'irMax', source: 'ir', agg: 'max', label: 'ir max' },
    ],
  };
  const drawTwo = (chart?: ChartDisplay) =>
    graphFromView(computeView(twoFields, VIEW2), VIEW2, chart);

  it('gives each field’s first measure a bar of its own', () => {
    expect(VIEW2.columns.map((_c, i) => markOf(VIEW2, undefined, i))).toEqual([
      'bar',
      'bar',
      'range',
      'range',
    ]);
  });

  it('splits into a panel per field, each with its own spread', () => {
    const { panels } = drawTwo();
    expect(panels.map((p) => p.key)).toEqual(['speedup', 'ir']);
    // The whisker went with its own field's bars.
    expect(panels[0]!.graph.series[0]!.points[0]!.range).toBeUndefined();
    expect(panels[1]!.graph.series[0]!.points[0]!.range).toBeDefined();
  });

  it('puts panels in one unit on one scale', () => {
    const { panels } = drawTwo();
    expect(panels[0]!.graph.yExtent).toEqual(panels[1]!.graph.yExtent);
    const apart = drawTwo({ sharedScale: false }).panels;
    expect(apart[0]!.graph.yExtent).not.toEqual(apart[1]!.graph.yExtent);
  });

  it('draws them on one axis when not split', () => {
    const { panels } = drawTwo({ split: false });
    expect(panels).toHaveLength(1);
    expect(panels[0]!.graph.series.map((s) => s.key)).toEqual([
      'base · cycles',
      'base · ir',
      'pgo · cycles',
      'pgo · ir',
    ]);
  });
});
