/**
 * Virtual columns, computed from the others before grouping happens.
 *
 * `rows`/`columns` in a pivot must name real columns, so grouping by something
 * derived — the weekday of a commit, the month of an order — needs the column
 * to exist first. A derived field is an ordinary `compute` expression plus
 * metadata, which is what lets `kind: ['weekday']` supply its own labels and
 * ordering downstream.
 */
import { compileExpression } from '../format/expression';
import { makeFrame } from './frame';
import { decodeTime, isTimestamp, temporalHelpers } from './temporal';
import type {
  CellValue,
  ColumnType,
  DataColumnInput,
  DataFrame,
} from './types';
import type { DerivedField } from '../pivot/spec';

/**
 * Append a column per derived field. Fields are evaluated in declaration order,
 * so a later one can reference an earlier one.
 *
 * A column whose metadata declares a timestamp is decoded to epoch millis once
 * per row here, rather than re-parsed inside every helper call. A source field
 * shadows a temporal helper of the same name — the parameter list is deduped
 * with the column winning, which also keeps `new Function` from being handed a
 * duplicate parameter name.
 */
export function deriveColumns(
  frame: DataFrame,
  derive: Record<string, DerivedField> | undefined,
  locale?: string,
  timeZone?: string,
): DataFrame {
  const entries = Object.entries(derive ?? {});
  if (entries.length === 0) return frame;

  const helpers = temporalHelpers(locale, timeZone);
  const helperNames = Object.keys(helpers);

  const columns: DataColumnInput[] = [...frame.columns];
  /** Per source column: its values, and its meta when it needs decoding. */
  const decodeMeta = frame.columns.map((col) =>
    isTimestamp(col.meta) ? col.meta : undefined,
  );

  for (const [name, field] of entries) {
    const colNames = columns.map((c) => c.name);
    const shadowed = new Set(colNames);
    const visible = helperNames.filter((h) => !shadowed.has(h));
    const names = [...visible, ...colNames];

    const argv: unknown[] = new Array(names.length);
    visible.forEach((h, i) => (argv[i] = helpers[h]));
    const base = visible.length;

    const fn = compileExpression(field.compute, names);
    const values: CellValue[] = new Array(frame.length);
    for (let r = 0; r < frame.length; r++) {
      for (let c = 0; c < columns.length; c++) {
        const raw = columns[c]!.values[r] ?? null;
        const meta = decodeMeta[c];
        argv[base + c] = meta ? decodeTime(raw, meta) : raw;
      }
      let out: unknown;
      try {
        out = fn(...argv);
      } catch {
        out = null;
      }
      values[r] = (out ?? null) as CellValue;
    }
    columns.push({
      name,
      type: inferDerived(values),
      values,
      meta: field.meta,
    });
  }
  return makeFrame(columns);
}

/** Narrow inference for computed output: numbers or, failing that, strings. */
function inferDerived(values: CellValue[]): ColumnType {
  let sawValue = false;
  let allInts = true;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    sawValue = true;
    if (typeof v !== 'number') return 'string';
    if (!Number.isInteger(v)) allInts = false;
  }
  if (!sawValue) return 'string';
  return allInts ? 'int' : 'float';
}
