/**
 * The declarative configuration language. `ViewSpec` is the top-level contract
 * a future interactive editor will manipulate; it is fully serializable except
 * for the optional inline `fn` escape hatches on format/style/render specs.
 */
import type { CellRender, FormatFn, StyleFn } from '../format/context';
import type { ColumnMetaInput } from '../data/meta';

export type Direction = 'asc' | 'desc';

/** Sort by a column/value id (or, for row/column fields, the field name). */
export interface SortSpec {
  field: string;
  direction?: Direction; // default 'asc'
}

/** Address a single pivot leaf: the column-key path plus the measure id. */
export interface CellRef {
  colPath: string[];
  value: string;
}

/** A built-in referenced by name, with options. */
export interface NamedSpec {
  name: string;
  options?: Record<string, unknown>;
}

/** Tier 1: text content. */
export type FormatSpec = NamedSpec | { fn: FormatFn } | { expression: string };
/** Tier 2: inline CSS merged onto the default cell. */
export type StyleSpec = NamedSpec | { fn: StyleFn } | { expression: string };
/** Tier 3: a full React cell (supersedes format/style default rendering). */
export type RenderSpec =
  NamedSpec | { fn: CellRender } | { expression: string };

/** Sugar over a Tier-3 `imageText` renderer. */
export interface CompositeSpec {
  fields: string[];
  /** Field (or expression) used to SORT this column. */
  sortKey: string;
}

/** A displayed column shared by flat mode and pivot derived columns. */
export interface ColumnDef {
  id: string;
  label?: string;
  /** flat: a data field; pivot: a measure/value id. Defaults to `id` for a
   * plain projection (i.e. when neither `compute` nor `composite` is set). */
  source?: string;
  /** JS expression over named `inputs` (+ CellCtx) -> value. */
  compute?: string;
  /** alias -> cell ref (pivot) or column/field id (flat, defaults to siblings). */
  inputs?: Record<string, CellRef | string>;
  format?: FormatSpec;
  /** Use the format deduced from this column's metadata (default true). Set
   * false to supply a complete format instead of overriding parts of the
   * deduced one — and to opt out of deduction entirely when no `format` is
   * given. */
  inheritUnitFormat?: boolean;
  style?: StyleSpec;
  render?: RenderSpec;
  composite?: CompositeSpec;
  sort?: SortSpec;
  /** Where a derived column lands in the leaf order. */
  place?: 'append' | { after: string };
  /** Pivot: repeat once per member of these column level(s); `inputs.colPath`s become relative. */
  repeatPer?: string[];
  /** Metadata for this column, overriding the source field's. The only way to
   * give a computed column a unit, since it has no source field to inherit. */
  meta?: ColumnMetaInput;
}

/** A measure: an aggregation applied to a source field. */
export interface ValueSpec {
  id: string;
  field: string;
  agg: string;
  label?: string;
  format?: FormatSpec;
  /** Use the format deduced from this column's metadata (default true). Set
   * false to supply a complete format instead of overriding parts of the
   * deduced one — and to opt out of deduction entirely when no `format` is
   * given. */
  inheritUnitFormat?: boolean;
  style?: StyleSpec;
  /** Custom aggregation: JS expression over the group's `values` array. */
  expression?: string;
  /** Footer override; defaults to `agg`. */
  summaryAgg?: string;
}

/** Where the measures level sits; default innermost column level. */
export interface ValuePlacement {
  axis: 'columns' | 'rows';
  level?: number; // omitted = innermost
}

export interface PivotSpec {
  mode?: 'pivot';
  rows: string[];
  columns: string[];
  values: ValueSpec[];
  valuePlacement?: ValuePlacement;
  /** Derived columns computed after base cells exist. */
  computed?: ColumnDef[];
  rowSort?: SortSpec[];
  columnSort?: SortSpec[];
  showSummary?: boolean;
  /** Placeholder for empty groups (default ''). */
  emptyDisplay?: string;
  /** data field name -> display header label. */
  labels?: Record<string, string>;
  /** data field name -> metadata, layered over whatever the data supplied. */
  meta?: Record<string, ColumnMetaInput>;
}

export interface TableSpec {
  mode: 'flat';
  columns: ColumnDef[];
  sort?: SortSpec[];
  emptyDisplay?: string;
  labels?: Record<string, string>;
  /** data field name -> metadata, layered over whatever the data supplied. */
  meta?: Record<string, ColumnMetaInput>;
}

export type ViewSpec = PivotSpec | TableSpec;

export function isFlat(spec: ViewSpec): spec is TableSpec {
  return spec.mode === 'flat';
}
