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

export function addColumn(
  spec: ViewSpec,
  field: string,
  agg: string,
): ViewSpec {
  const p = pivot(spec);
  if (!p) return spec;
  const id = columnId(p.columns, field, agg);
  return {
    ...p,
    columns: [
      ...p.columns,
      { id, source: field, agg, label: `${agg} ${field}` },
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
