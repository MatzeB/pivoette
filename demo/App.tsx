import { useEffect, useState } from 'react';
import { DataTable } from '../src';
import type { DataTableDisplay, ViewSpec } from '../src';

import { view as tickerView } from './examples/ticker/view';
import tickerData from './examples/ticker/data.json';
import { view as benchmarkView } from './examples/benchmark/view';
import benchmarkData from './examples/benchmark/data.json';
import { view as regressionView } from './examples/regression/view';
import regressionData from './examples/regression/data.json';
import { view as tokensView } from './examples/tokens/view';
import tokensData from './examples/tokens/data.json';

type Row = Record<string, unknown>;

interface Example {
  id: string;
  title: string;
  blurb: string;
  view: ViewSpec;
  data: Row[];
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

export function App() {
  const [selected, setSelected] = useState(initialExample);
  const [stress, setStress] = useState(false);
  const [stressData, setStressData] = useState<Row[] | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);

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

      <DataTable
        key={example.id + (stress ? '-stress' : '')}
        data={data}
        view={example.view}
        height={560}
        theme={theme}
        display={example.display}
      />

      <p style={{ color: 'var(--page-muted)', fontSize: 12, marginTop: 10 }}>
        {data.length.toLocaleString()} source rows.
      </p>
    </div>
  );
}
