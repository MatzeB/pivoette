/**
 * Columnar data model. Every column is a plain JS array (nulls allowed), tagged
 * with a coarse type. The `DataFrame` interface hides the representation so a
 * TypedArray/validity-bitmap backend could be swapped in later without touching
 * the engine.
 */

import type { ColumnMeta, ColumnMetaInput } from './meta';

export type ColumnType = 'int' | 'float' | 'string' | 'json';

/** A JSON-ish scalar cell value; `null` marks a missing value. */
export type CellValue = number | string | boolean | null | JsonValue;

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface DataColumn {
  name: string;
  type: ColumnType;
  /** One entry per row; `null` for missing. */
  values: CellValue[];
  /** Display name, category, and unit; deduced at import when not supplied. */
  meta: ColumnMeta;
}

/** A hand-built column: metadata is optional and normalized by `makeFrame`. */
export type DataColumnInput = Omit<DataColumn, 'meta'> & {
  meta?: ColumnMetaInput;
};

export interface DataFrame {
  columns: DataColumn[];
  /** Number of rows (all columns share this length). */
  length: number;
  columnByName: Map<string, DataColumn>;
}

/**
 * The JSON wire shape: metadata travelling next to the rows in one document,
 * keyed by data field name. `fromDataset` also accepts a bare row array.
 */
export interface DatasetJson {
  meta?: Record<string, ColumnMetaInput>;
  rows: Record<string, unknown>[];
}
