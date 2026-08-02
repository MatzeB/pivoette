import { useEffect, useMemo, useState } from 'react';
import { DataTable, isFlat, normalizeMeta, unitLabels } from '../src';
import type {
  ColumnMetaInput,
  UnitLabels,
  DataTableDisplay,
  DatasetJson,
  TableSpec,
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
import { view as commitsView } from './examples/commits/view';
import commitsData from './examples/commits/data.json';

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
      'Flat detail table: composite asset cell (image + description, sorted by description), computed P/L, red/green by sign. Column metadata is declared in the view over plain JSON rows — the 2-decimal money format is deduced from kind `price`, and the `$` follows the placement toggle (leading the number, inside the sign).',
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
  {
    id: 'commits',
    title: '6 · Commits by weekday (dates)',
    blurb:
      'The timestamp column declares its own encoding in the data; the view derives a weekday from it with `weekday(committedAt)`. The integers 0–6 sort into calendar order by themselves, and kind `weekday` deduces the format that names them. Locale re-orders and renames the columns; time zone moves commits between them.',
    view: commitsView,
    data: commitsData as DatasetJson,
    display: { groupSpacing: 10, indexGap: 8 },
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
 * The unit labels of every column in play, from either source: the data
 * (metrics ships a `{meta, rows}` document) or the view (ticker annotates plain
 * rows, including a computed column's own `meta`).
 *
 * Normalizing and asking `unitLabels` — rather than probing the raw input for
 * `unit`/`scale` keys — is what keeps the controls in step with the table: the
 * same call decides whether a label exists and whether its halves can be placed
 * separately.
 */
function collectLabels(
  data: Row[] | DatasetJson,
  view: ViewSpec,
): UnitLabels[] {
  const defs = isFlat(view) ? view.columns : (view.computed ?? []);
  const inputs: ColumnMetaInput[] = [
    ...(Array.isArray(data) ? [] : Object.values(data.meta ?? {})),
    ...Object.values(view.meta ?? {}),
    ...defs.map((def) => def.meta).filter((m) => m !== undefined),
  ];
  return inputs.map((input) =>
    unitLabels(
      normalizeMeta({ dataName: '', type: 'float', category: 'data' }, input),
    ),
  );
}

const PLACEMENT_OPTIONS: { id: UnitPlacement; label: string }[] = [
  { id: 'off', label: 'off' },
  { id: 'value', label: 'value' },
  { id: 'header', label: 'header' },
];

/** Locale override. '' means "let the runtime decide". */
const LOCALES: { id: string; label: string }[] = [
  { id: '', label: 'Auto' },
  { id: 'en-US', label: 'en-US' },
  { id: 'en-GB', label: 'en-GB' },
  { id: 'de-DE', label: 'de-DE' },
  { id: 'fr-FR', label: 'fr-FR' },
  { id: 'en-IN', label: 'en-IN' },
  { id: 'ja-JP', label: 'ja-JP' },
];

/** The source rows, exactly as given. */
function sourceRows(data: Row[] | DatasetJson): Row[] {
  return Array.isArray(data) ? data : data.rows;
}

/**
 * A flat view of every source field, deliberately stripped of everything the
 * library would otherwise contribute: raw field names as headers (not
 * `displayName`), and `inheritUnitFormat: false` so no format is deduced from
 * metadata. What you see is what was in the JSON — the RFC3339 text rather than
 * a weekday, the ratio rather than a percentage.
 */
function rawView(rows: Row[]): TableSpec {
  const fields: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        fields.push(key);
      }
    }
  }
  return {
    mode: 'flat',
    columns: fields.map((id) => ({ id, label: id, inheritUnitFormat: false })),
  };
}

/** Time-zone override. '' means 'auto' — the runtime's zone. */
const TIME_ZONES: { id: string; label: string }[] = [
  { id: '', label: 'Auto' },
  { id: 'UTC', label: 'UTC' },
  { id: 'America/New_York', label: 'New York' },
  { id: 'Europe/Berlin', label: 'Berlin' },
  { id: 'Asia/Tokyo', label: 'Tokyo' },
  { id: 'Pacific/Auckland', label: 'Auckland' },
];

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
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
        onChange={(e) => onChange(e.target.value as T)}
        style={{
          padding: '4px 6px',
          borderRadius: 6,
          border: '1px solid var(--btn-border)',
          background: 'var(--btn-bg)',
          color: 'var(--btn-fg)',
          fontSize: 12,
        }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
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
  const [locale, setLocale] = useState('');
  const [timeZone, setTimeZone] = useState('');
  const [showSource, setShowSource] = useState(false);

  const example = EXAMPLES.find((e) => e.id === selected)!;
  const isRegression = example.id === 'regression';

  // Overriding the view's locale changes number separators and, for currency
  // units, where the symbol sits and how many decimals it takes. Memoized so
  // the engine is not re-run on unrelated renders.
  const view = useMemo(() => {
    if (!locale && !timeZone) return example.view;
    return {
      ...example.view,
      ...(locale ? { locale } : {}),
      ...(timeZone ? { timeZone } : {}),
    };
  }, [example.view, locale, timeZone]);

  // Only a view that derives something can be affected by the zone.
  const usesTime = view.derive !== undefined;

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

  // The collapsible at the bottom renders these; both memoized so opening it
  // does not re-derive on every render.
  const sourceData = useMemo(() => sourceRows(data), [data]);
  const sourceView = useMemo(() => rawView(sourceData), [sourceData]);

  // Placement controls appear only where they'd do something, and split into
  // two only where a single column has both halves to place. Ticker's `$` and
  // `%` live on different columns, so one control covers it; metrics has
  // `ms`/`MiB`, where scale and unit really can go to different places.
  const labels = useMemo(() => collectLabels(data, view), [data, view]);
  const hasUnits = labels.some((l) => l.full !== '');
  const hasSplit = labels.some((l) => l.scalePart !== '' && l.unitPart !== '');

  function setBoth(v: UnitPlacement) {
    setUnitPlacement(v);
    setScalePlacement(v);
  }

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
        <div
          style={{
            display: 'flex',
            gap: 8,
            flex: '0 0 auto',
            alignItems: 'center',
          }}
        >
          <Select
            label="locale"
            value={locale}
            options={LOCALES}
            onChange={setLocale}
          />
          {usesTime && (
            <Select
              label="zone"
              value={timeZone}
              options={TIME_ZONES}
              onChange={setTimeZone}
            />
          )}
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

      {hasUnits && (
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            marginBottom: 10,
          }}
        >
          {hasSplit ? (
            <>
              <Select
                label="unit"
                value={unitPlacement}
                options={PLACEMENT_OPTIONS}
                onChange={setUnitPlacement}
              />
              <Select
                label="scale"
                value={scalePlacement}
                options={PLACEMENT_OPTIONS}
                onChange={setScalePlacement}
              />
            </>
          ) : (
            <Select
              label="units"
              value={unitPlacement}
              options={PLACEMENT_OPTIONS}
              onChange={setBoth}
            />
          )}
        </div>
      )}

      <DataTable
        key={example.id + (stress ? '-stress' : '')}
        data={data}
        view={view}
        height={560}
        theme={theme}
        display={{ ...example.display, unitPlacement, scalePlacement }}
      />

      <p style={{ color: 'var(--page-muted)', fontSize: 12, marginTop: 10 }}>
        {rowCount.toLocaleString()} source rows.
      </p>

      <details
        open={showSource}
        onToggle={(e) => setShowSource(e.currentTarget.open)}
        style={{ marginTop: 4 }}
      >
        <summary
          style={{
            cursor: 'pointer',
            fontSize: 13,
            color: 'var(--page-muted)',
            marginBottom: 10,
          }}
        >
          Source data — the rows as given, before any of the above
        </summary>
        {/* Mounted only while open: the stress fixture is 10k rows. */}
        {showSource && (
          <DataTable
            key={example.id + (stress ? '-stress' : '') + '-src'}
            data={sourceData}
            view={sourceView}
            height={320}
            theme={theme}
          />
        )}
      </details>
    </div>
  );
}
