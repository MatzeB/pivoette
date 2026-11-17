/**
 * Editing operations on a `ViewSpec`.
 *
 * Every one is a pure function returning a new spec, which is what makes the
 * editor testable without rendering anything and lets a host undo by keeping
 * the previous object. The spec stays serializable throughout — that is the
 * property the whole editor exists to preserve.
 *
 * Pivot-only operations return the spec untouched for a flat view rather than
 * throwing: the caller is UI, and a no-op is a better failure than a crash.
 */
import type { DataTableDisplay } from '../components/DataTable';
import { isFlat } from '../pivot/spec';
import { clampIndex } from '../util';
import type { AxisField, ColumnDef, ViewSpec } from '../pivot/spec';
import type { CellValue } from '../data/types';
import type { ChartDisplay, ChartMark } from '../graph/pivot-chart';

/** The two axes a grouping field can live on. */
export type FieldZone = 'pivotRows' | 'pivotColumns';

/** A field's position: which axis, and where in that axis's order. */
export interface FieldRef {
  zone: FieldZone;
  index: number;
}

/** Anything draggable: an axis field, a displayed column, or a footer row. */
export type DragRef =
  | FieldRef
  | { zone: 'columns'; index: number }
  | { zone: 'footer'; index: number };

/**
 * What a remove control would take: any list entry, or the grand total, which
 * is a flag on the view rather than an entry in a list. A panel reports the one
 * under the pointer so the table can show it before it goes.
 */
export type RemovalRef = DragRef | { zone: 'summary' };

/** Where a drop can send its changes. */
export interface DropTargets {
  view: ViewSpec;
  display?: DataTableDisplay;
  onViewChange?: (next: ViewSpec) => void;
  onDisplayChange?: (next: DataTableDisplay) => void;
}

/**
 * What a drop means, in one place: axis fields are interchangeable — dropping
 * one on the other axis pivots it — while columns and footer rows only
 * reorder among their own kind, since neither means anything on an axis.
 *
 * The table and the editor panel both route through here so their drag
 * behaviour cannot drift apart.
 */
export function applyDrop(from: DragRef, to: DragRef, at: DropTargets): void {
  if (from.zone === to.zone && from.index === to.index) return;

  if (from.zone === 'columns' || to.zone === 'columns') {
    if (from.zone !== to.zone) return;
    at.onViewChange?.(moveColumn(at.view, from.index, to.index));
    return;
  }
  if (from.zone === 'footer' || to.zone === 'footer') {
    if (from.zone !== to.zone || !at.display) return;
    at.onDisplayChange?.(moveFooterRow(at.display, from.index, to.index));
    return;
  }
  at.onViewChange?.(moveField(at.view, from, to));
}

// Immutable array edits. Written out rather than using `toSpliced`, which is
// ES2023 — the package targets ES2022 and that is not worth widening for three
// call sites.
/** Move an item within an array, clamping the destination. */
function reorder<T>(arr: readonly T[], from: number, to: number): T[] {
  const rest = removeAt(arr, from);
  return insertAt(rest, clampIndex(to, rest.length), arr[from]!);
}

function removeAt<T>(arr: readonly T[], i: number): T[] {
  return [...arr.slice(0, i), ...arr.slice(i + 1)];
}
function insertAt<T>(arr: readonly T[], i: number, value: T): T[] {
  return [...arr.slice(0, i), value, ...arr.slice(i)];
}
function replaceAt<T>(arr: readonly T[], i: number, value: T): T[] {
  const out = [...arr];
  out[i] = value;
  return out;
}

/** The spec, if it is a pivot — the only kind these operations apply to. */
function pivot(spec: ViewSpec): ViewSpec | undefined {
  return isFlat(spec) ? undefined : spec;
}

/** An axis, defaulted. A pivot may legitimately declare only one of the two. */
function axis(spec: ViewSpec, zone: FieldZone): AxisField[] {
  return spec[zone] ?? [];
}

/**
 * Add a grouping field, at `at` or appended. A field already on either axis is
 * ignored — it would mean grouping by the same thing twice.
 */
export function addField(
  spec: ViewSpec,
  zone: FieldZone,
  field: string,
  at?: number,
): ViewSpec {
  const p = pivot(spec);
  if (!p) return spec;
  const onAxis = (z: FieldZone) => axis(p, z).some((a) => a.field === field);
  if (onAxis('pivotRows') || onAxis('pivotColumns')) return spec;
  const fields = axis(p, zone);
  const index = clampIndex(at ?? fields.length, fields.length);
  return { ...p, [zone]: insertAt(fields, index, { field }) };
}

export function removeField(
  spec: ViewSpec,
  zone: FieldZone,
  index: number,
): ViewSpec {
  const p = pivot(spec);
  const fields = p ? axis(p, zone) : [];
  if (!p || index < 0 || index >= fields.length) return spec;
  return { ...p, [zone]: removeAt(fields, index) };
}

/**
 * Move a field within an axis, or between them. The cross-axis case is what
 * makes the table an actual pivot rather than a fixed layout.
 *
 * The whole `AxisField` moves, so the level's label and sort follow the field
 * it describes — which is the point of them living on the entry rather than in
 * a map the move would have to fix up.
 */
export function moveField(
  spec: ViewSpec,
  from: FieldRef,
  to: FieldRef,
): ViewSpec {
  const p = pivot(spec);
  if (!p) return spec;
  const field = axis(p, from.zone)[from.index];
  if (field === undefined) return spec;

  if (from.zone === to.zone) {
    // Clamp: dropping past the end appends.
    return {
      ...p,
      [from.zone]: reorder(axis(p, from.zone), from.index, to.index),
    };
  }

  const target = axis(p, to.zone);
  const at = clampIndex(to.index, target.length);
  return {
    ...p,
    [from.zone]: removeAt(axis(p, from.zone), from.index),
    [to.zone]: insertAt(target, at, field),
  };
}

// --- columns ----------------------------------------------------------------

/** How many of the view's columns aggregate. */
function measureCount(spec: ViewSpec): number {
  return spec.columns.filter((c) => c.agg !== undefined).length;
}

/** A stable, readable id for a new measure, unique within the spec. */
function columnId(columns: ColumnDef[], field: string, agg: string): string {
  const base = `${agg}_${field}`;
  if (!columns.some((c) => c.id === base)) return base;
  let n = 2;
  while (columns.some((c) => c.id === `${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/**
 * Append a measure. Its label defaults to naming both halves, `sum revenue`;
 * a caller that knows better — the field's display name, a format for what
 * the aggregate is — passes `extra`.
 */
export function addColumn(
  spec: ViewSpec,
  field: string,
  agg: string,
  extra: Pick<ColumnDef, 'label' | 'format'> = {},
): ViewSpec {
  const p = pivot(spec);
  if (!p) return spec;
  const id = columnId(p.columns, field, agg);
  return {
    ...p,
    columns: [
      ...p.columns,
      { id, source: field, agg, label: `${agg} ${field}`, ...extra },
    ],
  };
}

/**
 * Remove a column. Removing the last measure would leave a pivot with nothing
 * to aggregate, so that one case is a no-op.
 */
export function removeColumn(spec: ViewSpec, index: number): ViewSpec {
  const p = pivot(spec);
  const column = p?.columns[index];
  if (!p || !column) return spec;
  if (column.agg !== undefined && measureCount(p) <= 1) return spec;
  return { ...p, columns: removeAt(p.columns, index) };
}

export function setColumnAgg(
  spec: ViewSpec,
  index: number,
  agg: string,
): ViewSpec {
  const p = pivot(spec);
  const column = p?.columns[index];
  if (!p || !column) return spec;
  return { ...p, columns: replaceAt(p.columns, index, { ...column, agg }) };
}

export function moveColumn(spec: ViewSpec, from: number, to: number): ViewSpec {
  const p = pivot(spec);
  if (!p || !p.columns[from]) return spec;
  return { ...p, columns: reorder(p.columns, from, to) };
}

/** The grand-total row is part of the view, not of `display.footer`. */
export function setShowSummary(spec: ViewSpec, on: boolean): ViewSpec {
  const p = pivot(spec);
  if (!p) return spec;
  return { ...p, showSummary: on };
}

// --- filters ----------------------------------------------------------------

/**
 * Leave out the rows where `field` takes one of `exclude`. Not pivot-only: a
 * flat table can be filtered as well as a pivot can. An empty list keeps the
 * filter, so a field filtered on from the panel stays listed there.
 */
export function setExcluded(
  spec: ViewSpec,
  field: string,
  exclude: CellValue[],
): ViewSpec {
  return { ...spec, filter: { ...spec.filter, [field]: { exclude } } };
}

/** Drop the filter on `field`, letting every row back in. */
export function removeFilter(spec: ViewSpec, field: string): ViewSpec {
  if (!spec.filter || !(field in spec.filter)) return spec;
  const filter = { ...spec.filter };
  delete filter[field];
  const next: ViewSpec = { ...spec, filter };
  if (Object.keys(filter).length === 0) delete next.filter;
  return next;
}

// --- footer rows ------------------------------------------------------------

export function addFooterRow(
  display: DataTableDisplay,
  agg: string,
): DataTableDisplay {
  return {
    ...display,
    footer: [...(display.footer ?? []), { label: agg, agg }],
  };
}

export function moveFooterRow(
  display: DataTableDisplay,
  from: number,
  to: number,
): DataTableDisplay {
  const footer = display.footer ?? [];
  const row = footer[from];
  if (!row) return display;
  return { ...display, footer: reorder(footer, from, to) };
}

export function removeFooterRow(
  display: DataTableDisplay,
  index: number,
): DataTableDisplay {
  const footer = display.footer ?? [];
  if (index < 0 || index >= footer.length) return display;
  return { ...display, footer: removeAt(footer, index) };
}

// --- chart ------------------------------------------------------------------

/** Draw the view as a table or a chart. The view itself is untouched. */
export function setShowAs(
  display: DataTableDisplay,
  as: 'table' | 'chart',
): DataTableDisplay {
  // `table` is the default; leaving it out keeps a saved bundle as it was.
  const { as: _previous, ...rest } = display;
  return as === 'table' ? rest : { ...rest, as };
}

/**
 * Change some of the chart settings. A key set to `undefined` is removed, so
 * clearing a field returns it to its default rather than storing the clear.
 */
export function setChart(
  display: DataTableDisplay,
  patch: Partial<ChartDisplay>,
): DataTableDisplay {
  const chart: Record<string, unknown> = { ...display.chart, ...patch };
  for (const key of Object.keys(chart)) {
    if (chart[key] === undefined) delete chart[key];
  }
  return { ...display, chart: chart as ChartDisplay };
}

/** How the measure with this column id is drawn. */
export function setMark(
  display: DataTableDisplay,
  columnId: string,
  mark: ChartMark,
): DataTableDisplay {
  return setChart(display, {
    marks: { ...display.chart?.marks, [columnId]: mark },
  });
}

/**
 * Move one bar within each category. `members` is the order they are drawn in
 * now — the display's `barOrder` only lists what was ever moved, so the
 * caller, which can see the bars, supplies the rest.
 */
export function moveBar(
  display: DataTableDisplay,
  members: readonly string[],
  from: number,
  to: number,
): DataTableDisplay {
  if (from < 0 || from >= members.length) return display;
  return setChart(display, { barOrder: reorder([...members], from, to) });
}

// --- between flat and pivot ------------------------------------------------

/**
 * A flat column that only shows a field: no expression, no composite. These
 * are the ones that can become an axis level, since a level is a field.
 */
function isProjection(def: ColumnDef): boolean {
  return !def.compute && !def.composite && def.agg === undefined;
}

/**
 * Turn a flat view into the pivot that shows the same thing, with `field`
 * added to `zone`: what dropping a field on an axis of a flat table means.
 *
 * A flat table is a pivot whose groups are each one source row. So:
 *
 * - The first `keys` columns — the table's index columns, as many of them as
 *   are plain projections — become the row levels, in order.
 * - Every other column becomes a measure with `agg: 'only'`, which shows the
 *   group's value as it is while each group is one row, and says so in the
 *   cell when it is not. Format, style and render carry over unchanged.
 * - A computed column computes per source row, before anything is grouped,
 *   which is what `derive` does: it becomes a derived field of the same name,
 *   shown through `only` like the rest.
 * - A sort on a column that became a level becomes that level's sort; any
 *   other sort is dropped — a pivot sorts per level, and its headers still
 *   sort by any column with a click.
 *
 * A pivot with only axes has nothing to show, so if no column is left to be
 * a measure, a count of the group's rows is added.
 */
export function toPivot(
  spec: ViewSpec,
  keys: number,
  zone: FieldZone,
  field: string,
  at?: number,
): ViewSpec {
  if (!isFlat(spec)) return addField(spec, zone, field, at);

  const leading: ColumnDef[] = [];
  for (const def of spec.columns.slice(0, Math.max(0, keys))) {
    if (!isProjection(def)) break;
    leading.push(def);
  }
  const sourceOf = (def: ColumnDef) => def.source ?? def.id;
  const rows: AxisField[] = leading.map((def) => ({
    field: sourceOf(def),
    ...(def.label !== undefined ? { label: def.label } : {}),
  }));

  // The new field leaves the rows if it was there, and joins its axis.
  const rowsLeft = rows.filter((a) => a.field !== field);
  const moved = rows.find((a) => a.field === field) ?? { field };
  const pivotRows =
    zone === 'pivotRows'
      ? insertAt(
          rowsLeft,
          clampIndex(at ?? rowsLeft.length, rowsLeft.length),
          moved,
        )
      : rowsLeft;
  const pivotColumns = zone === 'pivotColumns' ? [moved] : [];
  const onAxis = new Set([...pivotRows, ...pivotColumns].map((a) => a.field));

  const derive = { ...spec.derive };
  const columns: ColumnDef[] = [];
  for (const def of spec.columns.slice(leading.length)) {
    // A plain column of a field that is now a level would repeat the level.
    if (isProjection(def) && onAxis.has(sourceOf(def))) continue;
    if (def.compute) {
      derive[def.id] = { compute: perRow(def) };
      const { compute: _c, inputs: _i, ...rest } = def;
      columns.push({ ...rest, source: def.id, agg: 'only' });
    } else if (def.composite) {
      // Grouped by what it sorts by; drawn from the group's own fields.
      columns.push({ ...def, source: def.composite.sortKey, agg: 'only' });
    } else {
      columns.push({ ...def, agg: 'only' });
    }
  }
  if (columns.length === 0) {
    columns.push({
      id: 'count',
      source: [...onAxis][0],
      agg: 'count',
      label: 'Rows',
    });
  }

  const sortOf = new Map(
    (spec.sort ?? []).map((s) => [s.field, s.direction ?? 'asc'] as const),
  );
  const withSort = (a: AxisField): AxisField => {
    const def = leading.find((d) => sourceOf(d) === a.field);
    const direction = def && sortOf.get(def.id);
    return direction ? { ...a, sort: direction } : a;
  };

  const { sort: _sort, ...rest } = spec;
  return {
    ...rest,
    ...(Object.keys(derive).length > 0 ? { derive } : {}),
    pivotRows: pivotRows.map(withSort),
    ...(pivotColumns.length > 0 ? { pivotColumns } : {}),
    columns,
  };
}

/**
 * A flat column's expression as a `derive` expression. A flat `compute` may
 * rename fields through string `inputs`; a derived field sees the fields
 * under their own names, so the renaming is wrapped around it.
 */
function perRow(def: ColumnDef): string {
  const aliases = Object.entries(def.inputs ?? {}).filter(
    (e): e is [string, string] => typeof e[1] === 'string',
  );
  if (aliases.length === 0) return def.compute!;
  const names = aliases.map(([alias]) => alias).join(', ');
  const fields = aliases.map(([, f]) => f).join(', ');
  return `((${names}) => (${def.compute}))(${fields})`;
}

/**
 * The flat table of the rows behind a pivot: "list the source rows". Not the
 * inverse of `toPivot` in general, and it cannot be — a mean has no one
 * source row to show — so it is a separate, explicit action.
 *
 * - Every axis field, rows then columns, becomes a leading column; the
 *   returned `indexColumns` is how many, for the display.
 * - Each measure becomes a plain column of its source field, keeping its
 *   label, format, style and render. Several measures of one field (a min,
 *   a mean, a max) would be three copies of the same value: the first stays.
 * - What only means something over groups goes: computed columns that read
 *   other cells, an axis level's computed members, the grand total, and the
 *   measures-on-rows layout. Level sorts become the flat sort.
 */
export function toFlat(spec: ViewSpec): {
  view: ViewSpec;
  indexColumns: number;
} {
  if (isFlat(spec)) return { view: spec, indexColumns: 0 };
  const axes = [...(spec.pivotRows ?? []), ...(spec.pivotColumns ?? [])];
  const leading: ColumnDef[] = axes.map((a) => ({
    id: a.field,
    ...(a.label !== undefined ? { label: a.label } : {}),
  }));
  const seen = new Set(axes.map((a) => a.field));
  const columns: ColumnDef[] = [];
  for (const def of spec.columns) {
    if (def.agg === undefined) continue;
    const source = def.source ?? def.id;
    if (seen.has(source)) continue;
    seen.add(source);
    const {
      agg: _agg,
      expression: _e,
      summaryAgg: _s,
      place: _p,
      compute: _c,
      inputs: _i,
      ...rest
    } = def;
    // `id` names the column, and in a flat view also the field it shows
    // unless `source` says otherwise.
    columns.push(rest.id === source ? rest : { ...rest, source });
  }
  const sort = axes
    .filter((a) => a.sort)
    .map((a) => ({ field: a.field, direction: a.sort! }));
  const {
    pivotRows: _r,
    pivotColumns: _c,
    columnAxis: _a,
    showSummary: _s,
    ...rest
  } = spec;
  return {
    view: {
      ...rest,
      columns: [...leading, ...columns],
      ...(sort.length > 0 ? { sort } : {}),
    },
    indexColumns: leading.length,
  };
}
