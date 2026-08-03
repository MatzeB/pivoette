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
import type { PivotSpec, SortSpec, ValueSpec, ViewSpec } from '../pivot/spec';

/** The two axes a grouping field can live on. */
export type FieldZone = 'rows' | 'columns';

/** A field's position: which axis, and where in that axis's order. */
export interface FieldRef {
  zone: FieldZone;
  index: number;
}

/** Anything draggable: an axis field, a measure, or a footer row. */
export type DragRef =
  | FieldRef
  | { zone: 'values'; index: number }
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
 * one on the other axis pivots it — while measures and footer rows only
 * reorder among their own kind, since neither means anything on an axis.
 *
 * The table and the side panel both route through here so their drag
 * behaviour cannot drift apart.
 */
export function applyDrop(from: DragRef, to: DragRef, at: DropTargets): void {
  if (from.zone === to.zone && from.index === to.index) return;

  if (from.zone === 'values' || to.zone === 'values') {
    if (from.zone !== to.zone) return;
    at.onViewChange?.(moveValue(at.view, from.index, to.index));
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

function pivot(spec: ViewSpec): PivotSpec | undefined {
  return isFlat(spec) ? undefined : spec;
}

/** Drop sort entries naming a field that is no longer on that axis. */
function pruneSort(
  sort: SortSpec[] | undefined,
  fields: string[],
): SortSpec[] | undefined {
  if (!sort) return undefined;
  const kept = sort.filter((s) => fields.includes(s.field));
  return kept.length === sort.length ? sort : kept;
}

function withZone(
  spec: PivotSpec,
  zone: FieldZone,
  fields: string[],
): ViewSpec {
  const next: PivotSpec = { ...spec, [zone]: fields };
  next.rowSort = pruneSort(spec.rowSort, next.rows);
  next.columnSort = pruneSort(spec.columnSort, next.columns);
  return next;
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
  if (!p || p.rows.includes(field) || p.columns.includes(field)) return spec;
  const fields = p[zone];
  const index = clampIndex(at ?? fields.length, fields.length);
  return withZone(p, zone, insertAt(fields, index, field));
}

export function removeField(
  spec: ViewSpec,
  zone: FieldZone,
  index: number,
): ViewSpec {
  const p = pivot(spec);
  if (!p || index < 0 || index >= p[zone].length) return spec;
  return withZone(p, zone, removeAt(p[zone], index));
}

/**
 * Move a field within an axis, or between them. The cross-axis case is what
 * makes the table an actual pivot rather than a fixed layout.
 */
export function moveField(
  spec: ViewSpec,
  from: FieldRef,
  to: FieldRef,
): ViewSpec {
  const p = pivot(spec);
  if (!p) return spec;
  const field = p[from.zone][from.index];
  if (field === undefined) return spec;

  if (from.zone === to.zone) {
    // Clamp: dropping past the end appends.
    return withZone(p, from.zone, reorder(p[from.zone], from.index, to.index));
  }

  const source = removeAt(p[from.zone], from.index);
  const target = p[to.zone];
  const at = clampIndex(to.index, target.length);
  const moved: PivotSpec = {
    ...p,
    [from.zone]: source,
    [to.zone]: insertAt(target, at, field),
  };
  return withZone(moved, from.zone, moved[from.zone]);
}

// --- measures ---------------------------------------------------------------

/** A stable, readable id for a new measure, unique within the spec. */
function valueId(values: ValueSpec[], field: string, agg: string): string {
  const base = `${agg}_${field}`;
  if (!values.some((v) => v.id === base)) return base;
  let n = 2;
  while (values.some((v) => v.id === `${base}_${n}`)) n++;
  return `${base}_${n}`;
}

export function addValue(spec: ViewSpec, field: string, agg: string): ViewSpec {
  const p = pivot(spec);
  if (!p) return spec;
  const id = valueId(p.values, field, agg);
  return {
    ...p,
    values: [...p.values, { id, field, agg, label: `${agg} ${field}` }],
  };
}

/** Removing the last measure would leave nothing to aggregate, so it is a no-op. */
export function removeValue(spec: ViewSpec, index: number): ViewSpec {
  const p = pivot(spec);
  if (!p || p.values.length <= 1 || index < 0 || index >= p.values.length) {
    return spec;
  }
  return { ...p, values: removeAt(p.values, index) };
}

export function setValueAgg(
  spec: ViewSpec,
  index: number,
  agg: string,
): ViewSpec {
  const p = pivot(spec);
  const value = p?.values[index];
  if (!p || !value) return spec;
  return { ...p, values: replaceAt(p.values, index, { ...value, agg }) };
}

export function moveValue(spec: ViewSpec, from: number, to: number): ViewSpec {
  const p = pivot(spec);
  const value = p?.values[from];
  if (!p || !value) return spec;
  return { ...p, values: reorder(p.values, from, to) };
}

/** Derived columns are a separate list from the measures. */
export function removeComputed(spec: ViewSpec, index: number): ViewSpec {
  const p = pivot(spec);
  const computed = p?.computed;
  if (!p || !computed || index < 0 || index >= computed.length) return spec;
  return { ...p, computed: removeAt(computed, index) };
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
