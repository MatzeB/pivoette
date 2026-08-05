/**
 * The view engine. `computeView` dispatches on whether the spec groups:
 *  - flat: one output row per source row through the display-column layer.
 *  - pivot: group + aggregate into a multi-level table, then derived columns.
 */
import type { CellValue, ColumnType, DataFrame } from '../data/types';
import type { ColumnMeta, ColumnMetaInput } from '../data/meta';
import {
  mergeMeta,
  normalizeMeta,
  storedMagnitude,
  unitLabels,
} from '../data/meta';
import { requireColumn, withMeta } from '../data/frame';
import { deriveColumns } from '../data/derive';
import type { Align, FormatFn, ResolvedColumn } from '../format/context';
import { columnFormat, scaledColumnFormat } from '../format/deduce';
import {
  defaultLadder,
  getLadder,
  hasLadder,
  metaForStep,
  representative,
  stepAt,
  stepLabels,
} from '../format/ladders';
import type { ScaleStep } from '../format/ladders';
import { Format, Render } from '../format/builtins';
import { resolveFormat } from '../format/format';
import { resolveStyle } from '../format/style';
import { resolveRender } from '../format/render';
import { compileExpression, evalExpression } from '../format/expression';
import { getAggregation } from './aggregations';
import type {
  AxisField,
  CellRef,
  ColumnDef,
  ComputedMember,
  FormatSpec,
  MeasureColumn,
  NormalizedView,
  ViewSpec,
} from './spec';
import { autoScaleOf, axisFields, isFlat, normalizeView } from './spec';
import type {
  Cell,
  MemberFormat,
  ResolvedLeaf,
  ResultRow,
  ViewResult,
} from './result';
import { buildHeader } from './result';
import { asNumber, compareValues, isNumericType } from '../util';

const NUMERIC_FORMATS = new Set<string>(Object.values(Format));

function isNumericFormat(spec?: FormatSpec): boolean {
  return !!spec && 'fnName' in spec && NUMERIC_FORMATS.has(spec.fnName);
}

function alignFor(type: ColumnType | undefined, format?: FormatSpec): Align {
  return isNumericFormat(format) || isNumericType(type) ? 'right' : 'left';
}

/**
 * Header text for an axis level: the entry's own `label` wins, then the field's
 * metadata `displayName`, then the raw field name.
 */
function axisLabel(frame: DataFrame, axis: AxisField): string {
  return (
    axis.label ??
    frame.columnByName.get(axis.field)?.meta.displayName ??
    axis.field
  );
}

/**
 * The data field a column projects. A plain projection defaults to its `id`, so
 * `{ id: 'price' }` needs no `source`; a computed or composite column has no
 * single source unless it says so.
 */
function sourceField(def: ColumnDef): string | undefined {
  if (def.compute || def.composite) return def.source;
  return def.source ?? def.id;
}

/** The field a measure aggregates. It always has one, so `id` is the default
 * even for a measure that also carries a `compute`. */
function measureSource(measure: MeasureColumn): string {
  return measure.source ?? measure.id;
}

/**
 * Metadata for a displayed column: the source field's, with any `def.meta`
 * layered on top (the only way a computed column gets a unit).
 */
function columnMeta(
  frame: DataFrame,
  def: { id: string; meta?: ColumnMetaInput },
  source: string | undefined,
): ColumnMeta | undefined {
  const base = source ? frame.columnByName.get(source)?.meta : undefined;
  if (!def.meta) return base;
  return normalizeMeta(
    base ?? { dataName: def.id, type: 'float', category: 'data' },
    mergeMeta(base, def.meta),
  );
}

/**
 * How an index member (a row or column key value) is rendered. Grouping keeps
 * the raw value — a weekday stays the integer that sorts correctly — while the
 * label comes from the field's own metadata, through the same deduction the
 * leaf columns use.
 */
function memberFormat(
  frame: DataFrame,
  field: string,
  locale: string | undefined,
): MemberFormat {
  const meta = frame.columnByName.get(field)?.meta;
  // Same pipeline the leaf columns use, so a member and a cell of the same
  // field cannot format differently.
  const spec = columnFormat({}, meta, locale);
  if (!spec) return (v: CellValue) => String(v ?? '');
  const fn = resolveFormat(spec);
  const column: ResolvedColumn = {
    id: field,
    label: field,
    align: 'left',
    meta,
  };
  return (v: CellValue) =>
    v === null || v === undefined
      ? ''
      : fn({
          value: v,
          inputs: {},
          rowPath: [],
          colPath: [],
          column,
          frame,
        });
}

function makeLeaf(args: {
  id: string;
  colPath: string[];
  column: ResolvedColumn;
  format?: FormatSpec;
  style?: ColumnDef['style'];
  render?: ColumnDef['render'];
  emptyDisplay: string;
}): ResolvedLeaf {
  return {
    id: args.id,
    colPath: args.colPath,
    column: args.column,
    format: resolveFormat(args.format, args.emptyDisplay),
    style: resolveStyle(args.style),
    render: resolveRender(args.render),
  };
}

// ---------------------------------------------------------------------------
// Flat mode
// ---------------------------------------------------------------------------

function computeFlat(frame: DataFrame, spec: ViewSpec): ViewResult {
  const emptyDisplay = spec.emptyDisplay ?? '';
  const fieldValues = (name: string, row: number): CellValue =>
    frame.columnByName.get(name)?.values[row] ?? null;

  const sourceNames = spec.columns.map(sourceField);

  const leaves: ResolvedLeaf[] = spec.columns.map((def, i) => {
    const sourceName = sourceNames[i];
    const source = sourceName ? frame.columnByName.get(sourceName) : undefined;
    const meta = columnMeta(frame, def, sourceName);
    // An explicit format wins, merging over any the column's kind implies.
    const format = columnFormat(def, meta, spec.locale);
    const column: ResolvedColumn = {
      id: def.id,
      // def.label > metadata displayName > the field name.
      label: def.label ?? meta?.displayName ?? sourceName ?? def.id,
      align: alignFor(source?.type, format),
      def,
      meta,
      sources: def.composite
        ? def.composite.fields
            .map((f) => frame.columnByName.get(f)?.meta)
            .filter((m): m is NonNullable<typeof m> => m !== undefined)
        : undefined,
    };
    return makeLeaf({
      id: def.id,
      colPath: [column.label],
      column,
      format,
      style: def.style,
      render: def.composite ? { fnName: Render.ImageText } : def.render,
      emptyDisplay,
    });
  });

  // Row-level input scope: every source field by name, built once per row and
  // shared by the cells that do not add to it. Rebuilding it per cell cost
  // rows x columns x fields, and each `Cell.inputs` retains its object for the
  // life of the result.
  const allFields = frame.columns.map((c) => c.name);
  const allValues = frame.columns.map((c) => c.values);

  const rows: ResultRow[] = [];
  for (let r = 0; r < frame.length; r++) {
    const rowScope: Record<string, unknown> = {};
    for (let f = 0; f < allFields.length; f++) {
      rowScope[allFields[f]!] = allValues[f]![r] ?? null;
    }

    const cells: Cell[] = spec.columns.map((def, ci) => {
      // Resolve inputs (explicit overrides, else the shared row scope).
      let inputs: Record<string, unknown>;
      if (def.composite) {
        const [imgField, textField] = def.composite.fields;
        inputs = {
          image: imgField ? fieldValues(imgField, r) : null,
          text: textField ? fieldValues(textField, r) : null,
        };
      } else if (def.inputs) {
        inputs = { ...rowScope };
        for (const [alias, ref] of Object.entries(def.inputs)) {
          if (typeof ref === 'string') inputs[alias] = fieldValues(ref, r);
        }
      } else {
        inputs = rowScope;
      }
      let value: unknown;
      const sourceName = sourceNames[ci];
      if (def.compute) {
        value = evalExpression(def.compute, { ...inputs, inputs });
      } else if (sourceName) {
        value = fieldValues(sourceName, r);
      } else if (def.composite) {
        // Composite renders from inputs; its sortable value is the sort key.
        value = fieldValues(def.composite.sortKey, r);
      } else {
        value = null;
      }
      return { value: scaled(value as CellValue, def.factor), inputs };
    });
    rows.push({ path: [], cells });
  }

  sortFlatRows(rows, spec);

  const { forest, depth } = buildHeader(leaves);
  return {
    mode: 'flat',
    rowLevels: [],
    rowMemberFormats: [],
    leaves,
    columnHeader: forest,
    columnHeaderDepth: depth,
    rows,
    frame,
  };
}

function sortFlatRows(rows: ResultRow[], spec: ViewSpec): void {
  if (!spec.sort || spec.sort.length === 0) return;
  const colIndex = new Map(spec.columns.map((c, i) => [c.id, i]));
  const specs = spec.sort
    .map((s) => {
      const idx = colIndex.get(s.field);
      if (idx === undefined) return null;
      const def = spec.columns[idx]!;
      const dir = s.direction === 'desc' ? -1 : 1;
      // Composite columns sort by their sortKey field.
      const sortField = def.composite?.sortKey;
      return { idx, dir, sortField };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  rows.sort((ra, rb) => {
    for (const { idx, dir, sortField } of specs) {
      let a: unknown;
      let b: unknown;
      if (sortField) {
        a = ra.cells[idx]?.inputs?.[sortField] ?? ra.cells[idx]?.inputs?.text;
        b = rb.cells[idx]?.inputs?.[sortField] ?? rb.cells[idx]?.inputs?.text;
      } else {
        a = ra.cells[idx]?.value;
        b = rb.cells[idx]?.value;
      }
      const cmp = compareValues(a, b);
      if (cmp !== 0) return cmp * dir;
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Pivot mode
// ---------------------------------------------------------------------------

function keyOf(tuple: CellValue[]): string {
  return JSON.stringify(tuple);
}

/**
 * Order index keys so the multi-level index actually nests.
 *
 * *Every* level takes part in the comparison, outermost first: a level with a
 * `sort` uses that direction, and any other keeps the order its members were
 * first encountered in. Comparing all levels lexicographically is what
 * guarantees keys sharing a prefix end up adjacent — which the merged index
 * cells assume, and which neither source order nor a partial sort provides.
 * (Before this, grouping by `team > project` only looked right because the
 * source rows happened to arrive grouped that way.)
 */
function sortTuples(keys: CellValue[][], fields: AxisField[]): CellValue[][] {
  if (fields.length === 0) return keys;

  // Sort priority is level order, which is why the direction lives on the
  // level rather than in a list that would have to declare its own.
  const direction = new Map<number, number>();
  fields.forEach((f, level) => {
    if (f.sort) direction.set(level, f.sort === 'desc' ? -1 : 1);
  });

  // Encounter order of each level's members, used where no sort was asked for.
  const firstSeen = fields.map(() => new Map<string, number>());
  for (const key of keys) {
    for (let i = 0; i < fields.length; i++) {
      const seen = firstSeen[i]!;
      const member = String(key[i]);
      if (!seen.has(member)) seen.set(member, seen.size);
    }
  }

  return [...keys].sort((a, b) => {
    for (let i = 0; i < fields.length; i++) {
      const dir = direction.get(i);
      const cmp =
        dir !== undefined
          ? compareValues(a[i], b[i]) * dir
          : firstSeen[i]!.get(String(a[i]))! - firstSeen[i]!.get(String(b[i]))!;
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}

/**
 * Convert a stored value to display units. Applied once, at cell construction,
 * so format/style/render, sorting, and footer aggregates all agree — unlike a
 * format option, which only the formats that implement it would honour.
 */
function scaled(value: CellValue, factor: number | undefined): CellValue {
  if (factor === undefined || value === null) return value;
  const n = asNumber(value);
  return n === null ? value : n * factor;
}

function aggregate(measure: MeasureColumn, values: CellValue[]): CellValue {
  if (measure.expression) {
    return evalExpression(measure.expression, { values }) as CellValue;
  }
  return getAggregation(measure.agg).reduce(values);
}

interface Grouping {
  rowKeys: CellValue[][];
  colKeys: CellValue[][];
  /** rowKeyStr -> colKeyStr -> source row indices. */
  groups: Map<string, Map<string, number[]>>;
  /** colKeyStr -> source row indices (for the summary footer). */
  colGroups: Map<string, number[]>;
}

function group(frame: DataFrame, rows: string[], columns: string[]): Grouping {
  const rowCols = rows.map((f) => requireColumn(frame, f).values);
  const colCols = columns.map((f) => requireColumn(frame, f).values);

  const rowKeys: CellValue[][] = [];
  const colKeys: CellValue[][] = [];
  const rowSeen = new Set<string>();
  const colSeen = new Set<string>();
  const groups = new Map<string, Map<string, number[]>>();
  const colGroups = new Map<string, number[]>();

  for (let r = 0; r < frame.length; r++) {
    const rowKey = rowCols.map((v) => v[r] ?? null);
    const colKey = colCols.map((v) => v[r] ?? null);
    const rk = keyOf(rowKey);
    const ck = keyOf(colKey);
    if (!rowSeen.has(rk)) {
      rowSeen.add(rk);
      rowKeys.push(rowKey);
    }
    if (!colSeen.has(ck)) {
      colSeen.add(ck);
      colKeys.push(colKey);
    }
    let byCol = groups.get(rk);
    if (!byCol) groups.set(rk, (byCol = new Map()));
    let idxs = byCol.get(ck);
    if (!idxs) byCol.set(ck, (idxs = []));
    idxs.push(r);
    let cg = colGroups.get(ck);
    if (!cg) colGroups.set(ck, (cg = []));
    cg.push(r);
  }
  return { rowKeys, colKeys, groups, colGroups };
}

/** Base measure leaf descriptor, before derived columns are woven in. */
interface BaseDesc {
  kind: 'measure';
  colKey: CellValue[];
  /** Serialized colKey (precomputed for group lookups). */
  colKeyStr: string;
  measure: MeasureColumn;
  /** Index of `measure` into the measure list (precomputed for field lookup). */
  measureIndex: number;
  colPath: string[];
  /** lookup key: colKey strings + measure id */
  baseKey: string;
}

interface DerivedDesc {
  kind: 'derived';
  def: ColumnDef | ComputedMember;
  prefix: CellValue[];
  colPath: string[];
  /**
   * Everything about this column that does not vary by row, resolved once:
   * where each alias reads from, and the compiled expression with its fixed
   * argument list. Recomputing these per cell dominated pivot time — the
   * lookup keys are `map(String).join('')` and `evalExpression` rebuilds its
   * cache key from scratch on every call.
   */
  aliases: { name: string; lookupKey: string }[];
  argNames: string[];
  compiled?: (...args: unknown[]) => unknown;
}

type Desc = BaseDesc | DerivedDesc;

function baseLookupKey(colKey: CellValue[], measureId: string): string {
  return colKey.map((v) => String(v)).join('') + '' + measureId;
}

function computePivot(
  frame: DataFrame,
  spec: ViewSpec,
  norm: NormalizedView,
): ViewResult {
  const emptyDisplay = spec.emptyDisplay ?? '';
  const { pivotRows, pivotColumns, measures } = norm;
  const g = group(frame, axisFields(pivotRows), axisFields(pivotColumns));
  // Index members keep their raw value for grouping and sorting; these render
  // them. A weekday column groups on 0..6 and displays Mon..Sun.
  const colMember = pivotColumns.map((a) =>
    memberFormat(frame, a.field, spec.locale),
  );
  const rowMemberFormats = pivotRows.map((a) =>
    memberFormat(frame, a.field, spec.locale),
  );
  const rowKeys = sortTuples(g.rowKeys, pivotRows);
  const colKeys = sortTuples(g.colKeys, pivotColumns);

  if ((spec.columnAxis ?? 'pivotColumns') === 'pivotRows') {
    return pivotMeasuresOnRows(
      frame,
      spec,
      norm,
      rowKeys,
      colKeys,
      g,
      emptyDisplay,
    );
  }

  const fieldValues = measures.map(
    (m) => requireColumn(frame, measureSource(m)).values,
  );
  const includeMeasure = measures.length > 1 || pivotColumns.length === 0;

  // Build base measure descriptors in colKey × measure order.
  const baseDescs: BaseDesc[] = [];
  for (const colKey of colKeys) {
    const colStrs = colKey.map((v, i) => colMember[i]!(v));
    const colKeyStr = keyOf(colKey);
    measures.forEach((measure, measureIndex) => {
      const measLabel = measure.label ?? measure.id;
      baseDescs.push({
        kind: 'measure',
        colKey,
        colKeyStr,
        measure,
        measureIndex,
        colPath: includeMeasure ? [...colStrs, measLabel] : colStrs,
        baseKey: baseLookupKey(colKey, measure.id),
      });
    });
  }

  // Weave derived columns into the descriptor order. Two sources, and the
  // difference is where they sit: a `view.columns` entry is one more innermost
  // column, while an axis level's `computed` member is a peer of that level's
  // real members and so repeats once per distinct outer prefix.
  const descs: Desc[] = [...baseDescs];
  for (const def of norm.derived) {
    const aliases = Object.entries(def.inputs ?? {})
      .filter(([, ref]) => typeof ref !== 'string') // the flat-only form
      .map(([name, ref]) => {
        const cellRef = ref as CellRef;
        return {
          name,
          lookupKey: baseLookupKey(cellRef.colPath, cellRef.column),
        };
      });
    const argNames = [...aliases.map((a) => a.name), 'inputs', 'row'];
    const derived: DerivedDesc = {
      kind: 'derived',
      def,
      prefix: [],
      colPath: [def.label ?? def.id],
      aliases,
      argNames,
      compiled: def.compute
        ? compileExpression(def.compute, argNames)
        : undefined,
    };
    descs.splice(derivedInsertIndex(descs, def.place, []), 0, derived);
  }

  // Computed members of the innermost column level. How often one repeats is
  // read off the axis — once per distinct combination of the levels outside it
  // — rather than declared, which is what keeps it correct when a level is
  // moved to the other axis or dropped.
  const innermost = pivotColumns[pivotColumns.length - 1];
  // A computed member's value comes from cells that a measure produced, so
  // there has to be one. `validateBundle` says so too, but a spec reaching the
  // engine unvalidated should not take the page down.
  const firstMeasure = measures[0];
  for (const member of firstMeasure ? (innermost?.computed ?? []) : []) {
    const fallbackMeasure = firstMeasure!;
    const outerLevels = pivotColumns.length - 1;
    for (const prefix of distinctPrefixes(colKeys, outerLevels)) {
      // One per measure, as a real member of this level would be: the member
      // spans the measures sublevel rather than replacing it.
      const perMeasure = includeMeasure ? measures : [undefined];
      const block: DerivedDesc[] = perMeasure.map((measure) => {
        const aliases = Object.entries(member.inputs ?? {}).map(
          ([name, ref]) => ({
            name,
            // An omitted `column` reads the measure this cell is under, which
            // is what makes one expression yield a Δ for each of them.
            lookupKey: baseLookupKey(
              [...prefix, ref.member],
              ref.column ?? measure?.id ?? fallbackMeasure.id,
            ),
          }),
        );
        const argNames = [...aliases.map((a) => a.name), 'inputs', 'row'];
        const label = member.label ?? member.id;
        return {
          kind: 'derived' as const,
          def: member,
          prefix,
          // Through the level's own member format, exactly as the base leaves
          // above: a raw `String(v)` would put the member under a second,
          // unformatted copy of its group — `0` beside `Sun`.
          colPath: [
            ...prefix.map((v, i) => colMember[i]!(v)),
            label,
            ...(measure ? [measure.label ?? measure.id] : []),
          ],
          aliases,
          argNames,
          compiled: compileExpression(member.compute, argNames),
        };
      });
      const at = derivedInsertIndex(descs, member.place, prefix);
      descs.splice(at, 0, ...block);
    }
  }

  // Resolve leaves + a base lookup for derived input refs.
  const baseIndexByKey = new Map<string, number>();
  const leaves: ResolvedLeaf[] = descs.map((d, i) => {
    if (d.kind === 'measure') {
      baseIndexByKey.set(d.baseKey, i);
      // Same path every other column takes, so a measure can carry its own
      // `meta` rather than being stuck with the source field's.
      const meta = columnMeta(frame, d.measure, measureSource(d.measure));
      const format = columnFormat(d.measure, meta, spec.locale);
      const column: ResolvedColumn = {
        id: d.baseKey,
        label: d.measure.label ?? d.measure.id,
        align: alignFor('float', format),
        def: d.measure,
        meta,
      };
      return makeLeaf({
        id: `${d.colPath.join('')}#${i}`,
        colPath: d.colPath,
        column,
        format,
        style: d.measure.style,
        emptyDisplay,
      });
    }
    // A derived column has no source field; only its own `meta` applies.
    const meta = columnMeta(frame, d.def, undefined);
    const format = columnFormat(d.def, meta, spec.locale);
    const column: ResolvedColumn = {
      id: d.def.id,
      label: d.def.label ?? d.def.id,
      align: alignFor('float', format),
      def: d.def,
      meta,
    };
    return makeLeaf({
      id: `${d.colPath.join('')}#${i}`,
      colPath: d.colPath,
      column,
      format,
      style: d.def.style,
      render: d.def.render,
      emptyDisplay,
    });
  });

  // Rows.
  const rows: ResultRow[] = rowKeys.map((rowKey) => {
    const rk = keyOf(rowKey);
    const byCol = g.groups.get(rk);
    // First pass: base measure values into a per-row lookup.
    const baseValues = new Map<string, CellValue>();
    const cells: Cell[] = new Array(descs.length);
    descs.forEach((d, i) => {
      if (d.kind === 'measure') {
        const idxs = byCol?.get(d.colKeyStr);
        const col = fieldValues[d.measureIndex]!;
        const vals = idxs ? idxs.map((r) => col[r] ?? null) : [];
        const value = idxs
          ? scaled(aggregate(d.measure, vals), d.measure.factor)
          : null;
        baseValues.set(d.baseKey, value);
        cells[i] = { value };
      }
    });
    // Second pass: derived cells from base lookup.
    descs.forEach((d, i) => {
      if (d.kind === 'derived') {
        cells[i] = derivedCell(d, baseValues, rowKey);
      }
    });
    return { path: rowKey, cells };
  });

  // Summary footer (from source, per colKey).
  let summary: Cell[] | undefined;
  if (spec.showSummary) {
    const baseValues = new Map<string, CellValue>();
    summary = new Array(descs.length);
    descs.forEach((d, i) => {
      if (d.kind === 'measure') {
        const idxs = g.colGroups.get(d.colKeyStr);
        const col = fieldValues[d.measureIndex]!;
        const vals = idxs ? idxs.map((r) => col[r] ?? null) : [];
        const aggId = d.measure.summaryAgg ?? d.measure.agg;
        const value = idxs
          ? scaled(
              aggregate(
                { ...d.measure, agg: aggId, expression: undefined },
                vals,
              ),
              d.measure.factor,
            )
          : null;
        baseValues.set(d.baseKey, value);
        summary![i] = { value };
      }
    });
    descs.forEach((d, i) => {
      if (d.kind === 'derived') summary![i] = derivedCell(d, baseValues, []);
    });
  }

  const rowLevels = pivotRows.map((a) => axisLabel(frame, a));
  const { forest, depth } = buildHeader(leaves);
  return {
    mode: 'pivot',
    rowLevels,
    rowMemberFormats,
    leaves,
    columnHeader: forest,
    columnHeaderDepth: depth,
    rows,
    summary,
    frame,
  };
}

function derivedCell(
  d: DerivedDesc,
  baseValues: Map<string, CellValue>,
  rowPath: CellValue[],
): Cell {
  const inputs: Record<string, unknown> = {};
  const argv: unknown[] = new Array(d.argNames.length);
  d.aliases.forEach((alias, i) => {
    const value = baseValues.get(alias.lookupKey) ?? null;
    inputs[alias.name] = value;
    argv[i] = value;
  });
  argv[d.aliases.length] = inputs;
  argv[d.aliases.length + 1] = rowPath;

  let value: unknown = null;
  if (d.compiled) {
    try {
      value = d.compiled(...argv);
    } catch {
      value = null;
    }
  }
  return { value: scaled(value as CellValue, d.def.factor), inputs };
}

function distinctPrefixes(colKeys: CellValue[][], len: number): CellValue[][] {
  const seen = new Set<string>();
  const out: CellValue[][] = [];
  for (const key of colKeys) {
    const prefix = key.slice(0, len);
    const k = keyOf(prefix);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(prefix);
    }
  }
  return out;
}

function derivedInsertIndex(
  descs: Desc[],
  place: ColumnDef['place'],
  prefix: CellValue[],
): number {
  const after = place && place !== 'append' ? place.after : undefined;
  if (after === undefined) {
    // Append after the last base leaf of this prefix (or global end).
    if (prefix.length === 0) return descs.length;
    let last = -1;
    descs.forEach((d, i) => {
      if (d.kind === 'measure' && prefixMatches(d.colKey, prefix)) last = i;
    });
    return last >= 0 ? last + 1 : descs.length;
  }
  const targetColKey = [...prefix.map(String), after];
  let last = -1;
  descs.forEach((d, i) => {
    if (d.kind === 'measure') {
      const strs = d.colKey.map(String);
      if (
        strs.length === targetColKey.length &&
        strs.every((s, j) => s === targetColKey[j])
      ) {
        last = i;
      }
    }
  });
  return last >= 0 ? last + 1 : descs.length;
}

function prefixMatches(colKey: CellValue[], prefix: CellValue[]): boolean {
  return prefix.every((p, i) => String(colKey[i]) === String(p));
}

/** Measures placed as the innermost ROW level (no derived/summary support). */
function pivotMeasuresOnRows(
  frame: DataFrame,
  spec: ViewSpec,
  norm: NormalizedView,
  rowKeys: CellValue[][],
  colKeys: CellValue[][],
  g: Grouping,
  emptyDisplay: string,
): ViewResult {
  const { pivotRows, pivotColumns, measures } = norm;
  const fieldValues = measures.map(
    (m) => requireColumn(frame, measureSource(m)).values,
  );

  const colKeyStrs = colKeys.map(keyOf);
  const colMember = pivotColumns.map((a) =>
    memberFormat(frame, a.field, spec.locale),
  );
  const leaves: ResolvedLeaf[] = colKeys.map((colKey, i) => {
    const colStrs = colKey.map((v, l) => colMember[l]!(v));
    const column: ResolvedColumn = {
      id: colStrs.join('') || 'value',
      label: colStrs[colStrs.length - 1] ?? 'Value',
      align: 'right',
    };
    return makeLeaf({
      id: `col#${i}`,
      colPath: colStrs.length > 0 ? colStrs : ['Value'],
      column,
      emptyDisplay,
    });
  });

  const rows: ResultRow[] = [];
  for (const rowKey of rowKeys) {
    const byCol = g.groups.get(keyOf(rowKey));
    measures.forEach((measure, mi) => {
      const cells: Cell[] = colKeys.map((_colKey, ci) => {
        const idxs = byCol?.get(colKeyStrs[ci]!);
        const vals = idxs ? idxs.map((r) => fieldValues[mi]![r] ?? null) : [];
        return {
          value: idxs ? scaled(aggregate(measure, vals), measure.factor) : null,
        };
      });
      rows.push({ path: [...rowKey, measure.label ?? measure.id], cells });
    });
  }

  const rowLevels = [...pivotRows.map((a) => axisLabel(frame, a)), 'Measure'];
  const rowMemberFormats = [
    ...pivotRows.map((a) => memberFormat(frame, a.field, spec.locale)),
    // the measure level is already a label
    (v: CellValue) => String(v ?? ''),
  ];
  const { forest, depth } = buildHeader(leaves);
  return {
    mode: 'pivot',
    rowLevels,
    rowMemberFormats,
    leaves,
    columnHeader: forest,
    columnHeaderDepth: depth,
    rows,
    frame,
  };
}

// ---------------------------------------------------------------------------

/**
 * The metadata the spec supplies: `spec.meta` with any per-axis-field `meta`
 * layered on top. An axis entry is the closer of the two to the field it
 * describes, so it wins.
 */
function specMeta(
  spec: ViewSpec,
  norm: NormalizedView,
): Record<string, ColumnMetaInput> | undefined {
  const axes = [...norm.pivotRows, ...norm.pivotColumns].filter((a) => a.meta);
  if (axes.length === 0) return spec.meta;
  const out = { ...spec.meta };
  for (const axis of axes) {
    out[axis.field] = { ...out[axis.field], ...axis.meta };
  }
  return out;
}

/**
 * Prepare the frame the spec describes: layer the view's metadata over whatever
 * the data supplied, then add its derived columns so the axes can name them.
 * Done here rather than in the component so `computeView` is usable standalone.
 */
function prepare(
  frame: DataFrame,
  spec: ViewSpec,
  norm: NormalizedView,
): DataFrame {
  return deriveColumns(
    withMeta(frame, specMeta(spec, norm)),
    spec.derive,
    spec.locale,
    spec.timeZone,
  );
}

// ---------------------------------------------------------------------------
// Auto-scaling
// ---------------------------------------------------------------------------

/** Every value a column shows, body and summary alike. */
/**
 * Every pooled leaf's values, converted to the pool's common base unit.
 *
 * Converting here rather than after the fact is what makes a pool of unlike
 * columns comparable: a column of nanoseconds and one of milliseconds hold the
 * same duration as numbers a million apart, and a representative taken over the
 * raw mixture would describe neither.
 */
function leafValues(
  result: ViewResult,
  indices: number[],
  leaves: ResolvedLeaf[],
): CellValue[] {
  const out: CellValue[] = [];
  for (const i of indices) {
    const stored = storedMagnitude(leaves[i]!.column.meta) ?? 1;
    const take = (cell: Cell | undefined) => {
      // Nulls and text carry no magnitude; dropping them here saves the
      // representative pass a second copy of a potentially long column.
      const n = cell?.value == null ? null : asNumber(cell.value as CellValue);
      if (n !== null) out.push(n * stored);
    };
    for (const row of result.rows) take(row.cells[i]);
    take(result.summary?.[i]);
  }
  return out;
}

/** Multiply the value a formatter sees, leaving `Cell.value` alone. */
function scaleFormat(base: FormatFn, factor: number): FormatFn {
  return (ctx) => {
    const n = asNumber(ctx.value as CellValue);
    return n === null ? base(ctx) : base({ ...ctx, value: n * factor });
  };
}

/**
 * A per-cell scale: the step is chosen from the value itself, so the label
 * cannot live on the column and rides the number instead. Still composed
 * through `unitLabels`, so short forms and the tight/prefix rules are the ones
 * every other unit uses.
 */
function perValueFormat(
  leaf: ResolvedLeaf,
  meta: ColumnMeta,
  ladder: string,
  spec: ViewSpec,
  emptyDisplay: string,
): FormatFn {
  // Everything that does not vary by cell, resolved once. This runs per cell
  // *and* 200 times per column while widths are measured, so re-deriving the
  // ladder and the column's magnitude here would be the whole cost.
  const stored = storedMagnitude(meta)!;
  const { steps } = getLadder(ladder);
  const rungs = new Map<
    ScaleStep,
    { fn: FormatFn; attach: (text: string) => string }
  >();

  const rungFor = (step: ScaleStep) => {
    let rung = rungs.get(step);
    if (!rung) {
      const stepMeta = metaForStep(meta, step);
      const labels = unitLabels(stepMeta, spec.locale);
      const fn = resolveFormat(
        scaledColumnFormat(leaf.column.def ?? {}, stepMeta, spec.locale),
        emptyDisplay,
      );
      // Same attachment rules as the per-column path (`wrapFormat`): a leading
      // label sits inside the sign, a tight one hugs the digits.
      rung = {
        fn,
        attach: labels.full
          ? wrapLabel(labels.full, labels.prefix, labels.tight)
          : (text: string) => text,
      };
      rungs.set(step, rung);
    }
    return rung;
  };

  return (ctx) => {
    const n = asNumber(ctx.value as CellValue);
    if (n === null) return leaf.format(ctx);
    const base = Math.abs(n) * stored;
    let step = steps[0]!;
    for (const rung of steps) if (base >= rung.magnitude) step = rung;

    const { fn, attach } = rungFor(step);
    return attach(fn({ ...ctx, value: (n * stored) / step.magnitude }));
  };
}

/**
 * Attach a unit label to already-formatted text. The per-column path does this
 * by wrapping the formatter (`wrapFormat` in `DataTable`); a per-value scale
 * has a different label per cell, so it wraps the text instead.
 */
function wrapLabel(
  label: string,
  prefix: boolean,
  tight: boolean,
): (text: string) => string {
  const gap = tight ? '' : ' ';
  if (!prefix) return (text) => (text ? text + gap + label : text);
  return (text) => {
    if (!text) return text;
    const sign = text[0] === '-' || text[0] === '+' ? text[0] : '';
    return sign + label + gap + text.slice(sign.length);
  };
}

/**
 * Choose a display scale for every column that asked for one.
 *
 * Runs here rather than at leaf construction because a scale is chosen from the
 * data, and leaves are built before a single cell exists. Leaves are grouped by
 * `scalePool ?? id`, so a lone column is simply a pool of one and there is no
 * second code path for the two cases.
 */
function applyAutoScale(result: ViewResult, spec: ViewSpec): ViewResult {
  const emptyDisplay = spec.emptyDisplay ?? '';
  const pools = new Map<string, number[]>();
  result.leaves.forEach((leaf, i) => {
    const def = leaf.column.def;
    if (!def || !autoScaleOf(def)) return;
    const key = ('scalePool' in def ? def.scalePool : undefined) ?? def.id;
    const at = pools.get(key);
    if (at) at.push(i);
    else pools.set(key, [i]);
  });
  if (pools.size === 0) return result;

  const leaves = [...result.leaves];
  for (const indices of pools.values()) {
    const first = leaves[indices[0]!]!;
    const def = first.column.def!;
    const meta = first.column.meta;
    const auto = autoScaleOf(def)!;
    if (!meta) continue;
    const ladder = auto.ladder ?? defaultLadder(meta);
    if (!hasLadder(ladder) || storedMagnitude(meta) === undefined) continue;

    if (auto.per === 'value') {
      // Every rung is reachable here, since the step is chosen per cell — so
      // one that could not label this column honestly disqualifies the lot.
      if (!getLadder(ladder).steps.every((s) => stepLabels(meta, s))) continue;
      for (const i of indices) {
        const leaf = leaves[i]!;
        leaves[i] = {
          ...leaf,
          format: perValueFormat(leaf, meta, ladder, spec, emptyDisplay),
        };
      }
      continue;
    }

    // Values arrive in base units, so the rung is chosen once for the pool and
    // each column converts to it from wherever it happens to be stored.
    const rep = representative(leafValues(result, indices, leaves));
    const step = rep === undefined ? undefined : stepAt(rep, ladder);
    if (!step || !stepLabels(meta, step)) continue;
    const stepMeta = metaForStep(meta, step);
    const format = resolveFormat(
      scaledColumnFormat(def, stepMeta, spec.locale),
      emptyDisplay,
    );
    for (const i of indices) {
      const leaf = leaves[i]!;
      // The pool agrees on the *displayed* scale, not on the stored one: a
      // pool may hold a column of nanoseconds beside one of milliseconds, and
      // each has its own distance to travel to reach the chosen rung. Sharing
      // the first leaf's factor would leave them a million apart under one
      // label.
      const stored = storedMagnitude(leaf.column.meta) ?? 1;
      const factor = stored / step.magnitude;
      leaves[i] = {
        ...leaf,
        column: { ...leaf.column, meta: stepMeta },
        format: scaleFormat(format, factor),
        displayFactor: factor,
      };
    }
  }
  return { ...result, leaves };
}

export function computeView(frame: DataFrame, spec: ViewSpec): ViewResult {
  const norm = normalizeView(spec);
  const prepared = prepare(frame, spec, norm);
  const result = isFlat(spec)
    ? computeFlat(prepared, spec)
    : computePivot(prepared, spec, norm);
  return applyAutoScale(result, spec);
}
