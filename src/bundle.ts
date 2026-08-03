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
import type { ColumnMetaInput } from './data/meta';
import type { DataFrame } from './data/types';
import { aggregationIds } from './pivot/aggregations';
import { isFlat } from './pivot/spec';
import type { ViewSpec } from './pivot/spec';
import type { DataTableDisplay } from './components/DataTable';

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
    if (given.length > 1) add(`\`data\` has more than one source: ${given.join(', ')}`);
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
      add(`${where}: no column named "${field}". Available: ${fields.join(', ')}`);
    }
  };

  if (isFlat(view)) {
    if (!Array.isArray(view.columns) || view.columns.length === 0) {
      add('a flat view needs a non-empty `columns`');
    } else {
      view.columns.forEach((def, i) => {
        if (!def.id) add(`view.columns[${i}]: \`id\` is required`);
        // `source` defaults to `id`; a computed column names no field.
        if (!def.compute && !def.composite) checkField(def.source ?? def.id, `view.columns[${i}]`);
      });
    }
    return { ok: problems.length === 0, problems };
  }

  for (const axis of ['rows', 'columns'] as const) {
    if (!Array.isArray(view[axis])) {
      add(`view.${axis} must be an array (use [] for none)`);
      continue;
    }
    view[axis].forEach((field, i) => checkField(field, `view.${axis}[${i}]`));
  }

  if (!Array.isArray(view.values) || view.values.length === 0) {
    add('view.values needs at least one measure');
  } else {
    const aggs = aggregationIds();
    const ids = new Set<string>();
    view.values.forEach((value, i) => {
      const at = `view.values[${i}]`;
      if (!value.id) add(`${at}: \`id\` is required`);
      else if (ids.has(value.id)) add(`${at}: duplicate id "${value.id}"`);
      else ids.add(value.id);

      if (!value.field) add(`${at}: \`field\` is required`);
      else {
        checkField(value.field, at);
        const column = frame?.columnByName.get(value.field);
        // A non-numeric column can still be counted, just not summed.
        const counts = value.agg === 'count' || value.agg === 'countDistinct';
        if (column && !counts && column.type !== 'int' && column.type !== 'float') {
          add(`${at}: "${value.field}" is ${column.type}; ${value.agg} needs a number column`);
        }
      }
      if (!value.agg) add(`${at}: \`agg\` is required`);
      else if (!value.expression && !aggs.includes(value.agg)) {
        add(`${at}: unknown agg "${value.agg}". Available: ${aggs.join(', ')}`);
      }
    });
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
