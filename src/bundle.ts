/**
 * A self-describing table document: data, metadata, and a view in one JSON
 * file.
 *
 * This is the format an agent writes. Everything in it is plain JSON — that is
 * the property `ViewSpec` has been designed around from the start — so a
 * bundle can be produced by a model, saved to a sandbox, served over HTTP, and
 * rendered without any code travelling with it.
 */
import { fromRows } from './data/import';
import { parseCsv } from './data/csv';
import type { CsvOptions } from './data/csv';
import { mergeMeta, normalizeMeta, storedMagnitude } from './data/meta';
import { isTimestamp } from './data/temporal';
import type { ColumnMetaInput } from './data/meta';
import type { DataFrame } from './data/types';
import { hasLadder, ladderIds } from './format/ladders';
import { aggregationIds } from './pivot/aggregations';
import { autoScaleOf, isFlat } from './pivot/spec';
import type { AutoScaleSpec, ColumnDef, ViewSpec } from './pivot/spec';
import type { DataTableDisplay } from './components/DataTable';

/** Aggregations that mean something over points in time. */
const INSTANT_AGGS = new Set([
  'min',
  'max',
  'first',
  'last',
  'mean',
  'median',
  'p25',
  'p50',
  'p75',
]);

/** Exactly one of `rows`, `csv`, or `url`. */
export interface BundleData {
  /** Inline row objects. */
  rows?: Record<string, unknown>[];
  /** Inline CSV text — around 3-5x smaller than `rows` for tabular data. */
  csv?: string;
  /** Fetched at render time; relative URLs resolve against the bundle's own. */
  url?: string;
  /** For `url` only. Inferred from a `.csv` / `.json` suffix when omitted. */
  format?: 'csv' | 'json';
  /** Passed to the CSV parser for `csv` or a CSV `url`. */
  csvOptions?: CsvOptions;
}

export interface PivoetteBundle {
  /** Format version. 1 is the only one so far. */
  version?: number;
  title?: string;
  data: BundleData;
  /**
   * Per-column metadata keyed by field name: display names, units, and the
   * `encoding` of a timestamp column. Belongs here rather than in `view` when
   * it describes the data itself, so it survives being viewed differently.
   */
  meta?: Record<string, ColumnMetaInput>;
  view: ViewSpec;
  /** Presentation: footer rows, spacing, zebra striping, unit placement. */
  display?: DataTableDisplay;
  height?: number | string;
  theme?: 'auto' | 'light' | 'dark';
}

// --- loading ----------------------------------------------------------------

function formatOf(data: BundleData, url: string): 'csv' | 'json' {
  if (data.format) return data.format;
  return /\.csv(\?|#|$)/i.test(url) ? 'csv' : 'json';
}

/**
 * Resolve a bundle's data to rows, fetching if it points at a URL.
 *
 * `baseUrl` is normally the URL the bundle itself was loaded from, so an agent
 * can write `./sales.csv` next to it in a sandbox directory.
 */
export async function loadRows(
  data: BundleData,
  baseUrl?: string,
): Promise<Record<string, unknown>[]> {
  if (data.rows) return data.rows;
  if (data.csv !== undefined) return parseCsv(data.csv, data.csvOptions);
  if (!data.url) {
    throw new Error('bundle.data needs one of `rows`, `csv`, or `url`');
  }

  const url = baseUrl ? new URL(data.url, baseUrl).href : data.url;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch ${url}: ${response.status}`);
  }
  const text = await response.text();
  if (formatOf(data, url) === 'csv') return parseCsv(text, data.csvOptions);

  const parsed: unknown = JSON.parse(text);
  // Accept a bare row array or the { meta, rows } document shape.
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  const rows = (parsed as { rows?: unknown }).rows;
  if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  throw new Error(`${url} is neither an array of rows nor { rows: [...] }`);
}

/** Build the frame a bundle describes, fetching its data if needed. */
export async function loadBundle(
  bundle: PivoetteBundle,
  baseUrl?: string,
): Promise<DataFrame> {
  return fromRows(await loadRows(bundle.data, baseUrl), bundle.meta);
}

// --- validation -------------------------------------------------------------

/**
 * Check a bundle, returning *every* problem rather than throwing on the first.
 *
 * That matters for the case this format exists for: a model writing a spec
 * gets one list it can fix in a single pass, instead of discovering mistakes
 * one render at a time. Pass the frame to also check field names and types.
 */
export function validateBundle(
  bundle: unknown,
  frame?: DataFrame,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const add = (message: string) => problems.push(message);

  if (!bundle || typeof bundle !== 'object') {
    return { ok: false, problems: ['bundle must be a JSON object'] };
  }
  const b = bundle as Partial<PivoetteBundle>;

  const data = b.data;
  if (!data || typeof data !== 'object') {
    add('`data` is required, with one of `rows`, `csv`, or `url`');
  } else {
    const given = ['rows', 'csv', 'url'].filter(
      (k) => (data as Record<string, unknown>)[k] !== undefined,
    );
    if (given.length === 0) add('`data` needs one of `rows`, `csv`, or `url`');
    if (given.length > 1)
      add(`\`data\` has more than one source: ${given.join(', ')}`);
  }

  if (!b.view || typeof b.view !== 'object') {
    return { ok: false, problems: [...problems, '`view` is required'] };
  }
  const view = b.view;
  const known = frame ? frame.columns.map((c) => c.name) : undefined;
  const derived = Object.keys(view.derive ?? {});
  const fields = known ? [...known, ...derived] : undefined;

  /** Field names must exist, once derived columns are taken into account. */
  const checkField = (field: string, where: string) => {
    if (fields && !fields.includes(field)) {
      add(
        `${where}: no column named "${field}". Available: ${fields.join(', ')}`,
      );
    }
  };

  // The axes first: `isFlat` reads them, so a malformed one has to be caught
  // before anything branches on what kind of view this is.
  for (const axis of ['pivotRows', 'pivotColumns'] as const) {
    const entries = view[axis];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) {
      add(`view.${axis} must be an array (omit it, or use [], for none)`);
      continue;
    }
    entries.forEach((entry, i) => {
      const at = `view.${axis}[${i}]`;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        add(`${at}: must be an object with a \`field\`, not ${typeof entry}`);
      } else if (!entry.field) {
        add(`${at}: \`field\` is required`);
      } else {
        checkField(entry.field, at);
      }
    });
  }

  if (!Array.isArray(view.columns) || view.columns.length === 0) {
    add('a view needs a non-empty `columns`');
    return { ok: false, problems };
  }
  // Every check below — `isFlat` included — reads keys off each entry, so a
  // malformed one has to be reported here rather than thrown from the middle of
  // the validator. Turning bad input into a problem list is the whole job.
  const before = problems.length;
  view.columns.forEach((def, i) => {
    if (!def || typeof def !== 'object' || Array.isArray(def)) {
      const got = Array.isArray(def) ? 'an array' : typeof def;
      add(`view.columns[${i}]: must be an object with an \`id\`, not ${got}`);
    }
  });
  if (problems.length > before) return { ok: false, problems };

  const flat = isFlat(view);
  const aggs = aggregationIds();
  const ids = new Set<string>();
  /** pool name -> the first column in it, for the agreement checks. */
  const pools = new Map<string, { auto: AutoScaleSpec; at: string }>();

  /**
   * A column that asks to be scaled needs a scale that can be measured. An
   * unregistered scale is fine as a *label* — it just cannot be a starting
   * point, so saying `autoScale` over one is a mistake worth naming rather
   * than a silent no-op.
   */
  const checkAutoScale = (
    def: ColumnDef,
    source: string | undefined,
    at: string,
  ) => {
    const auto = autoScaleOf(def);
    if (!auto) {
      if (def.scalePool) add(`${at}: \`scalePool\` needs \`autoScale\``);
      return;
    }

    if (auto.ladder !== undefined && !hasLadder(auto.ladder)) {
      add(
        `${at}: unknown scale ladder "${auto.ladder}". Available: ${ladderIds().join(', ')}`,
      );
    }
    if (auto.per === 'value' && def.scalePool) {
      add(
        `${at}: \`scalePool\` and \`per: 'value'\` conflict; a pool exists to pick one scale`,
      );
    }

    // Same layering the engine does: the frame's metadata, then `view.meta`
    // (applied by `withMeta` in `prepare`), then the column's own `meta` on top
    // (by `columnMeta`). Getting that order backwards rejected a column that
    // overrides an unmeasurable view-level unit with a measurable one.
    const declared = source ? view.meta?.[source] : undefined;
    const fromFrame = source
      ? frame?.columnByName.get(source)?.meta
      : undefined;
    const fallback = {
      dataName: source ?? def.id,
      type: 'float' as const,
      category: 'data' as const,
    };
    const viewLevel =
      declared || fromFrame
        ? normalizeMeta(fromFrame ?? fallback, { ...fromFrame, ...declared })
        : undefined;
    const meta = def.meta
      ? normalizeMeta(
          viewLevel ?? fallback,
          mergeMeta(viewLevel, def.meta) ?? def.meta,
        )
      : viewLevel;
    if (meta && storedMagnitude(meta) === undefined) {
      add(
        `${at}: \`autoScale\` needs a measurable \`unit\`/\`scale\`; ` +
          `"${source}" has none, or a compound one that cannot scale`,
      );
    }

    if (!def.scalePool) return;
    const first = pools.get(def.scalePool);
    if (!first) {
      pools.set(def.scalePool, { auto, at });
      return;
    }
    if (first.auto.ladder !== auto.ladder) {
      add(
        `${at}: pool "${def.scalePool}" disagrees with ${first.at} about the ladder`,
      );
    }
    if ((first.auto.per ?? 'column') !== (auto.per ?? 'column')) {
      add(
        `${at}: pool "${def.scalePool}" disagrees with ${first.at} about \`per\``,
      );
    }
  };

  view.columns.forEach((def, i) => {
    const at = `view.columns[${i}]`;
    if (!def.id) add(`${at}: \`id\` is required`);
    else if (ids.has(def.id)) add(`${at}: duplicate id "${def.id}"`);
    else ids.add(def.id);

    // `source` defaults to `id`; a computed or composite column names no field
    // of its own unless it says so.
    const source =
      def.compute || def.composite ? def.source : (def.source ?? def.id);
    if (source) checkField(source, at);

    if (def.agg !== undefined) {
      if (!def.agg) add(`${at}: \`agg\` is empty; omit it for a plain column`);
      else if (!def.expression && !aggs.includes(def.agg)) {
        add(`${at}: unknown agg "${def.agg}". Available: ${aggs.join(', ')}`);
      }
      const column = source ? frame?.columnByName.get(source) : undefined;
      // A non-numeric column can still be counted, just not summed.
      const counts = def.agg === 'count' || def.agg === 'countDistinct';
      // A declared timestamp aggregates as instants (see `measureValues`):
      // the latest or middle one means something, their sum does not.
      const instants =
        source !== undefined &&
        (isTimestamp(column?.meta) ||
          [view.meta?.[source]?.kind].flat().includes('timestamp'));
      if (instants) {
        if (!counts && !INSTANT_AGGS.has(def.agg)) {
          add(
            `${at}: "${source}" holds timestamps; ${def.agg} does not apply to them. Use one of: ${[...INSTANT_AGGS].join(', ')}`,
          );
        }
      } else if (
        column &&
        !counts &&
        column.type !== 'int' &&
        column.type !== 'float'
      ) {
        add(
          `${at}: "${source}" is ${column.type}; ${def.agg} needs a number column`,
        );
      }
    }

    checkAutoScale(def, source, at);

    // Coherence. A pivot groups its source rows away, so every column has to
    // say how it survives that; a flat view has no groups to aggregate over.
    if (flat) {
      if (def.place) add(`${at}: \`place\` needs a pivot view`);
    } else if (def.agg === undefined && !def.compute) {
      add(
        `${at}: "${def.id}" neither aggregates nor computes; a pivot column ` +
          'needs `agg` (or `compute`, for a derived column)',
      );
    }
  });

  // Computed axis members. The engine reads them off the innermost column
  // level — that is what tells it how often each one repeats — so the places it
  // would not look for them are worth saying out loud rather than dropping.
  const columnLevels = view.pivotColumns ?? [];
  (view.pivotRows ?? []).forEach((entry, i) => {
    if (entry?.computed) {
      add(
        `view.pivotRows[${i}]: \`computed\` is supported on \`pivotColumns\`; ` +
          'a computed member of a row level would have to synthesize rows',
      );
    }
  });
  columnLevels.forEach((entry, i) => {
    const members = entry?.computed;
    if (!members) return;
    const at = `view.pivotColumns[${i}]`;
    if (i !== columnLevels.length - 1) {
      add(
        `${at}: only the innermost column level may carry \`computed\`; ` +
          `"${entry.field}" has ${columnLevels.length - 1 - i} level(s) inside it`,
      );
    }
    if (view.columnAxis === 'pivotRows') {
      add(`${at}: \`computed\` needs the columns level on \`pivotColumns\``);
    }

    if (!Array.isArray(members)) {
      add(`${at}: \`computed\` must be an array`);
      return;
    }
    const memberIds = new Set<string>();
    members.forEach((member, j) => {
      const mAt = `${at}.computed[${j}]`;
      if (!member?.id) add(`${mAt}: \`id\` is required`);
      else if (memberIds.has(member.id)) {
        add(`${mAt}: duplicate id "${member.id}"`);
      } else memberIds.add(member.id);
      if (!member?.compute) {
        add(`${mAt}: \`compute\` is required; a computed member has no source`);
      }
      for (const [alias, ref] of Object.entries(member?.inputs ?? {})) {
        if (!ref?.member) {
          add(`${mAt}: inputs.${alias} needs a \`member\` of this level`);
        }
      }
    });
  });

  // Measures on the row axis put cells from *different* measures down one
  // rendered column, so there is no single column for a scale to belong to.
  // Better to say so than to accept the spec and quietly not scale.
  if (view.columnAxis === 'pivotRows') {
    view.columns.forEach((def, i) => {
      if (autoScaleOf(def)) {
        add(
          `view.columns[${i}]: \`autoScale\` needs the columns level on ` +
            '`pivotColumns`; with measures on the row axis one rendered ' +
            'column holds several measures',
        );
      }
    });
  }

  if (flat) {
    if (view.showSummary) add('view.showSummary needs a pivot view');
    if (view.columnAxis) add('view.columnAxis needs a pivot view');
  } else if (view.sort) {
    add(
      'view.sort is flat-only; a pivot sorts per level, via `pivotRows[].sort`',
    );
  }

  return { ok: problems.length === 0, problems };
}

// --- describing -------------------------------------------------------------

export interface ColumnSummary {
  name: string;
  type: string;
  /** `index` groups; `data` aggregates. */
  category: string;
  /** Distinct value count, capped — enough to tell a key from a category. */
  distinct: number;
  /** A few real values, for recognising the column. */
  samples: unknown[];
  nulls: number;
}

/**
 * Summarize a frame's columns so an agent can write a view without guessing.
 *
 * The intended loop is: write the data, describe it, then write the bundle —
 * `category` says which columns can be grouped and which can be aggregated,
 * which is the decision a view mostly consists of.
 */
export function describeFrame(frame: DataFrame, samples = 3): ColumnSummary[] {
  return frame.columns.map((column) => {
    const seen = new Set<unknown>();
    const examples: unknown[] = [];
    let nulls = 0;
    for (const value of column.values) {
      if (value === null || value === undefined) {
        nulls++;
        continue;
      }
      // Cap the set: a 60k-row id column would otherwise be counted in full.
      if (seen.size < 1000) seen.add(value);
      if (examples.length < samples && !examples.includes(value)) {
        examples.push(value);
      }
    }
    return {
      name: column.name,
      type: column.type,
      category: column.meta.category,
      distinct: seen.size,
      samples: examples,
      nulls,
    };
  });
}
