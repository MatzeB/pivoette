import { deduceCategory, mergeMeta, normalizeMeta } from './meta';
import type { ColumnMetaInput } from './meta';
import type { DataColumn, DataColumnInput, DataFrame } from './types';

/**
 * Build a `DataFrame` from already-columnar data. Validates that every column
 * has the same length, and normalizes (or deduces) each column's metadata.
 */
export function makeFrame(columns: DataColumnInput[]): DataFrame {
  const length = columns.length > 0 ? columns[0]!.values.length : 0;
  for (const col of columns) {
    if (col.values.length !== length) {
      throw new Error(
        `Column "${col.name}" has length ${col.values.length}, expected ${length}`,
      );
    }
  }
  const resolved: DataColumn[] = columns.map((col) => {
    // A caller-supplied `meta.type` overrides inference for the column too.
    const type = col.meta?.type ?? col.type;
    const meta = normalizeMeta(
      { dataName: col.name, type, category: deduceCategory(type) },
      col.meta,
    );
    return { ...col, type, meta };
  });
  const columnByName = new Map<string, DataColumn>();
  for (const col of resolved) columnByName.set(col.name, col);
  return { columns: resolved, length, columnByName };
}

/**
 * Layer metadata over an existing frame, keyed by field name. Each column's
 * current metadata is the base and the supplied fields win, so a view can
 * annotate plain JSON data (the typical case) or refine what the data shipped
 * with. Value arrays are shared, not copied.
 */
export function withMeta(
  frame: DataFrame,
  overrides: Record<string, ColumnMetaInput> | undefined,
): DataFrame {
  if (!overrides) return frame;
  // Only overridden columns are rebuilt, and the frame is assembled directly
  // rather than through `makeFrame`: re-normalizing untouched columns would
  // mint fresh ColumnMeta objects and drop their memoized labels for nothing.
  // Lengths are already validated and the value arrays are shared, not copied.
  let changed = false;
  const columns = frame.columns.map((col) => {
    const override = overrides[col.name];
    if (!override) return col;
    changed = true;
    const meta = normalizeMeta(col.meta, mergeMeta(col.meta, override));
    return { ...col, type: meta.type, meta };
  });
  if (!changed) return frame;
  const columnByName = new Map<string, DataColumn>();
  for (const col of columns) columnByName.set(col.name, col);
  return { columns, length: frame.length, columnByName };
}

/** Look up a column, throwing a helpful error if the field is unknown. */
export function requireColumn(frame: DataFrame, name: string): DataColumn {
  const col = frame.columnByName.get(name);
  if (!col) {
    const known = frame.columns.map((c) => c.name).join(', ');
    throw new Error(`Unknown field "${name}". Available: ${known}`);
  }
  return col;
}
