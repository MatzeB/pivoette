import { useEffect, useMemo, useState } from 'react';
import {
  DataTable,
  ViewEditor,
  autoScaleOf,
  fromRows,
  parseCsv,
  normalizeMeta,
  unitLabels,
} from '../src';
import type {
  ColumnMetaInput,
  UnitLabels,
  DataTableDisplay,
  DatasetJson,
  UnitPlacement,
  ViewSpec,
} from '../src';

import {
  view as tickerView,
  display as tickerDisplay,
} from './examples/ticker/view';
import tickerData from './examples/ticker/data.json';
import {
  view as benchmarkView,
  display as benchmarkDisplay,
} from './examples/benchmark/view';
import benchmarkData from './examples/benchmark/data.json';
import {
  view as regressionView,
  display as regressionDisplay,
} from './examples/regression/view';
// CSV rather than JSON, to exercise the csv importer end to end.
import regressionCsv from './examples/regression/data.csv?raw';
import {
  view as tokensView,
  display as tokensDisplay,
} from './examples/tokens/view';
import tokensData from './examples/tokens/data.json';
import {
  view as metricsView,
  display as metricsDisplay,
} from './examples/metrics/view';
import metricsData from './examples/metrics/data.json';
import {
  view as commitsView,
  display as commitsDisplay,
} from './examples/commits/view';
import commitsData from './examples/commits/data.json';

import tickerSrc from './examples/ticker/view?raw';
import benchmarkSrc from './examples/benchmark/view?raw';
import regressionSrc from './examples/regression/view?raw';
import tokensSrc from './examples/tokens/view?raw';
import metricsSrc from './examples/metrics/view?raw';
import commitsSrc from './examples/commits/view?raw';

type Row = Record<string, unknown>;

interface Example {
  id: string;
  title: string;
  blurb: string;
  view: ViewSpec;
  /** Rows, or the `{meta, rows}` wire form carrying column metadata. */
  data: Row[] | DatasetJson;
  /** The example's own `view.ts` — view spec *and* display — shown verbatim
   * in the panels below. */
  source: string;
  display?: DataTableDisplay;
}

const EXAMPLES: Example[] = [
  {
    id: 'ticker',
    title: '1 · Stock ticker (flat)',
    blurb:
      'Flat detail table: composite asset cell (image + description, sorted by description), computed P/L, red/green by sign. Column metadata is declared in the view over plain JSON rows — the 2-decimal money format is deduced from kind `price`, and the `$` follows the placement toggle (leading the number, inside the sign).',
    view: tickerView,
    source: tickerSrc,
    data: tickerData as Row[],
    display: tickerDisplay,
  },
  {
    id: 'benchmark',
    title: '2 · Kernel benchmark (pivot)',
    blurb:
      'Frameless spacing-based design: grouped size/arch blocks, sticky multi-level header, and a 3-line footer (avg / median / sum).',
    view: benchmarkView,
    source: benchmarkSrc,
    data: benchmarkData as Row[],
    display: benchmarkDisplay,
  },
  {
    id: 'regression',
    title: '3 · Before/after regression',
    blurb:
      'Loaded from CSV via `parseCsv` — column types are inferred per column, so `timeNs` arrives as numbers. Per-platform derived Δ% referencing each platform’s own before/after cells; faster is green, regressions red.',
    view: regressionView,
    source: regressionSrc,
    data: parseCsv(regressionCsv),
    display: regressionDisplay,
  },
  {
    id: 'tokens',
    title: '4 · AI token spend (multi-level rows)',
    blurb:
      'Nested rows team → project → model, compact K/M/B token counts, computed Total column, grand-total summary footer. Two units side by side: the counts are `tok`, the price is `$` — both follow the placement toggle.',
    view: tokensView,
    source: tokensSrc,
    data: tokensData as Row[],
    display: tokensDisplay,
  },
  {
    id: 'metrics',
    title: '5 · Fleet metrics (column metadata)',
    blurb:
      'Headers and units come from column metadata shipped with the data. Compound units (ktok/s, MB/s, m²) move as one label; simple ones (ms, MiB) can split scale onto the value and unit into the header.',
    view: metricsView,
    source: metricsSrc,
    data: metricsData as DatasetJson,
    display: metricsDisplay,
  },
  {
    id: 'commits',
    title: '6 · Commits by weekday (dates)',
    blurb:
      'The timestamp column declares its own encoding in the data; the view derives a weekday from it with `weekday(committedAt)`. The integers 0–6 sort into calendar order by themselves, and kind `weekday` deduces the format that names them. Locale re-orders and renames the columns; time zone moves commits between them.',
    view: commitsView,
    source: commitsSrc,
    data: commitsData as DatasetJson,
    display: commitsDisplay,
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
  const inputs: ColumnMetaInput[] = [
    ...(Array.isArray(data) ? [] : Object.values(data.meta ?? {})),
    ...Object.values(view.meta ?? {}),
    ...view.columns.map((def) => def.meta).filter((m) => m !== undefined),
  ];
  return inputs.map((input) =>
    unitLabels(
      normalizeMeta({ dataName: '', type: 'float', category: 'data' }, input),
    ),
  );
}

/** Whether an auto-scaled column picks one scale or one per cell. */
const SCALE_PER_OPTIONS: { id: 'column' | 'value'; label: string }[] = [
  { id: 'column', label: 'per column' },
  { id: 'value', label: 'per value' },
];

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
function rawView(rows: Row[]): ViewSpec {
  // `fromRows` already unions the keys in first-seen order.
  return {
    columns: fromRows(rows).columns.map((c) => ({
      id: c.name,
      label: c.name,
      inheritUnitFormat: false,
    })),
  };
}

/** A collapsible panel; its body is mounted only while open. */
function Panel({
  title,
  children,
}: {
  title: string;
  children: () => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      style={{ marginTop: 6 }}
    >
      <summary
        style={{
          cursor: 'pointer',
          fontSize: 13,
          color: 'var(--page-muted)',
          marginBottom: 8,
        }}
      >
        {title}
      </summary>
      {open && children()}
    </details>
  );
}

/** Monospaced source listing, scrollable rather than page-widening. */
function Source({ text }: { text: string }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: '12px 14px',
        borderRadius: 8,
        border: '1px solid var(--btn-border)',
        background: 'var(--btn-bg)',
        color: 'var(--page-text)',
        fontSize: 12,
        lineHeight: 1.5,
        maxHeight: 420,
        overflow: 'auto',
      }}
    >
      {text}
    </pre>
  );
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
  // One scale for the column, or one per cell. The tradeoff is the point: a
  // column-wide scale can hoist its label into the header and be scanned at a
  // glance; a per-cell one keeps every value in its own natural unit but must
  // carry the label, so `4.34 µs` and `521 ns` sit side by side.
  const [scalePer, setScalePer] = useState<'column' | 'value'>('column');
  const [locale, setLocale] = useState('');
  const [timeZone, setTimeZone] = useState('');

  const example = EXAMPLES.find((e) => e.id === selected)!;
  const isRegression = example.id === 'regression';

  // Editing makes the spec state rather than a constant. Seeded from the
  // example and reset whenever it changes, so switching examples starts clean.
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState<ViewSpec | null>(null);
  const [editedDisplay, setEditedDisplay] = useState<DataTableDisplay | null>(
    null,
  );
  // Dropped during render, not in an effect. An effect runs after the paint,
  // which leaves one render with the previous example's spec over this
  // example's data — and the engine throws on a field that is not there,
  // taking the whole page down rather than showing the new example.
  const [editedFor, setEditedFor] = useState(selected);
  const staleEdit = editedFor !== selected;
  if (staleEdit) {
    setEditedFor(selected);
    setEdited(null);
    setEditedDisplay(null);
  }

  // `e` toggles editing, except while a form control has focus — the locale
  // and placement selects would otherwise swallow or fight for the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'e' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (
        el?.isContentEditable ||
        (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName))
      ) {
        return;
      }
      e.preventDefault();
      setEditing((v) => !v);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Overriding the view's locale changes number separators and, for currency
  // units, where the symbol sits and how many decimals it takes. Memoized so
  // the engine is not re-run on unrelated renders.
  // The re-render React schedules above is what actually clears these; reading
  // through `staleEdit` keeps the discarded pass coherent too.
  const baseView = (staleEdit ? null : edited) ?? example.view;
  const view = useMemo(() => {
    const scaled =
      scalePer === 'column'
        ? baseView
        : {
            ...baseView,
            columns: baseView.columns.map((c) =>
              autoScaleOf(c) === undefined
                ? c
                : // A pool exists to pick *one* scale, so it means nothing once
                  // every cell picks its own — drop it rather than leave the
                  // spec self-contradictory.
                  {
                    ...c,
                    autoScale: { per: 'value' as const },
                    scalePool: undefined,
                  },
            ),
          };
    if (!locale && !timeZone) return scaled;
    return {
      ...scaled,
      ...(locale ? { locale } : {}),
      ...(timeZone ? { timeZone } : {}),
    };
  }, [baseView, locale, timeZone, scalePer]);

  const display = (staleEdit ? null : editedDisplay) ?? example.display ?? {};

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
  const sourceData = sourceRows(data);
  const sourceView = useMemo(() => rawView(sourceData), [sourceData]);
  // Only some examples ship metadata with the data; ticker declares its own in
  // the view, which the view-spec panel already shows.
  const datasetMeta = Array.isArray(data) ? undefined : data.meta;

  // Placement controls appear only where they'd do something, and split into
  // two only where a single column has both halves to place. Ticker's `$` and
  // `%` live on different columns, so one control covers it; metrics has
  // `ms`/`MiB`, where scale and unit really can go to different places.
  const labels = useMemo(() => collectLabels(data, view), [data, view]);
  const hasUnits = labels.some((l) => l.full !== '');
  const hasSplit = labels.some((l) => l.scalePart !== '' && l.unitPart !== '');
  /** Only a view that lets the data pick a scale has anything to switch. */
  const hasAutoScale = view.columns.some((c) => autoScaleOf(c) !== undefined);

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
              label="timezone"
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
          {hasAutoScale && (
            <Select
              label="scaling"
              value={scalePer}
              options={SCALE_PER_OPTIONS}
              onChange={setScalePer}
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
        display={{ ...display, unitPlacement, scalePlacement }}
        editing={editing}
        onViewChange={setEdited}
        onDisplayChange={setEditedDisplay}
      />

      {/* Below the table rather than beside it: the panel used to take its
          width out of the table, which is the one thing being edited. */}
      {editing && (
        <div style={{ marginTop: 10 }}>
          {/* No `frame`: the panel shows the spec, so raw field names are the
              right identifiers here — they are what the config says. */}
          <ViewEditor
            view={view}
            display={display}
            theme={theme}
            onViewChange={setEdited}
            onDisplayChange={setEditedDisplay}
          />
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginTop: 10,
        }}
      >
        <button
          onClick={() => setEditing((v) => !v)}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid var(--btn-border)',
            cursor: 'pointer',
            background: editing ? 'var(--btn-active-bg)' : 'var(--btn-bg)',
            color: editing ? 'var(--btn-active-fg)' : 'var(--btn-fg)',
            fontSize: 12,
          }}
        >
          {editing ? 'Done editing' : 'Edit'}
        </button>
        {editing && (
          <button
            disabled={!edited && !editedDisplay}
            onClick={() => {
              setEdited(null);
              setEditedDisplay(null);
            }}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid var(--btn-border)',
              background: 'var(--btn-bg)',
              color: 'var(--btn-fg)',
              cursor: edited || editedDisplay ? 'pointer' : 'default',
              opacity: edited || editedDisplay ? 1 : 0.45,
              fontSize: 12,
            }}
          >
            Reset to the example
          </button>
        )}
        <span style={{ color: 'var(--page-muted)', fontSize: 12 }}>
          {rowCount.toLocaleString()} source rows · press{' '}
          <kbd
            style={{
              padding: '1px 5px',
              borderRadius: 4,
              border: '1px solid var(--btn-border)',
              background: 'var(--btn-bg)',
              color: 'var(--btn-fg)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 11,
            }}
          >
            e
          </kbd>{' '}
          to {editing ? 'stop editing' : 'edit'}
        </span>
      </div>

      <Panel title="Example config — the view spec and display that produce the table above">
        {() => <Source text={example.source} />}
      </Panel>

      {datasetMeta && (
        <Panel title="Column metadata — shipped alongside the rows in data.json">
          {() => <Source text={JSON.stringify(datasetMeta, null, 2)} />}
        </Panel>
      )}

      <Panel title="Source data — the rows as given, before any of the above">
        {/* Mounted only while open: the stress fixture is 10k rows. */}
        {() => (
          <DataTable
            key={example.id + (stress ? '-stress' : '') + '-src'}
            data={sourceData}
            view={sourceView}
            height={320}
            theme={theme}
          />
        )}
      </Panel>
    </div>
  );
}
