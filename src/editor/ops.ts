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
import type { PivotSpec, SortSpec, ValueSpec, ViewSpec } from '../pivot/spec';

/** The two axes a grouping field can live on. */
export type FieldZone = 'rows' | 'columns';

/** A field's position: which axis, and where in that axis's order. */
export interface FieldRef {
  zone: FieldZone;
  index: number;
}

// Immutable array edits. Written out rather than using `toSpliced`, which is
// ES2023 — the package targets ES2022 and that is not worth widening for three
// call sites.
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

/** Append a grouping field. A field already on either axis is ignored. */
export function addField(
  spec: ViewSpec,
  zone: FieldZone,
  field: string,
): ViewSpec {
  const p = pivot(spec);
  if (!p || p.rows.includes(field) || p.columns.includes(field)) return spec;
  return withZone(p, zone, [...p[zone], field]);
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
    const rest = removeAt(p[from.zone], from.index);
    // Clamp: dropping past the end appends.
    const at = Math.min(Math.max(to.index, 0), rest.length);
    return withZone(p, from.zone, insertAt(rest, at, field));
  }

  const source = removeAt(p[from.zone], from.index);
  const target = p[to.zone];
  const at = Math.min(Math.max(to.index, 0), target.length);
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
  const rest = removeAt(p.values, from);
  const at = Math.min(Math.max(to, 0), rest.length);
  return { ...p, values: insertAt(rest, at, value) };
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

export function removeFooterRow(
  display: DataTableDisplay,
  index: number,
): DataTableDisplay {
  const footer = display.footer ?? [];
  if (index < 0 || index >= footer.length) return display;
  return { ...display, footer: removeAt(footer, index) };
}
