/**
 * Renders every demo example through the real component, so the six specs in
 * `demo/examples` are exercised end to end rather than only typechecked.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DataTable } from './components/DataTable';
import { computeView } from './pivot/engine';
import { fromRows } from './data/import';
import { parseCsv } from './data/csv';
import { validateBundle } from './bundle';
import { autoScaleOf } from './pivot/spec';
import type { DataFrame } from './data/types';
import type { ViewSpec } from './pivot/spec';

// react-dom needs this flag; @tanstack/react-virtual needs ResizeObserver.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { view as ticker } from '../demo/examples/ticker/view';
import tickerData from '../demo/examples/ticker/data.json';
import { view as benchmark } from '../demo/examples/benchmark/view';
import benchmarkData from '../demo/examples/benchmark/data.json';
import { view as regression } from '../demo/examples/regression/view';
import { view as tokens } from '../demo/examples/tokens/view';
import tokensData from '../demo/examples/tokens/data.json';
import { view as metrics } from '../demo/examples/metrics/view';
import metricsData from '../demo/examples/metrics/data.json';
import { view as commits } from '../demo/examples/commits/view';
import commitsData from '../demo/examples/commits/data.json';

// Read rather than `?raw`-imported: the build's tsconfig has no Vite types.
// Vitest runs from the project root, next to vite.config.ts.
const regressionCsv = readFileSync('demo/examples/regression/data.csv', 'utf8');

type Row = Record<string, unknown>;
type Dataset = { meta?: Record<string, unknown>; rows: Row[] };

function frameOf(data: Row[] | Dataset): DataFrame {
  return Array.isArray(data)
    ? fromRows(data)
    : fromRows(data.rows, data.meta as never);
}

/** name, view, frame, and the leaf columns the header should end up with. */
const examples: [string, ViewSpec, DataFrame, number][] = [
  ['ticker', ticker, frameOf(tickerData as Dataset | Row[]), 6],
  ['benchmark', benchmark, frameOf(benchmarkData as Dataset | Row[]), 32],
  ['regression', regression, frameOf(parseCsv(regressionCsv)), 9],
  ['tokens', tokens, frameOf(tokensData as Dataset | Row[]), 5],
  ['metrics', metrics, frameOf(metricsData as Dataset | Row[]), 8],
  ['commits', commits, frameOf(commitsData as Dataset | Row[]), 14],
];

describe.each(examples)('example: %s', (_name, view, frame, leafCount) => {
  it('validates against its own data', () => {
    const { problems } = validateBundle({ data: { rows: [] }, view }, frame);
    expect(problems).toEqual([]);
  });

  it('computes a result with body rows and no empty headers', () => {
    const res = computeView(frame, view);
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.leaves).toHaveLength(leafCount);
    // A blank header is what a mis-resolved label looks like.
    expect(res.leaves.every((l) => l.column.label.length > 0)).toBe(true);
    expect(res.rowLevels.every((l) => l.length > 0)).toBe(true);
  });

  it('renders to real DOM', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<DataTable data={frame} view={view} />);
    });
    const table = host.querySelector('table')!;
    expect(table).toBeTruthy();
    expect(table.querySelectorAll('thead th').length).toBeGreaterThan(0);
    // The header text a reader would see, with nothing missing.
    expect(table.querySelector('thead')!.textContent).toBeTruthy();
    await act(async () => root.unmount());
    host.remove();
  });
});

describe('switching examples with an edit in flight', () => {
  /**
   * The demo's own state shape: an edited spec plus the example it belongs to,
   * dropped during render rather than in an effect. Getting that wrong renders
   * one frame of the previous spec over the new data, and `computeView` throws
   * on the missing field — which unmounts the page rather than showing the
   * new example.
   */
  function Harness({ pick }: { pick: number }) {
    const [edited, setEdited] = useState<ViewSpec | null>(null);
    const [editedFor, setEditedFor] = useState(pick);
    const stale = editedFor !== pick;
    if (stale) {
      setEditedFor(pick);
      setEdited(null);
    }
    const [, view, frame] = examples[pick]!;
    return (
      <DataTable
        data={frame}
        view={(stale ? null : edited) ?? view}
        editing
        onViewChange={setEdited}
      />
    );
  }

  it('survives an edit followed by a switch', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    // benchmark: a pivot over `benchmark` / `dataSize` / `architecture`.
    await act(async () => root.render(<Harness pick={1} />));

    // A real edit through the UI, so the spec really is component state now.
    const remove = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="Remove the"]',
    );
    expect(remove, 'the editing affordances should be present').toBeTruthy();
    await act(async () => remove!.click());

    // Switching to metrics, whose data has none of those fields. Before the
    // reset moved out of an effect this threw and unmounted everything.
    await act(async () => root.render(<Harness pick={4} />));

    const table = host.querySelector('table');
    expect(table, 'the page should still be mounted').toBeTruthy();
    expect(table!.querySelectorAll('thead th').length).toBeGreaterThan(0);
    // metrics is flat, so its header is the column list, not a pivot axis.
    expect(table!.querySelector('thead')!.textContent).toContain('Host');
    await act(async () => root.unmount());
    host.remove();
  });
});

describe('the examples that auto-scale', () => {
  /** Every leaf that chose its own scale, with the label it settled on. */
  function scaled(view: ViewSpec, frame: DataFrame) {
    return computeView(frame, view)
      .leaves.filter((l) => l.displayFactor !== undefined)
      .map((l) => ({ id: l.column.def!.id, scale: l.column.meta!.scale?.[0] }));
  }

  it('reads regression’s nanoseconds as microseconds', () => {
    const picked = scaled(regression, frameOf(parseCsv(regressionCsv)));
    // One `mean` leaf per platform × revision, all on the same rung.
    expect(picked).toHaveLength(6);
    expect(picked.every((p) => p.id === 'mean' && p.scale === 'micro')).toBe(
      true,
    );
    // The Δ column is a ratio: it keeps its percent scale and is not rescaled.
    const delta = computeView(
      frameOf(parseCsv(regressionCsv)),
      regression,
    ).leaves.filter((l) => l.column.def?.id === 'delta');
    expect(delta.every((l) => l.displayFactor === undefined)).toBe(true);
  });

  it('holds one scale across benchmark’s pool and column groups', () => {
    const picked = scaled(benchmark, frameOf(benchmarkData as Dataset | Row[]));
    // mean/min/max in each of 8 column groups: 24 leaves, one scale.
    expect(picked).toHaveLength(24);
    // Four orders of magnitude in one pool, so the scale protects the small
    // end: nanoseconds, rather than leaving a third of the column at `0.xxx`.
    expect(new Set(picked.map((p) => p.scale))).toEqual(new Set(['nano']));
    // `variance` is ns², so it opted out and is absent from the list.
    expect(picked.some((p) => p.id === 'variance')).toBe(false);
  });
});

describe('the demo’s per-column / per-value switch', () => {
  /** What the demo does when the scaling toggle is flipped to per-value. */
  const perValue = (v: ViewSpec): ViewSpec => ({
    ...v,
    columns: v.columns.map((c) =>
      autoScaleOf(c) === undefined
        ? c
        : { ...c, autoScale: { per: 'value' as const }, scalePool: undefined },
    ),
  });

  function firstCells(view: ViewSpec, n: number): string[] {
    const frame = frameOf(parseCsv(regressionCsv));
    const res = computeView(frame, view);
    const leaf = res.leaves[0]!;
    return res.rows.slice(0, n).map((row) =>
      leaf.format({
        value: row.cells[0]!.value,
        inputs: {},
        rowPath: row.path,
        colPath: leaf.colPath,
        column: leaf.column,
        frame: res.frame,
      }),
    );
  }

  it('shows one unit per column, sub-unit values included', () => {
    const cells = firstCells(regression, 8);
    // A value below the chosen unit reads as a fraction of it, on purpose:
    // the column is scannable because every row is in the same unit.
    expect(cells).toContain('0.521');
    expect(cells.every((c) => !c.includes('µs'))).toBe(true);
  });

  it('gives every cell its own unit when flipped', () => {
    const cells = firstCells(perValue(regression), 8);
    expect(cells).toContain('521 ns');
    expect(cells).toContain('4.34 µs');
  });

  it('drops the pool when flipping, since a pool picks one scale', () => {
    const flipped = perValue(benchmark);
    const pooled = flipped.columns.filter((c) => c.scalePool !== undefined);
    expect(pooled).toEqual([]);
  });
});
