import { useEffect, useState } from 'react';
import { DataTable } from '../src';
import type {
  DataTableDisplay,
  DatasetJson,
  UnitPlacement,
  ViewSpec,
} from '../src';

import { view as tickerView } from './examples/ticker/view';
import tickerData from './examples/ticker/data.json';
import { view as benchmarkView } from './examples/benchmark/view';
import benchmarkData from './examples/benchmark/data.json';
import { view as regressionView } from './examples/regression/view';
import regressionData from './examples/regression/data.json';
import { view as tokensView } from './examples/tokens/view';
import tokensData from './examples/tokens/data.json';
import { view as metricsView } from './examples/metrics/view';
import metricsData from './examples/metrics/data.json';

type Row = Record<string, unknown>;

interface Example {
  id: string;
  title: string;
  blurb: string;
  view: ViewSpec;
  /** Rows, or the `{meta, rows}` wire form carrying column metadata. */
  data: Row[] | DatasetJson;
  display?: DataTableDisplay;
}

const EXAMPLES: Example[] = [
  {
    id: 'ticker',
    title: '1 · Stock ticker (flat)',
    blurb:
      'Flat detail table: composite asset cell (image + description, sorted by description), computed P/L $ and %, currency + sign formatting, red/green by sign.',
    view: tickerView,
    data: tickerData as Row[],
    display: { indexColumns: 1 },
  },
  {
    id: 'benchmark',
    title: '2 · Kernel benchmark (pivot)',
    blurb:
      'Frameless spacing-based design: grouped size/arch blocks, sticky multi-level header, and a 3-line footer (avg / median / sum).',
    view: benchmarkView,
    data: benchmarkData as Row[],
    display: {
      frameless: true,
      hideRules: true,
      zebra: true,
      groupSpacing: 14,
      footer: [
        { label: 'avg', agg: 'mean' },
        { label: 'median', agg: 'median' },
        { label: 'sum', agg: 'sum' },
      ],
    },
  },
  {
    id: 'regression',
    title: '3 · Before/after regression',
    blurb:
      'Per-platform derived Δ% referencing each platform’s own before/after cells; faster is green, regressions red. Hover shades the row, cell, and index.',
    view: regressionView,
    data: regressionData as Row[],
    display: { groupSpacing: 8 },
  },
  {
    id: 'tokens',
    title: '4 · AI token spend (multi-level rows)',
    blurb:
      'Nested rows team → project → model, compact K/M/B token counts, computed Total column, grand-total summary footer.',
    view: tokensView,
    data: tokensData as Row[],
    display: { rowGroupSpacing: 10 },
  },
  {
    id: 'metrics',
    title: '5 · Fleet metrics (column metadata)',
    blurb:
      'Headers and units come from column metadata shipped with the data. Compound units (ktok/s, MB/s, m²) move as one label; simple ones (ms, MiB) can split scale onto the value and unit into the header.',
    view: metricsView,
    data: metricsData as DatasetJson,
    display: {
      indexColumns: 2,
      zebra: true,
      footer: [{ label: 'median', agg: 'median' }],
    },
  },
];

type Theme = 'auto' | 'light' | 'dark';

function initialTheme(): Theme {
  const t = new URLSearchParams(window.location.search).get('theme');
  return t === 'light' || t === 'dark' ? t : 'auto';
}

function initialExample(): string {
  const ex = new URLSearchParams(window.location.search).get('ex');
  return EXAMPLES.some((e) => e.id === ex) ? ex! : EXAMPLES[0]!.id;
}

/**
 * True when a dataset declares a unit or scale on any column — the placement
 * controls do nothing without one, so they only appear for such examples.
 */
function hasUnitMeta(data: Row[] | DatasetJson): boolean {
  if (Array.isArray(data) || !data.meta) return false;
  return Object.values(data.meta).some(
    (m) => m.siUnit ?? m.siScale ?? m.siUnitShort ?? m.siScaleShort,
  );
}

const PLACEMENTS: UnitPlacement[] = ['off', 'value', 'header'];

/** Where a metadata-supplied unit/scale label is rendered. */
function PlacementSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: UnitPlacement;
  onChange: (v: UnitPlacement) => void;
}) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 12,
        color: 'var(--page-muted)',
      }}
    >
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as UnitPlacement)}
        style={{
          padding: '4px 6px',
          borderRadius: 6,
          border: '1px solid var(--btn-border)',
          background: 'var(--btn-bg)',
          color: 'var(--btn-fg)',
          fontSize: 12,
        }}
      >
        {PLACEMENTS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </label>
  );
}

export function App() {
  const [selected, setSelected] = useState(initialExample);
  const [stress, setStress] = useState(false);
  const [stressData, setStressData] = useState<Row[] | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  // The library defaults to 'off' (units are opt-in); the demo starts them in
  // the header so the metrics example shows its labels without touching a
  // control. Only columns carrying unit metadata react, so examples 1–4 are
  // unaffected either way.
  const [unitPlacement, setUnitPlacement] = useState<UnitPlacement>('header');
  const [scalePlacement, setScalePlacement] = useState<UnitPlacement>('header');

  const example = EXAMPLES.find((e) => e.id === selected)!;
  const isRegression = example.id === 'regression';

  useEffect(() => {
    if (stress && isRegression && !stressData) {
      fetch('/demo/examples/regression/stress.json')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setStressData(d))
        .catch(() => setStressData(null));
    }
  }, [stress, isRegression, stressData]);

  // Drive the page palette (demo.css) alongside the component's own theme.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  const data = isRegression && stress && stressData ? stressData : example.data;
  const rowCount = Array.isArray(data) ? data.length : data.rows.length;

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: '24px 20px',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: 'var(--page-text)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ marginBottom: 4 }}>Pivoette</h1>
          <p style={{ color: 'var(--page-muted)', marginTop: 0 }}>
            In-browser pivot-table / data-analysis component — worked examples.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 4, flex: '0 0 auto' }}>
          {(['auto', 'light', 'dark'] as Theme[]).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                border: '1px solid var(--btn-border)',
                cursor: 'pointer',
                textTransform: 'capitalize',
                background:
                  t === theme ? 'var(--btn-active-bg)' : 'var(--btn-bg)',
                color: t === theme ? 'var(--btn-active-fg)' : 'var(--btn-fg)',
                fontSize: 12,
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '16px 0' }}
      >
        {EXAMPLES.map((e) => (
          <button
            key={e.id}
            onClick={() => setSelected(e.id)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--btn-border)',
              cursor: 'pointer',
              background:
                e.id === selected ? 'var(--btn-active-bg)' : 'var(--btn-bg)',
              color:
                e.id === selected ? 'var(--btn-active-fg)' : 'var(--btn-fg)',
              fontSize: 13,
            }}
          >
            {e.title}
          </button>
        ))}
      </div>

      <p style={{ color: 'var(--page-subtle)', fontSize: 13, minHeight: 34 }}>
        {example.blurb}
      </p>

      {isRegression && (
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            marginBottom: 10,
            color: 'var(--page-muted)',
          }}
        >
          <input
            type="checkbox"
            checked={stress}
            onChange={(e) => setStress(e.target.checked)}
          />
          Stress mode — 10k apps (
          {stress && !stressData ? 'loading…' : 'row virtualization'})
        </label>
      )}

      {hasUnitMeta(data) && (
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            marginBottom: 10,
          }}
        >
          <PlacementSelect
            label="unit"
            value={unitPlacement}
            onChange={setUnitPlacement}
          />
          <PlacementSelect
            label="scale"
            value={scalePlacement}
            onChange={setScalePlacement}
          />
        </div>
      )}

      <DataTable
        key={example.id + (stress ? '-stress' : '')}
        data={data}
        view={example.view}
        height={560}
        theme={theme}
        display={{ ...example.display, unitPlacement, scalePlacement }}
      />

      <p style={{ color: 'var(--page-muted)', fontSize: 12, marginTop: 10 }}>
        {rowCount.toLocaleString()} source rows.
      </p>
    </div>
  );
}
