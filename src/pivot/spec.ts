/**
 * The declarative configuration language. `ViewSpec` is the top-level contract
 * a future interactive editor will manipulate; it is fully serializable except
 * for the optional inline `fn` escape hatches on format/style/render specs.
 *
 * One vocabulary covers both kinds of table. `columns` is always the displayed
 * columns; `pivotRows`/`pivotColumns` are the axes to group them over, and a
 * view that declares neither and aggregates nothing is a flat table. A pivot
 * is not a different shape of spec, only a spec that groups.
 */
import type { CellRender, FormatFn, StyleFn } from '../format/context';
import type { ColumnMetaInput } from '../data/meta';

export type Direction = 'asc' | 'desc';

/** Sort flat rows by a column id. */
export interface SortSpec {
  field: string;
  direction?: Direction; // default 'asc'
}

/** Address a single pivot leaf: the column-key path plus the column id. */
export interface CellRef {
  colPath: string[];
  column: string;
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

/**
 * How a column picks the scale it displays in, when it doesn't want the one its
 * metadata declares. The chosen scale is rendered through the ordinary unit
 * path, so it moves with `unitPlacement` like any other label.
 */
export interface AutoScaleSpec {
  /** Named ladder (see `format/ladders.ts`). Deduced from `kind` when absent. */
  ladder?: string;
  /**
   * One scale for the whole column (the default), so cells are comparable and
   * the label can sit in the header — or one per cell, which reads better for
   * values spanning many orders of magnitude but pins the label to the value.
   */
  per?: 'column' | 'value';
}

/**
 * A displayed column, in either kind of view.
 *
 * What a column *is* follows from which of three keys it sets, so there is one
 * type rather than one per mode:
 *  - `agg`     — a measure: the source field aggregated over each group.
 *  - `compute` — derived: an expression over other cells, evaluated after the
 *                base cells exist.
 *  - neither   — a plain projection of `source`.
 */
export interface ColumnDef {
  id: string;
  label?: string;
  /** The data field this column reads. Defaults to `id` for a plain projection
   * or a measure; a computed or composite column has no single source unless
   * it says so. */
  source?: string;

  /** Aggregation applied to `source` over each group. Its presence is what
   * makes a column a measure — and what makes a view a pivot. */
  agg?: string;
  /** Custom aggregation: JS expression over the group's `values` array,
   * in place of the named `agg`. */
  expression?: string;
  /** Summary-footer aggregation; defaults to `agg`. */
  summaryAgg?: string;

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
  /**
   * Choose the displayed scale from the data rather than showing it in the one
   * the metadata declares — nanoseconds read as `4.34 µs`. `true` deduces the
   * ladder, a string names it, the object form also says how it applies.
   *
   * Only the *display* changes: `Cell.value` stays in stored units, so sorting,
   * styles, and any expression over the value keep meaning what they did.
   */
  autoScale?: boolean | string | AutoScaleSpec;
  /**
   * Columns naming the same pool choose one scale together, so a row of related
   * measures cannot end up half in `ns` and half in `µs`. Defaults to the
   * column's own `id` — a pool of one, which is why there is no separate
   * "per column" mode.
   */
  scalePool?: string;
  style?: StyleSpec;
  render?: RenderSpec;
  composite?: CompositeSpec;
  /** Where a derived column lands in the leaf order. */
  place?: 'append' | { after: string };
  /** Metadata for this column, overriding the source field's. The only way to
   * give a computed column a unit, since it has no source field to inherit. */
  meta?: ColumnMetaInput;
}

/**
 * One of a level's own members — `'before'` of a `revision` level. No path: a
 * `ComputedMember` already knows which level it is on, which is the whole
 * reason it lives on the axis.
 *
 * The member is named by its value *in the data*, not by the text the header
 * shows. The two differ wherever a level formats its members — a weekday level
 * groups on `0` and displays `Mon` — and only the stored value is stable:
 * display text moves with the locale, which a spec should survive.
 */
export interface MemberRef {
  member: string;
  /**
   * Which measure to read under that member. Omitted means "the same measure
   * as the cell being computed", so one expression yields a Δ per measure.
   */
  column?: string;
}

/**
 * A synthetic member of an axis level: the Δ sitting beside `before` and
 * `after`, computed from its siblings at that same level.
 *
 * This is a `ColumnDef` in everything but where it comes from — it has no
 * source field and no aggregation, because its inputs are cells that already
 * exist. What it is *not* is a member of `view.columns`: those are the
 * innermost level, and a Δ over revisions belongs to the revision level.
 * Saying so here is what lets the engine derive how often it repeats, instead
 * of being told a count that goes stale the moment the axes change.
 */
export interface ComputedMember {
  id: string;
  label?: string;
  /** JS expression over the named `inputs` (+ CellCtx) -> value. */
  compute: string;
  /** alias -> a sibling member of this level. */
  inputs?: Record<string, MemberRef>;
  /** Where among this level's members it lands; defaults to last. Names the
   * member by its stored value, as `MemberRef.member` does. */
  place?: 'append' | { after: string };
  /** Multiply before formatting — see `ColumnDef.factor`. */
  factor?: number;
  format?: FormatSpec;
  inheritUnitFormat?: boolean;
  style?: StyleSpec;
  render?: RenderSpec;
  /** The only way to give this column a unit; it has no source field. */
  meta?: ColumnMetaInput;
}

/**
 * A field on a pivot axis: what to group by, plus everything said *about* that
 * level. Keeping the label and sort here rather than in maps keyed by field
 * name is what stops them referring to a field that is not on the axis — and
 * lets them travel with the field when it is pivoted to the other axis.
 */
export interface AxisField {
  field: string;
  /** Header text for this level; overrides the field's metadata displayName. */
  label?: string;
  /** Sort this level's members. Priority follows level order, outermost first. */
  sort?: Direction;
  /** Metadata for this field, layered over whatever the data supplied. */
  meta?: ColumnMetaInput;
  /**
   * Extra members computed from this level's real ones. Supported on the
   * innermost `pivotColumns` level: an outer level's synthetic member would
   * have to produce a whole subtree rather than a cell, and a row axis would
   * have to synthesize rows — neither is what this expresses.
   */
  computed?: ComputedMember[];
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

/**
 * A view: the columns to display, and optionally the axes to pivot them over.
 *
 * There is no mode flag. A flat table is the case where nothing is grouped and
 * nothing is aggregated, which the spec already says in the only way that
 * matters — it declares no axes and no `agg`. See `isFlat`.
 */
export interface ViewSpec {
  /** Fields to group down the page. Each becomes an index level. */
  pivotRows?: AxisField[];
  /** Fields to group across the page. Each becomes a column header level. */
  pivotColumns?: AxisField[];
  /** Every displayed column, in order. */
  columns: ColumnDef[];
  /** Which axis the columns level sits on; it is always the innermost level.
   * Default `'pivotColumns'`. */
  columnAxis?: 'pivotRows' | 'pivotColumns';
  /** Flat only: sort rows by column id. Pivot sorts per axis level, via
   * `AxisField.sort`. */
  sort?: SortSpec[];
  /** Pivot only: a grand-total footer row. */
  showSummary?: boolean;
  /** Virtual columns added before grouping, so the axes may name them.
   * Evaluated in declaration order, so one may reference an earlier one. */
  derive?: Record<string, DerivedField>;
  /** IANA zone for the temporal helpers, or `'auto'` (the default) for the
   * runtime's. The zone decides which calendar day an instant falls on, so it
   * changes the grouping, not just the display. */
  timeZone?: string;
  /** Placeholder for empty groups (default ''). */
  emptyDisplay?: string;
  /** data field name -> metadata, layered over whatever the data supplied. */
  meta?: Record<string, ColumnMetaInput>;
  /** BCP-47 locale for number formatting and for currency facts (symbol
   * placement, fraction digits). Defaults to the runtime's locale. */
  locale?: string;
}

/** A column that aggregates: the narrowing the pivot path works in terms of. */
export type MeasureColumn = ColumnDef & { agg: string };

/**
 * A view is a pivot if it groups or aggregates; otherwise it is flat, meaning
 * one output row per source row.
 *
 * The `agg` clause is what keeps a view with no axes but aggregated columns a
 * pivot — that is a legitimate spec, a single grand-total row.
 */
export function isFlat(spec: ViewSpec): boolean {
  return (
    spec.pivotRows === undefined &&
    spec.pivotColumns === undefined &&
    !spec.columns.some((c) => c.agg !== undefined)
  );
}

/**
 * The spec with its optional parts filled in and its columns split by kind.
 *
 * `ViewSpec` is deliberately not a union, so TypeScript cannot narrow the axes
 * or tell a measure from a derived column. This does that once, for the engine
 * and the editor both, rather than each of them re-deriving it inline.
 */
export interface NormalizedView {
  pivotRows: AxisField[];
  pivotColumns: AxisField[];
  /** Columns with an `agg`, in spec order. */
  measures: MeasureColumn[];
  /** Computed columns, in spec order. A measure that also computes is a
   * measure: its aggregation is what produces the value. */
  derived: ColumnDef[];
}

/**
 * A column's `autoScale`, with its shorthands expanded — `undefined` when the
 * column did not ask to be scaled.
 *
 * Here rather than in the engine because four places need to read the same
 * three spellings: the engine, the validator (twice, once per pool member),
 * and the table deciding whether a label can be hoisted into the header.
 */
export function autoScaleOf(
  def: ColumnDef | ComputedMember | undefined,
): AutoScaleSpec | undefined {
  // Only a `view.columns` entry can ask; a computed member has no source field
  // to read a magnitude from, so it never carries the key.
  const raw = def && 'autoScale' in def ? def.autoScale : undefined;
  if (raw === undefined || raw === false) return undefined;
  if (raw === true) return {};
  return typeof raw === 'string' ? { ladder: raw } : raw;
}

export function normalizeView(spec: ViewSpec): NormalizedView {
  const measures: MeasureColumn[] = [];
  const derived: ColumnDef[] = [];
  for (const column of spec.columns) {
    if (column.agg !== undefined) measures.push(column as MeasureColumn);
    else if (column.compute) derived.push(column);
  }
  return {
    pivotRows: spec.pivotRows ?? [],
    pivotColumns: spec.pivotColumns ?? [],
    measures,
    derived,
  };
}

/** Field names of an axis, for the places that only group. */
export function axisFields(axis: AxisField[]): string[] {
  return axis.map((a) => a.field);
}
