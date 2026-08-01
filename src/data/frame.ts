import type { DataColumn, DataFrame } from './types';

/**
 * Build a `DataFrame` from already-columnar data. Validates that every column
 * has the same length.
 */
export function makeFrame(columns: DataColumn[]): DataFrame {
  const length = columns.length > 0 ? columns[0]!.values.length : 0;
  for (const col of columns) {
    if (col.values.length !== length) {
      throw new Error(
        `Column "${col.name}" has length ${col.values.length}, expected ${length}`,
      );
    }
  }
  const columnByName = new Map<string, DataColumn>();
  for (const col of columns) columnByName.set(col.name, col);
  return { columns, length, columnByName };
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
