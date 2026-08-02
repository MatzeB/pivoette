/**
 * The view engine. `computeView` dispatches on mode:
 *  - flat: one output row per source row through the display-column layer.
 *  - pivot: group + aggregate into a multi-level table, then derived columns.
 */
import type { CellValue, ColumnType, DataFrame } from '../data/types';
import type { ColumnMeta } from '../data/meta';
import { mergeMeta, normalizeMeta } from '../data/meta';
import { requireColumn, withMeta } from '../data/frame';
import { deriveColumns } from '../data/derive';
import type { Align, ResolvedColumn } from '../format/context';
import { columnFormat, deduceFormat } from '../format/deduce';
import { Format, Render } from '../format/builtins';
import { resolveFormat } from '../format/format';
import { resolveStyle } from '../format/style';
import { resolveRender } from '../format/render';
import { evalExpression } from '../format/expression';
import { getAggregation } from './aggregations';
import type {
  ColumnDef,
  FormatSpec,
  PivotSpec,
  SortSpec,
  TableSpec,
  ValueSpec,
  ViewSpec,
} from './spec';
import { isFlat } from './spec';
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
 * Header text for a data field: an explicit `spec.labels` entry wins, then the
 * column's metadata `displayName`, then the raw field name. Callers pass the
 * metadata that actually applies — for a display column that is the merged one,
 * including any `def.meta`.
 */
function label(
  field: string,
  labels: Record<string, string> | undefined,
  meta: ColumnMeta | undefined,
): string {
  return labels?.[field] ?? meta?.displayName ?? field;
}

/**
 * The data field a column projects. A plain projection defaults to its `id`, so
 * `{ id: 'price' }` needs no `source`; a computed or composite column has no
 * single source unless it says so.
 */
/** `label` for a row/column index field, whose metadata comes from the frame. */
function fieldLabel(
  frame: DataFrame,
  field: string,
  labels?: Record<string, string>,
): string {
  return label(field, labels, frame.columnByName.get(field)?.meta);
}

function sourceField(def: ColumnDef): string | undefined {
  if (def.compute || def.composite) return def.source;
  return def.source ?? def.id;
}

/**
 * Metadata for a displayed column: the source field's, with any `def.meta`
 * layered on top (the only way a computed column gets a unit).
 */
function columnMeta(
  frame: DataFrame,
  def: ColumnDef,
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
  const spec = deduceFormat(meta, locale);
  if (!spec) return (v: CellValue) => String(v ?? '');
  const fn = resolveFormat(withLocaleOption(spec, locale));
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

/** Stamp the view locale onto a named format that did not set one. */
function withLocaleOption(
  format: FormatSpec,
  locale: string | undefined,
): FormatSpec {
  if (
    !locale ||
    !('fnName' in format) ||
    format.options?.locale !== undefined
  ) {
    return format;
  }
  return { ...format, options: { ...format.options, locale } };
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

function computeFlat(frame: DataFrame, spec: TableSpec): ViewResult {
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
      // def.label > spec.labels > metadata displayName > the field name.
      label:
        def.label ??
        spec.labels?.[sourceName ?? def.id] ??
        meta?.displayName ??
        sourceName ??
        def.id,
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

  // Row-level input scope: all source fields by name.
  const allFields = frame.columns.map((c) => c.name);

  const rows: ResultRow[] = [];
  for (let r = 0; r < frame.length; r++) {
    const cells: Cell[] = spec.columns.map((def, ci) => {
      // Resolve inputs (explicit overrides, else sibling fields by name).
      const inputs: Record<string, unknown> = {};
      if (def.composite) {
        const [imgField, textField] = def.composite.fields;
        inputs.image = imgField ? fieldValues(imgField, r) : null;
        inputs.text = textField ? fieldValues(textField, r) : null;
      } else {
        for (const f of allFields) inputs[f] = fieldValues(f, r);
        if (def.inputs) {
          for (const [alias, ref] of Object.entries(def.inputs)) {
            if (typeof ref === 'string') inputs[alias] = fieldValues(ref, r);
          }
        }
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

  sortFlatRows(rows, spec, frame);

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

function sortFlatRows(
  rows: ResultRow[],
  spec: TableSpec,
  frame: DataFrame,
): void {
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
        // find original row via cell inputs is unavailable; recompute is costly.
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
  void frame;
}

// ---------------------------------------------------------------------------
// Pivot mode
// ---------------------------------------------------------------------------

function keyOf(tuple: CellValue[]): string {
  return JSON.stringify(tuple);
}

function sortTuples(
  keys: CellValue[][],
  fields: string[],
  sort?: SortSpec[],
): CellValue[][] {
  if (!sort || sort.length === 0) return keys;
  const specs = sort
    .map((s) => ({
      level: fields.indexOf(s.field),
      dir: s.direction === 'desc' ? -1 : 1,
    }))
    .filter((s) => s.level >= 0);
  if (specs.length === 0) return keys;
  return [...keys].sort((a, b) => {
    for (const { level, dir } of specs) {
      const cmp = compareValues(a[level], b[level]);
      if (cmp !== 0) return cmp * dir;
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

function aggregate(measure: ValueSpec, values: CellValue[]): CellValue {
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
  measure: ValueSpec;
  /** Index of `measure` into `spec.values` (precomputed for field lookup). */
  measureIndex: number;
  colPath: string[];
  /** lookup key: colKey strings + measure id */
  baseKey: string;
}

interface DerivedDesc {
  kind: 'derived';
  def: ColumnDef;
  prefix: CellValue[];
  colPath: string[];
}

type Desc = BaseDesc | DerivedDesc;

function baseLookupKey(colKey: CellValue[], measureId: string): string {
  return colKey.map((v) => String(v)).join('') + '' + measureId;
}

function computePivot(frame: DataFrame, spec: PivotSpec): ViewResult {
  const emptyDisplay = spec.emptyDisplay ?? '';
  const placement = spec.valuePlacement?.axis ?? 'columns';
  const g = group(frame, spec.rows, spec.columns);
  // Index members keep their raw value for grouping and sorting; these render
  // them. A weekday column groups on 0..6 and displays Mon..Sun.
  const colMember = spec.columns.map((f) =>
    memberFormat(frame, f, spec.locale),
  );
  const rowMemberFormats = spec.rows.map((f) =>
    memberFormat(frame, f, spec.locale),
  );
  const rowKeys = sortTuples(g.rowKeys, spec.rows, spec.rowSort);
  const colKeys = sortTuples(g.colKeys, spec.columns, spec.columnSort);

  if (placement === 'rows') {
    return pivotMeasuresOnRows(frame, spec, rowKeys, colKeys, g, emptyDisplay);
  }

  const fieldValues = spec.values.map(
    (m) => requireColumn(frame, m.field).values,
  );
  const includeMeasure = spec.values.length > 1 || spec.columns.length === 0;

  // Build base measure descriptors in colKey × measure order.
  const baseDescs: BaseDesc[] = [];
  for (const colKey of colKeys) {
    const colStrs = colKey.map((v, i) => colMember[i]!(v));
    const colKeyStr = keyOf(colKey);
    spec.values.forEach((measure, measureIndex) => {
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

  // Weave derived columns into the descriptor order.
  const descs: Desc[] = [...baseDescs];
  for (const def of spec.computed ?? []) {
    const prefixes =
      def.repeatPer && def.repeatPer.length > 0
        ? distinctPrefixes(colKeys, def.repeatPer.length)
        : [[]];
    for (const prefix of prefixes) {
      const derived: DerivedDesc = {
        kind: 'derived',
        def,
        prefix,
        colPath: [...prefix.map((v) => String(v)), def.label ?? def.id],
      };
      const at = derivedInsertIndex(descs, def, prefix);
      descs.splice(at, 0, derived);
    }
  }

  // Resolve leaves + a base lookup for derived input refs.
  const baseIndexByKey = new Map<string, number>();
  const leaves: ResolvedLeaf[] = descs.map((d, i) => {
    if (d.kind === 'measure') {
      baseIndexByKey.set(d.baseKey, i);
      const meta = frame.columnByName.get(d.measure.field)?.meta;
      const format = columnFormat(d.measure, meta, spec.locale);
      const column: ResolvedColumn = {
        id: d.baseKey,
        label: d.measure.label ?? d.measure.id,
        align: alignFor('float', format),
        value: d.measure,
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

  const rowLevels = spec.rows.map((f) => fieldLabel(frame, f, spec.labels));
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
  if (d.def.inputs) {
    for (const [alias, ref] of Object.entries(d.def.inputs)) {
      if (typeof ref === 'string') continue; // flat-only form
      const effective =
        d.prefix.length > 0 ? [...d.prefix, ...ref.colPath] : ref.colPath;
      inputs[alias] =
        baseValues.get(baseLookupKey(effective, ref.value)) ?? null;
    }
  }
  const value = d.def.compute
    ? evalExpression(d.def.compute, { ...inputs, inputs, row: rowPath })
    : null;
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
  def: ColumnDef,
  prefix: CellValue[],
): number {
  const after =
    def.place && def.place !== 'append' ? def.place.after : undefined;
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
  spec: PivotSpec,
  rowKeys: CellValue[][],
  colKeys: CellValue[][],
  g: Grouping,
  emptyDisplay: string,
): ViewResult {
  const fieldValues = spec.values.map(
    (m) => requireColumn(frame, m.field).values,
  );

  const colMember = spec.columns.map((f) =>
    memberFormat(frame, f, spec.locale),
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
    spec.values.forEach((measure, mi) => {
      const cells: Cell[] = colKeys.map((colKey) => {
        const idxs = byCol?.get(keyOf(colKey));
        const vals = idxs ? idxs.map((r) => fieldValues[mi]![r] ?? null) : [];
        return {
          value: idxs ? scaled(aggregate(measure, vals), measure.factor) : null,
        };
      });
      rows.push({ path: [...rowKey, measure.label ?? measure.id], cells });
    });
  }

  const rowLevels = [
    ...spec.rows.map((f) => fieldLabel(frame, f, spec.labels)),
    'Measure',
  ];
  const rowMemberFormats = [
    ...spec.rows.map((f) => memberFormat(frame, f, spec.locale)),
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
 * Prepare the frame the spec describes: layer the view's metadata over whatever
 * the data supplied, then add its derived columns so `rows`/`columns` can name
 * them. Done here rather than in the component so `computeView` is usable
 * standalone.
 */
function prepare(frame: DataFrame, spec: ViewSpec): DataFrame {
  return deriveColumns(
    withMeta(frame, spec.meta),
    spec.derive,
    spec.locale,
    spec.timeZone,
  );
}

export function computeView(frame: DataFrame, spec: ViewSpec): ViewResult {
  const prepared = prepare(frame, spec);
  return isFlat(spec)
    ? computeFlat(prepared, spec)
    : computePivot(prepared, spec);
}
