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

/** A registered function referenced by name, with its options. The companion
 * to the inline `{ fn }` form: the name of a function rather than the function
 * itself, which is what keeps a `ViewSpec` serializable. */
export interface NamedSpec {
  fnName: string;
  options?: Record<string, unknown>;
}

/** Options alone, merged into the format deduced from the column's metadata
 * (or into `number` when nothing is deduced). Lets a view override one setting
 * without naming the built-in it is overriding. */
export interface FormatOptionsSpec {
  options: Record<string, unknown>;
}

/** Tier 1: text content. */
export type FormatSpec =
  NamedSpec | FormatOptionsSpec | { fn: FormatFn } | { expression: string };
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
  /** Multiply this column's values by a constant before they are formatted —
   * the conversion from how the data is stored to how it is displayed (a ratio
   * stored as 0.0523 shown as 5.23 percent points). Applied by the engine, so
   * it holds for every format, including inline `fn`/`expression` ones, and for
   * styles, sorting, and footer aggregates alike. The unit *label* is separate:
   * that comes from the column's metadata. */
  factor?: number;
  format?: FormatSpec;
  /** Use the format deduced from this column's metadata (default true). Set
   * false to supply a complete format instead of overriding parts of the
   * deduced one — and to opt out of deduction entirely when no `format` is
   * given. */
  inheritUnitFormat?: boolean;
  style?: StyleSpec;
  render?: RenderSpec;
  composite?: CompositeSpec;
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
  /** Multiply this column's values by a constant before they are formatted —
   * the conversion from how the data is stored to how it is displayed (a ratio
   * stored as 0.0523 shown as 5.23 percent points). Applied by the engine, so
   * it holds for every format, including inline `fn`/`expression` ones, and for
   * styles, sorting, and footer aggregates alike. The unit *label* is separate:
   * that comes from the column's metadata. */
  factor?: number;
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

/** Which axis the measures level sits on; it is always the innermost level. */
export interface ValuePlacement {
  axis: 'columns' | 'rows';
}

/** A virtual column computed from the others, usable as a grouping field. */
export interface DerivedField {
  /** Expression over the source fields, plus the temporal helpers (`weekday`,
   * `month`, `isoWeek`, …). A field whose metadata declares a timestamp arrives
   * already decoded to epoch millis. */
  compute: string;
  /** Metadata for the derived column; its `kind` drives labels and format. */
  meta?: ColumnMetaInput;
}

/** Options that mean the same thing in either mode. */
export interface ViewSpecBase {
  /** Virtual columns added before grouping, so `rows`/`columns` may name them.
   * Evaluated in declaration order, so one may reference an earlier one. */
  derive?: Record<string, DerivedField>;
  /** IANA zone for the temporal helpers, or `'auto'` (the default) for the
   * runtime's. The zone decides which calendar day an instant falls on, so it
   * changes the grouping, not just the display. */
  timeZone?: string;
  /** Placeholder for empty groups (default ''). */
  emptyDisplay?: string;
  /** data field name -> display header label. */
  labels?: Record<string, string>;
  /** data field name -> metadata, layered over whatever the data supplied. */
  meta?: Record<string, ColumnMetaInput>;
  /** BCP-47 locale for number formatting and for currency facts (symbol
   * placement, fraction digits). Defaults to the runtime's locale. */
  locale?: string;
}

export interface PivotSpec extends ViewSpecBase {
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
}

export interface TableSpec extends ViewSpecBase {
  mode: 'flat';
  columns: ColumnDef[];
  sort?: SortSpec[];
}

export type ViewSpec = PivotSpec | TableSpec;

export function isFlat(spec: ViewSpec): spec is TableSpec {
  return spec.mode === 'flat';
}
