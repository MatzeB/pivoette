import { makeFrame } from './frame';
import type { ColumnMeta, ColumnMetaInput } from './meta';
import type {
  CellValue,
  ColumnType,
  DataColumnInput,
  DataFrame,
  DatasetJson,
} from './types';

/** True if a JS number has no fractional part (and is finite). */
function isInteger(n: number): boolean {
  return Number.isFinite(n) && Math.floor(n) === n;
}

/**
 * Infer a column's coarse type from its non-null values. Rules:
 *  - `int` if every non-null value is an integer number
 *  - `float` if all numeric but at least one is fractional/non-integer
 *  - `json` if any value is an object or array
 *  - `string` otherwise (incl. booleans coerced at read time)
 * An all-null column defaults to `string`.
 */
export function inferType(values: CellValue[]): ColumnType {
  let sawValue = false;
  let allNumbers = true;
  let allIntegers = true;
  let sawJson = false;

  for (const v of values) {
    if (v === null || v === undefined) continue;
    sawValue = true;
    if (typeof v === 'number') {
      if (!isInteger(v)) allIntegers = false;
    } else if (typeof v === 'object') {
      sawJson = true;
      allNumbers = false;
    } else {
      allNumbers = false;
    }
  }

  if (!sawValue) return 'string';
  if (sawJson) return 'json';
  if (allNumbers) return allIntegers ? 'int' : 'float';
  return 'string';
}

/** Normalize a raw JSON value into a `CellValue` (undefined → null). */
function normalize(v: unknown): CellValue {
  return v === undefined ? null : (v as CellValue);
}

/**
 * Build a `DataFrame` from an array of row objects (rows of dicts). The column
 * set is the union of all keys, in first-seen order. Missing keys become null.
 *
 * `meta` supplies per-column metadata keyed by field name; anything omitted
 * (including whole columns) is deduced from the scan.
 */
export function fromRows(
  rows: Record<string, unknown>[],
  meta?: Record<string, ColumnMetaInput>,
): DataFrame {
  const fieldOrder: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        fieldOrder.push(key);
      }
    }
  }

  const columns: DataColumnInput[] = fieldOrder.map((name) => {
    const values: CellValue[] = rows.map((row) =>
      Object.prototype.hasOwnProperty.call(row, name)
        ? normalize(row[name])
        : null,
    );
    return { name, type: inferType(values), values, meta: meta?.[name] };
  });

  return makeFrame(columns);
}

/**
 * Build a `DataFrame` from a JSON dataset — either the `{ meta, rows }` wrapper
 * that carries metadata alongside the data, or a bare row array.
 */
export function fromDataset(
  input: DatasetJson | Record<string, unknown>[],
): DataFrame {
  return Array.isArray(input)
    ? fromRows(input)
    : fromRows(input.rows, input.meta);
}

/**
 * Extract a frame's metadata in wire form. `ColumnMeta` is plain JSON, so
 * `JSON.stringify({ meta: datasetMeta(frame), rows })` is the whole serializer.
 */
export function datasetMeta(frame: DataFrame): Record<string, ColumnMeta> {
  const out: Record<string, ColumnMeta> = {};
  for (const col of frame.columns) out[col.name] = col.meta;
  return out;
}
