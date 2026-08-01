import { makeFrame } from './frame';
import type { CellValue, ColumnType, DataColumn, DataFrame } from './types';

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
function inferType(values: CellValue[]): ColumnType {
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
 */
export function fromRows(rows: Record<string, unknown>[]): DataFrame {
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

  const columns: DataColumn[] = fieldOrder.map((name) => {
    const values: CellValue[] = rows.map((row) =>
      Object.prototype.hasOwnProperty.call(row, name)
        ? normalize(row[name])
        : null,
    );
    return { name, type: inferType(values), values };
  });

  return makeFrame(columns);
}
