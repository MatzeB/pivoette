import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CellCtx, FormatFn } from '../format/context';
import type { CellValue, DataFrame, DatasetJson } from '../data/types';
import type { ColumnMeta } from '../data/meta';
import { unitLabels } from '../data/meta';
import { fromDataset } from '../data/import';
import { computeView } from '../pivot/engine';
import { getAggregation } from '../pivot/aggregations';
import type {
  Cell,
  MemberFormat,
  ResolvedLeaf,
  ResultRow,
} from '../pivot/result';
import type { ViewSpec } from '../pivot/spec';
import { compareValues } from '../util';
import { isFlat } from '../pivot/spec';
import {
  addField,
  moveField,
  moveValue,
  removeField,
  removeFooterRow,
  removeValue,
  setShowSummary,
} from '../editor/ops';
import type { FieldRef } from '../editor/ops';
import styles from './DataTable.module.css';

export interface DataTableDisplay {
  /** Enable click-to-sort on column headers (default true). */
  sortable?: boolean;
  /** Line-free look: spacing instead of inner borders, only a header rule. */
  frameless?: boolean;
  /** Px gap inserted at column-group boundaries (0 = off). Shallower group
   * levels get a proportionally larger gap; the innermost level gets none. */
  groupSpacing?: number;
  /** Px gap between the index columns and the data area (0 = off). */
  indexGap?: number;
  /** Px vertical gap between higher-level row-index blocks (0 = off).
   * Shallower (outer) levels get a proportionally larger gap. */
  rowGroupSpacing?: number;
  /** Flat mode: number of leading columns to tint as an index (default 0). */
  indexColumns?: number;
  /** Alternate (even/odd) row background shading. */
  zebra?: boolean;
  /** Remove the header rule and footer double line (rely on spacing/shading). */
  hideRules?: boolean;
  /** Highlight the hovered cell's column header + ancestors (default true). */
  highlightHeaders?: boolean;
  /** Extra footer rows summarizing each column's displayed values. */
  footer?: { label: string; agg: string }[];
  /** Where a column's unit label appears (default 'off'). */
  unitPlacement?: UnitPlacement;
  /** Where a column's scale label appears (default 'off'). Honored only for
   * simple single-factor units; a compound unit moves as one atomic label. */
  scalePlacement?: UnitPlacement;
}

export type UnitPlacement = 'value' | 'header' | 'off';

export interface DataTableProps {
  data: Record<string, unknown>[] | DatasetJson | DataFrame;
  view: ViewSpec;
  /** Show the editing affordances. Needs `onViewChange` to do anything. */
  editing?: boolean;
  /** Emitted when an edit changes the spec; the host owns the state. */
  onViewChange?: (next: ViewSpec) => void;
  /** Emitted when an edit changes presentation (the footer rows). */
  onDisplayChange?: (next: DataTableDisplay) => void;
  height?: number | string;
  theme?: 'auto' | 'light' | 'dark';
  display?: DataTableDisplay;
  className?: string;
}

/** Stable identity: a fresh `[]` default would invalidate the width memo (and
 * so re-measure every column) on every render, including each hover. */
const NO_FOOTER: { label: string; agg: string }[] = [];

/**
 * The remove control on an editable field header.
 *
 * `linked` lights it up without the pointer being on it, so hovering the
 * control for a measure lights every copy of it: the measure header repeats
 * once per column group, and they all remove the same thing.
 */
function RemoveField({
  title,
  onRemove,
  linked = false,
  onLink,
  style,
}: {
  title: string;
  onRemove: () => void;
  linked?: boolean;
  onLink?: (on: boolean) => void;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-linked={linked || undefined}
      style={style}
      onMouseEnter={() => onLink?.(true)}
      onMouseLeave={() => onLink?.(false)}
      className={cls(styles.removeField, linked && styles.removeFieldLinked)}
      onClick={(e) => {
        // The header itself cycles the sort; removing must not also sort.
        e.stopPropagation();
        onRemove();
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      ×
    </button>
  );
}

/**
 * Render the index group with the pending column spliced in at `at`.
 * Header, body, and colgroup all go through this so they cannot disagree
 * about where the extra column sits.
 */
function indexCols(
  levels: number,
  at: number | null,
  cell: (level: number) => ReactNode,
  pending?: () => ReactNode,
): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i <= levels; i++) {
    if (i === at) out.push(pending ? pending() : <col key="pending" />);
    if (i < levels) out.push(cell(i));
  }
  return out;
}

/** A draggable handle's identity: an axis field, or a measure. */
type DragRef = FieldRef | { zone: 'values'; index: number };

/** A line in the opened pending column: a field, the Custom placeholder, or a note. */
type AddEntry =
  | { kind: 'option'; id: string; label: string }
  | { kind: 'custom' }
  | { kind: 'note'; text: string };

/** The pending row-field column: narrow until it is offering its choices. */
const EDIT_COL_W = 26;
const ADD_COL_W = 150;
/** How close to a header's edge the pointer must be to reveal the column. */
const EDGE_ZONE = 18;

const ROW_HEIGHT = 30;
const HEADER_H = 28;

type SortKey =
  { kind: 'leaf'; index: number } | { kind: 'index'; level: number };
interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

function alignClass(align: 'left' | 'right' | 'center'): string {
  if (align === 'right') return styles.numeric!;
  if (align === 'center') return styles.center!;
  return styles.left!;
}

/** Join truthy class names into a className string. */
function cls(...items: (string | false | null | undefined)[]): string {
  return items.filter(Boolean).join(' ');
}

function makeCtx(
  leaf: ResolvedLeaf,
  cell: Cell,
  rowPath: unknown[],
  frame: DataFrame,
): CellCtx {
  return {
    value: cell.value,
    inputs: cell.inputs ?? {},
    rowPath,
    colPath: leaf.colPath,
    column: leaf.column,
    frame,
  };
}

// --- header rows with leaf ranges ------------------------------------------

interface HCell {
  label: string;
  colSpan: number;
  rowSpan: number;
  leafStart: number;
  leafEnd: number;
}

function headerRowsRanged(
  forest: import('../pivot/result').HeaderNode[],
  depth: number,
): HCell[][] {
  const rows: HCell[][] = Array.from({ length: depth }, () => []);
  let cursor = 0;
  function walk(nodes: import('../pivot/result').HeaderNode[], level: number) {
    for (const n of nodes) {
      const start = cursor;
      if (n.leaf) {
        rows[level]!.push({
          label: n.label,
          colSpan: n.span,
          rowSpan: depth - level,
          leafStart: start,
          leafEnd: start + n.span - 1,
        });
        cursor += n.span;
      } else {
        rows[level]!.push({
          label: n.label,
          colSpan: n.span,
          rowSpan: 1,
          leafStart: start,
          leafEnd: start + n.span - 1,
        });
        walk(n.children, level + 1);
      }
    }
  }
  walk(forest, 0);
  return rows;
}

// --- column width measurement ----------------------------------------------

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const ctxCache = new Map<string, CanvasRenderingContext2D | null>();
function measureCtx(bold: boolean): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  const key = bold ? 'b' : 'n';
  if (!ctxCache.has(key)) {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) ctx.font = `${bold ? '600 ' : ''}13px ${FONT_STACK}`;
    ctxCache.set(key, ctx);
  }
  return ctxCache.get(key) ?? null;
}

const CELL_PAD = 28;

function widthOf(text: string, bold = false): number {
  const ctx = measureCtx(bold);
  return ctx ? ctx.measureText(text).width : text.length * (bold ? 8 : 7.5);
}

// --- unit decoration --------------------------------------------------------

/**
 * Split a column's unit label across the value and header slots. A *simple*
 * unit (one un-inverted factor) places its scale and unit halves independently,
 * so `{scale:'value', unit:'header'}` gives `1.20 m` under `Latency (s)`. A
 * compound unit (`ktok/s`, `m²`) is atomic: it follows `unitPlacement` whole and
 * ignores `scalePlacement`, since the halves no longer decompose.
 */
function unitAffixes(
  meta: ColumnMeta | undefined,
  unitPlacement: UnitPlacement,
  scalePlacement: UnitPlacement,
  locale?: string,
): { value: string; header: string; prefix: boolean; tight: boolean } {
  const labels = unitLabels(meta, locale);
  const out = {
    value: '',
    header: '',
    prefix: labels.prefix,
    tight: labels.tight,
  };
  if (!labels.full) return out;
  if (!labels.simple) {
    if (unitPlacement !== 'off') out[unitPlacement] += labels.full;
    return out;
  }
  if (scalePlacement !== 'off') out[scalePlacement] += labels.scalePart;
  if (unitPlacement !== 'off') out[unitPlacement] += labels.unitPart;
  return out;
}

/**
 * Build a column's formatter, specialized once for its unit label rather than
 * re-deciding per cell. A leading label sits inside any sign (`-$12.50`); a
 * `tight` one hugs the digits (`$12.50`, `45.6%`) and the rest stand off with a
 * space (`15467 MB`). Both facts come from the metadata — see `unitLabels`.
 */
function wrapFormat(
  base: FormatFn,
  label: string,
  prefix: boolean,
  tight: boolean,
): FormatFn {
  const gap = tight ? '' : ' ';
  if (!prefix) {
    return (ctx) => {
      const text = base(ctx);
      return text ? text + gap + label : text;
    };
  }
  return (ctx) => {
    const text = base(ctx);
    if (!text) return text;
    const sign = text[0] === '-' || text[0] === '+' ? text[0] : '';
    return sign + label + gap + text.slice(sign.length);
  };
}

function isFrame(
  data: Record<string, unknown>[] | DatasetJson | DataFrame,
): data is DataFrame {
  return !Array.isArray(data) && 'columnByName' in data;
}

// ---------------------------------------------------------------------------

export function DataTable({
  data,
  view,
  editing = false,
  onViewChange,
  onDisplayChange,
  height = 480,
  theme = 'auto',
  display = {},
  className,
}: DataTableProps) {
  const {
    sortable = true,
    frameless = false,
    groupSpacing = 0,
    indexGap = 0,
    rowGroupSpacing = 0,
    indexColumns = 0,
    zebra = false,
    hideRules = false,
    highlightHeaders = true,
    footer = NO_FOOTER,
    unitPlacement = 'off',
    scalePlacement = 'off',
  } = display;

  // `computeView` prepares its own frame from the spec (metadata, derived
  // columns), so the component only has to turn `data` into one.
  const result = useMemo(
    () => computeView(isFrame(data) ? data : fromDataset(data), view),
    [data, view],
  );

  const { rowLevels, rowMemberFormats, summary, frame } = result;
  const depth = result.columnHeaderDepth;

  // Unit decoration: wrap each leaf's formatter with its value suffix, and keep
  // the header suffixes to append to the innermost header cells.
  const { leaves, headerSuffix } = useMemo(() => {
    const headerSuffix = result.leaves.map(() => '');
    if (unitPlacement === 'off' && scalePlacement === 'off') {
      return { leaves: result.leaves, headerSuffix };
    }
    const leaves = result.leaves.map((leaf, i) => {
      const affix = unitAffixes(
        leaf.column.meta,
        unitPlacement,
        scalePlacement,
        view.locale,
      );
      headerSuffix[i] = affix.header ? ` (${affix.header})` : '';
      // Tier-3 cells own their whole rendering; metadata is on `CellCtx` if
      // they want it.
      if (!affix.value || leaf.render) return leaf;
      return {
        ...leaf,
        format: wrapFormat(leaf.format, affix.value, affix.prefix, affix.tight),
      };
    });
    return { leaves, headerSuffix };
  }, [result.leaves, unitPlacement, scalePlacement, view.locale]);

  const [sort, setSort] = useState<SortState | null>(null);
  // Hovered cell: row index + leaf index (leaf = -1 when hovering an index cell).
  const [hover, setHover] = useState<{ row: number; leaf: number } | null>(
    null,
  );

  const headerRows = useMemo(() => {
    const rows = headerRowsRanged(result.columnHeader, depth);
    for (const hrow of rows) {
      for (const hc of hrow) {
        // Innermost (single-leaf) header cells carry the unit label.
        if (hc.leafStart === hc.leafEnd)
          hc.label += headerSuffix[hc.leafStart] ?? '';
      }
    }
    return rows;
  }, [result, depth, headerSuffix]);

  // Column footers (over the displayed cell values); reused for width sizing.
  const footerRows = useMemo(
    () =>
      footer.map(({ label, agg }) => {
        const reduce = getAggregation(agg).reduce;
        const cells: Cell[] = leaves.map((_, li) => ({
          value: reduce(
            result.rows.map((r) => (r.cells[li]!.value ?? null) as CellValue),
          ),
        }));
        return { label, cells };
      }),
    [footer, leaves, result.rows],
  );

  // Measured widths (index columns + leaves) and group-boundary gaps.
  const { indexW, leafW, gapAfter, leftOffset } = useMemo(() => {
    const sample = result.rows.slice(0, 200);
    const leafW = leaves.map((leaf, li) => {
      if (leaf.render) return 200;
      let w = widthOf(leaf.column.label + (headerSuffix[li] ?? ''));
      for (const r of sample) {
        const text = leaf.format(makeCtx(leaf, r.cells[li]!, r.path, frame));
        w = Math.max(w, widthOf(text));
      }
      // Footer/summary render bold — measure with the bold face.
      if (summary) {
        const t = leaf.format(makeCtx(leaf, summary[li]!, [], frame));
        w = Math.max(w, widthOf(t, true));
      }
      for (const fr of footerRows) {
        const t = leaf.format(makeCtx(leaf, fr.cells[li]!, [], frame));
        w = Math.max(w, widthOf(t, true));
      }
      return Math.min(360, Math.max(60, Math.ceil(w) + CELL_PAD));
    });
    const indexW = rowLevels.map((lvl, i) => {
      let w = widthOf(lvl);
      for (const r of sample) w = Math.max(w, widthOf(String(r.path[i] ?? '')));
      return Math.min(320, Math.max(80, Math.ceil(w) + CELL_PAD));
    });
    // Group gaps: each shallower boundary level is 1.3x the next; the innermost
    // (measure) level gets no gap.
    const gapAfter = leaves.map(() => 0);
    if (groupSpacing > 0) {
      for (let i = 0; i < leaves.length - 1; i++) {
        const a = leaves[i]!.colPath;
        const b = leaves[i + 1]!.colPath;
        let L = 0;
        while (L < depth && a[L] === b[L]) L++;
        if (L <= depth - 2)
          gapAfter[i] = Math.round(groupSpacing * Math.pow(1.3, depth - 2 - L));
      }
    }
    // Sticky-left offsets for index columns.
    const leftOffset: number[] = [];
    let acc = 0;
    for (const w of indexW) {
      leftOffset.push(acc);
      acc += w;
    }
    return { indexW, leafW, gapAfter, leftOffset };
  }, [
    result,
    leaves,
    headerSuffix,
    rowLevels,
    frame,
    groupSpacing,
    depth,
    footerRows,
    summary,
  ]);

  // Index/body separation gap (independent of group spacing).
  const bodyLeadGap = rowLevels.length > 0 ? indexGap : 0;

  const totalWidth =
    indexW.reduce((a, b) => a + b, 0) +
    leafW.reduce((a, b, i) => a + b + gapAfter[i]!, 0) +
    bodyLeadGap;

  // Sorting. A leaf (value) sort flattens the rows; an index-level sort keeps
  // the hierarchy — it only reorders that level within each parent group.
  const rows = useMemo(() => {
    if (!sort) return result.rows;
    const dir = sort.dir === 'desc' ? -1 : 1;
    if (sort.key.kind === 'leaf') {
      const idx = sort.key.index;
      return [...result.rows].sort(
        (a, b) => compareValues(a.cells[idx]?.value, b.cells[idx]?.value) * dir,
      );
    }
    const L = sort.key.level;
    const indexed = result.rows.map((r, i) => ({ r, i }));
    indexed.sort((A, B) => {
      // Keep parent groups (levels < L) in their original order.
      for (let l = 0; l < L; l++)
        if (A.r.path[l] !== B.r.path[l]) return A.i - B.i;
      if (A.r.path[L] !== B.r.path[L])
        return compareValues(A.r.path[L], B.r.path[L]) * dir;
      return A.i - B.i; // stable within the sorted level
    });
    return indexed.map((x) => x.r);
  }, [result.rows, sort]);

  // Index-level sorts preserve the grouped (blanked/merged) display.
  const grouped = sort === null || sort.key.kind === 'index';
  const nLevels = rowLevels.length;

  // Extra top space for the first row of a higher-level row-index block.
  const extraTop = useMemo(() => {
    const arr = new Array<number>(rows.length).fill(0);
    if (rowGroupSpacing > 0 && grouped && nLevels > 1) {
      for (let i = 1; i < rows.length; i++) {
        let lc = 0;
        while (lc < nLevels && rows[i]!.path[lc] === rows[i - 1]!.path[lc])
          lc++;
        if (lc < nLevels - 1)
          arr[i] = Math.round(
            rowGroupSpacing * Math.pow(1.3, nLevels - 2 - lc),
          );
      }
    }
    return arr;
  }, [rows, rowGroupSpacing, grouped, nLevels]);

  function cycleSort(key: SortKey) {
    if (!sortable) return;
    setSort((prev) => {
      const same =
        prev &&
        prev.key.kind === key.kind &&
        (key.kind === 'leaf'
          ? prev.key.kind === 'leaf' && prev.key.index === key.index
          : prev.key.kind === 'index' && prev.key.level === key.level);
      if (!same) return { key, dir: 'desc' };
      return { key, dir: prev!.dir === 'desc' ? 'asc' : 'desc' };
    });
  }

  function sortArrow(active: boolean): ReactNode {
    if (!active) return null;
    return (
      <span className={styles.sortArrow}>
        {sort!.dir === 'asc' ? '▲' : '▼'}
      </span>
    );
  }

  // Virtualization.
  const scrollRef = useRef<HTMLDivElement>(null);

  /**
   * The scroller's vertical scrollbar width, so frame-pinned overlays can sit
   * clear of it. Measured rather than assumed: it is 0 with overlay scrollbars
   * and ~15px with classic ones.
   */
  const [scrollbarW, setScrollbarW] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setScrollbarW(el.offsetWidth - el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => ROW_HEIGHT + (extraTop[i] ?? 0),
    overscan: 12,
  });
  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = items.length > 0 ? items[0]!.start : 0;
  const paddingBottom =
    items.length > 0 ? totalSize - items[items.length - 1]!.end : 0;
  // --- editing -------------------------------------------------------------
  // Chrome appears only when the host can actually receive the change.
  const editable = editing && !!onViewChange && !isFlat(view);
  const spec = isFlat(view) ? undefined : view;
  /**
   * Where a row field would be inserted. `hoverInsert` follows the pointer near
   * a header's left or right edge; `addingAt` pins it once the column is
   * opened. Nothing is shown otherwise — the affordance appears where it would
   * act, so a field can go anywhere in the order rather than only at the end.
   */
  const [hoverInsert, setHoverInsert] = useState<number | null>(null);
  const [addingAt, setAddingAt] = useState<number | null>(null);
  const adding = addingAt !== null;
  const pendingAt = editable ? (addingAt ?? hoverInsert) : null;
  const editCols = pendingAt !== null ? 1 : 0;

  const pendingW = adding ? ADD_COL_W : EDIT_COL_W;
  /** Sticky offsets with the pending column spliced into the index group. */
  const editLeftOffset = useMemo(
    () =>
      pendingAt === null
        ? leftOffset
        : leftOffset.map((v, i) => v + (i >= pendingAt ? pendingW : 0)),
    [leftOffset, pendingAt, pendingW],
  );
  const pendingLeft =
    pendingAt === null
      ? 0
      : (leftOffset[pendingAt] ?? indexW.reduce((a, b) => a + b, 0));

  /** Which insertion point the pointer is nearest, if any. */
  function edgeInsert(e: React.MouseEvent<HTMLElement>, level: number) {
    if (!editable || adding) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left;
    const edge = Math.min(EDGE_ZONE, box.width / 3);
    if (x <= edge) setHoverInsert(level);
    else if (x >= box.width - edge) setHoverInsert(level + 1);
    else setHoverInsert(null);
  }
  /** Which field a remove control is pointing at, so the column it would drop
   * can be tinted — and so a measure's controls, which repeat per column
   * group, all light together. */
  const [removeHover, setRemoveHover] = useState<
    | { kind: 'row'; level: number }
    | { kind: 'column'; level: number }
    | { kind: 'measure'; index: number }
    | null
  >(null);
  const linkedMeasure =
    removeHover?.kind === 'measure' ? removeHover.index : null;

  /**
   * What the opened column offers, one entry per body row: the groupable
   * columns not already on an axis (`category` is exactly that split, deduced
   * at import), a note when there are none, and the not-yet-built Custom entry.
   */
  const addEntries = useMemo<AddEntry[]>(() => {
    const placed = new Set([...(spec?.rows ?? []), ...(spec?.columns ?? [])]);
    const options: AddEntry[] = frame.columns
      .filter((c) => c.meta.category === 'index' && !placed.has(c.name))
      .map((c) => ({ kind: 'option', id: c.name, label: c.meta.displayName }));
    if (options.length === 0) {
      options.push({ kind: 'note', text: 'every field is already placed' });
    }
    options.push({ kind: 'custom' });
    return options;
  }, [frame, spec?.rows, spec?.columns]);

  function commitAdd(field: string) {
    const at = addingAt;
    setAddingAt(null);
    setHoverInsert(null);
    if (spec && at !== null) onViewChange?.(addField(spec, 'rows', field, at));
  }

  /** What is in flight: an axis field, or a measure. */
  const dragged = useRef<DragRef | null>(null);

  /**
   * Axis fields are interchangeable — dragging one onto the other axis pivots
   * it — but a measure only reorders among measures, and does so globally: its
   * header repeats per column group, so where it was grabbed does not matter,
   * only which measure it was dropped on.
   */
  function onFieldDrop(to: DragRef) {
    const from = dragged.current;
    dragged.current = null;
    if (!spec || !from) return;
    if (from.zone === to.zone && from.index === to.index) return;
    if (from.zone === 'values' || to.zone === 'values') {
      if (from.zone !== to.zone) return;
      onViewChange?.(moveValue(view, from.index, to.index));
      return;
    }
    onViewChange?.(moveField(spec, from as FieldRef, to as FieldRef));
  }

  /**
   * The grabbable part of a handle — just the label, so text stays selectable
   * around it and the drag image is the name itself.
   */
  function dragSource(ref: DragRef) {
    if (!editable) return {};
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        dragged.current = ref;
        e.dataTransfer.effectAllowed = 'move';
        // Firefox needs data set for a drag to start at all.
        e.dataTransfer.setData('text/plain', ref.zone + ':' + ref.index);
      },
      onDragEnd: () => {
        dragged.current = null;
      },
    };
  }

  /**
   * The droppable part — the whole cell, not the label. A header's text is a
   * fraction of its box, so accepting a drop only on the label would mean most
   * of the cell silently refuses one.
   */
  function dropTarget(ref: DragRef) {
    if (!editable) return {};
    return {
      onDragOver: (e: React.DragEvent) => {
        if (dragged.current) e.preventDefault();
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onFieldDrop(ref);
      },
    };
  }

  /** The cells a pending removal would take with it. */
  const tintLevel = removeHover?.kind === 'row' ? removeHover.level : undefined;
  /** A whole column-header row, when a column field's control is hovered. */
  const tintHeaderRow =
    removeHover?.kind === 'column' ? removeHover.level : undefined;
  const tintLeaves = useMemo(() => {
    if (removeHover?.kind !== 'measure') return undefined;
    const id = spec?.values[removeHover.index]?.id;
    if (id === undefined) return undefined;
    const set = new Set<number>();
    leaves.forEach((leaf, i) => {
      if (leaf.column.value?.id === id) set.add(i);
    });
    return set;
  }, [removeHover, leaves, spec]);

  const totalCols = rowLevels.length + leaves.length + editCols;
  const frameCls = cls(styles.frame, frameless && styles.frameless, className);

  // Footer content lines (column footers first, then the source summary).
  const footerLines = summary
    ? [...footerRows, { label: 'Total', cells: summary }]
    : footerRows;
  const footerBottom = footerLines.length * ROW_HEIGHT;

  /**
   * The measure a header cell removes, if any. Only the cell that *is* the
   * measure level qualifies — its text is the measure's own label, which a
   * column-member header never is. Absent while one measure remains, since
   * removing it is a no-op and a dead control is worse than none.
   */
  function measureAt(hc: HCell): number | undefined {
    if (!editable || !spec || spec.values.length <= 1) return undefined;
    if (hc.leafStart !== hc.leafEnd) return undefined;
    const value = leaves[hc.leafStart]?.column.value;
    if (!value || hc.label !== (value.label ?? value.id)) return undefined;
    const at = spec.values.findIndex((v) => v.id === value.id);
    return at >= 0 ? at : undefined;
  }

  function leafHeaderCls(hc: HCell, isLeafCol: boolean): string {
    const hovered =
      highlightHeaders &&
      hover != null &&
      hover.leaf >= hc.leafStart &&
      hover.leaf <= hc.leafEnd;
    return cls(
      isLeafCol && sortable && styles.sortable,
      hovered && styles.headerHi,
    );
  }

  return (
    <div className={frameCls} data-theme={theme === 'auto' ? undefined : theme}>
      {/* Pinned to the frame, so a wide table can scroll under them. Each sits
          in the band of the header row it would remove. */}
      {editable && spec && spec.columns.length > 0 && (
        <div className={styles.columnControls} style={{ right: scrollbarW }}>
          {spec.columns.map((field, level) => (
            <RemoveField
              key={field}
              title={`Remove the ${field} column field`}
              style={{ top: level * HEADER_H + 5 }}
              linked={tintHeaderRow === level}
              onLink={(on) =>
                setRemoveHover(on ? { kind: 'column', level } : null)
              }
              onRemove={() =>
                onViewChange?.(removeField(spec, 'columns', level))
              }
            />
          ))}
        </div>
      )}
      <div
        ref={scrollRef}
        className={styles.wrapper}
        style={{ maxHeight: height }}
        onMouseLeave={() => setHover(null)}
      >
        <table
          className={styles.table}
          style={{ width: totalWidth + (pendingAt !== null ? pendingW : 0) }}
        >
          <colgroup>
            {indexCols(
              rowLevels.length,
              pendingAt,
              (i) => (
                <col key={`i${i}`} style={{ width: indexW[i] }} />
              ),
              () => (
                <col key="pending" style={{ width: pendingW }} />
              ),
            )}
            {leafW.map((w, i) => (
              <col
                key={`l${i}`}
                style={{
                  width: w + gapAfter[i]! + (i === 0 ? bodyLeadGap : 0),
                }}
              />
            ))}
          </colgroup>

          <thead
            onMouseOver={() => setHover(null)}
            onMouseLeave={() => !adding && setHoverInsert(null)}
          >
            {headerRows.map((hrow, level) => (
              <tr key={level} style={{ height: HEADER_H }}>
                {level === 0 &&
                  indexCols(
                    rowLevels.length,
                    pendingAt,
                    (i) => {
                      const lvl = rowLevels[i]!;
                      const active =
                        sort?.key.kind === 'index' && sort.key.level === i;
                      return (
                        <th
                          key={`ih${i}`}
                          rowSpan={depth}
                          className={cls(
                            styles.corner,
                            styles.rowHeaderCell,
                            styles.indexTint,
                            sortable && styles.sortable,
                            tintLevel === i && styles.removeTint,
                          )}
                          style={{
                            top: 0,
                            left: editLeftOffset[i],
                            ...(i === 0
                              ? {}
                              : { borderLeft: '1px solid var(--pv-border)' }),
                          }}
                          {...dropTarget({ zone: 'rows', index: i })}
                          onMouseMove={(e) => edgeInsert(e, i)}
                          onClick={() => cycleSort({ kind: 'index', level: i })}
                        >
                          <span
                            className={styles.dragHandle}
                            {...dragSource({ zone: 'rows', index: i })}
                          >
                            {lvl}
                          </span>
                          {sortArrow(active)}
                          {editable && spec && (
                            <RemoveField
                              title={`Remove the ${lvl} row field`}
                              onLink={(on) =>
                                setRemoveHover(
                                  on ? { kind: 'row', level: i } : null,
                                )
                              }
                              onRemove={() =>
                                onViewChange?.(removeField(spec, 'rows', i))
                              }
                            />
                          )}
                        </th>
                      );
                    },
                    () => (
                      <th
                        key="pending"
                        rowSpan={depth}
                        className={`${styles.corner} ${styles.rowHeaderCell} ${styles.indexTint} ${styles.editCell}`}
                        style={{ top: 0, left: pendingLeft }}
                      >
                        <button
                          type="button"
                          title="Add a row field here"
                          aria-label="Add a row field here"
                          aria-expanded={adding}
                          className={cls(
                            styles.addField,
                            adding && styles.addFieldOpen,
                          )}
                          onClick={() => setAddingAt(pendingAt)}
                        >
                          +
                        </button>
                        {adding && (
                          <RemoveField
                            title="Stop adding a row field"
                            onRemove={() => {
                              setAddingAt(null);
                              setHoverInsert(null);
                            }}
                          />
                        )}
                      </th>
                    ),
                  )}
                {hrow.map((hc, ci) => {
                  const isLeafCol = hc.leafStart === hc.leafEnd;
                  const measure = measureAt(hc);
                  /** Column levels come first in the header; the rest is measures. */
                  const columnLevel =
                    editable && spec && level < spec.columns.length
                      ? level
                      : undefined;
                  const active =
                    isLeafCol &&
                    sort?.key.kind === 'leaf' &&
                    sort.key.index === hc.leafStart;
                  return (
                    <th
                      key={ci}
                      colSpan={hc.colSpan}
                      rowSpan={hc.rowSpan}
                      className={cls(
                        leafHeaderCls(hc, isLeafCol),
                        ((isLeafCol && tintLeaves?.has(hc.leafStart)) ||
                          tintHeaderRow === level) &&
                          styles.removeTint,
                      )}
                      style={{
                        top: level * HEADER_H,
                        ...edgeGapStyle(
                          hc.leafStart,
                          hc.leafEnd,
                          gapAfter,
                          bodyLeadGap,
                        ),
                      }}
                      {...(measure !== undefined
                        ? dropTarget({ zone: 'values', index: measure })
                        : columnLevel !== undefined
                          ? dropTarget({ zone: 'columns', index: columnLevel })
                          : {})}
                      onClick={
                        isLeafCol
                          ? () =>
                              cycleSort({ kind: 'leaf', index: hc.leafStart })
                          : undefined
                      }
                    >
                      {measure !== undefined ? (
                        <span
                          className={styles.dragHandle}
                          {...dragSource({ zone: 'values', index: measure })}
                        >
                          {hc.label}
                        </span>
                      ) : columnLevel !== undefined ? (
                        // Any member header of a level reorders that level, the
                        // way any repeated measure header reorders its measure.
                        <span
                          className={styles.dragHandle}
                          {...dragSource({
                            zone: 'columns',
                            index: columnLevel,
                          })}
                        >
                          {hc.label}
                        </span>
                      ) : (
                        hc.label
                      )}
                      {sortArrow(active)}
                      {measure !== undefined && (
                        <RemoveField
                          title={`Remove the ${hc.label} measure`}
                          linked={linkedMeasure === measure}
                          onLink={(on) =>
                            setRemoveHover(
                              on ? { kind: 'measure', index: measure } : null,
                            )
                          }
                          onRemove={() =>
                            onViewChange?.(removeValue(view, measure))
                          }
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
            {/* One contiguous rule under the whole header (spans the gaps). */}
            {!hideRules && (
              <tr aria-hidden="true">
                <td
                  colSpan={totalCols}
                  className={styles.headerRule}
                  style={{ top: depth * HEADER_H }}
                />
              </tr>
            )}
          </thead>

          <tbody className={styles.body}>
            {paddingTop > 0 && (
              <tr className={styles.spacer} style={{ height: paddingTop }}>
                <td colSpan={totalCols} />
              </tr>
            )}
            {items.map((item) => {
              const row = rows[item.index]!;
              const prev = item.index > 0 ? rows[item.index - 1] : undefined;
              const next =
                item.index < rows.length - 1 ? rows[item.index + 1] : undefined;
              return (
                <Row
                  key={item.index}
                  rowIndex={item.index}
                  row={row}
                  prevPath={grouped ? prev?.path : undefined}
                  nextPath={grouped ? next?.path : undefined}
                  grouped={grouped}
                  rowLevels={rowLevels}
                  memberFormats={rowMemberFormats}
                  leaves={leaves}
                  frame={frame}
                  leftOffset={leftOffset}
                  gapAfter={gapAfter}
                  bodyLeadGap={bodyLeadGap}
                  indexColumns={indexColumns}
                  extraTop={extraTop[item.index] ?? 0}
                  zebra={zebra}
                  pendingAt={pendingAt}
                  tintLevel={tintLevel}
                  tintLeaves={tintLeaves}
                  addEntry={adding ? addEntries[item.index] : undefined}
                  onAdd={commitAdd}
                  hover={hover}
                  hoverPath={hover ? rows[hover.row]?.path : undefined}
                  onHover={setHover}
                />
              );
            })}
            {paddingBottom > 0 && (
              <tr className={styles.spacer} style={{ height: paddingBottom }}>
                <td colSpan={totalCols} />
              </tr>
            )}
          </tbody>

          {(footerLines.length > 0 || editable) && (
            <tfoot>
              {/* Lineless: a small background gap; otherwise a contiguous
                accountant-style double line directly against the data. */}
              <tr aria-hidden="true">
                <td
                  colSpan={totalCols}
                  className={hideRules ? styles.footSpace : styles.footDouble}
                  style={{
                    position: 'sticky',
                    bottom: footerBottom,
                    zIndex: 4,
                  }}
                  // Leaving the body into the footer drops the body-row hover.
                  onMouseEnter={() => setHover({ row: -1, leaf: -1 })}
                />
              </tr>
              {footerLines.map((fr, fi) => (
                <FooterRow
                  key={`f${fi}`}
                  label={fr.label}
                  cells={fr.cells}
                  leaves={leaves}
                  frame={frame}
                  rowLevels={rowLevels}
                  gapAfter={gapAfter}
                  bodyLeadGap={bodyLeadGap}
                  bottom={(footerLines.length - 1 - fi) * ROW_HEIGHT}
                  leftOffset={leftOffset}
                  extraIndexCols={editCols}
                  tintLeaves={tintLeaves}
                  onRemove={
                    editable
                      ? fi < footerRows.length
                        ? () => onDisplayChange?.(removeFooterRow(display, fi))
                        : () => onViewChange?.(setShowSummary(view, false))
                      : undefined
                  }
                  onHover={setHover}
                />
              ))}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/**
 * Group-boundary gaps, rendered as a background-colored channel so the space is
 * visible between column groups (in headers, footer, and body). Keyed by the
 * cell's leaf range so a spanning header (e.g. "tiny") shows no internal gap.
 */
function edgeGapStyle(
  leafStart: number,
  leafEnd: number,
  gapAfter: number[],
  bodyLeadGap: number,
): CSSProperties {
  const style: CSSProperties = {};
  const after = gapAfter[leafEnd] ?? 0;
  if (after) style.borderRight = `${after}px solid var(--pv-bg)`;
  if (leafStart === 0 && bodyLeadGap)
    style.borderLeft = `${bodyLeadGap}px solid var(--pv-bg)`;
  return style;
}

/** True if the first `n` levels of two paths are equal. */
function prefixEqual(a: unknown[], b: unknown[], n: number): boolean {
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}

interface RowProps {
  rowIndex: number;
  row: ResultRow;
  prevPath: unknown[] | undefined;
  nextPath: unknown[] | undefined;
  grouped: boolean;
  rowLevels: string[];
  memberFormats: MemberFormat[];
  leaves: ResolvedLeaf[];
  frame: DataFrame;
  leftOffset: number[];
  gapAfter: number[];
  bodyLeadGap: number;
  indexColumns: number;
  extraTop: number;
  zebra: boolean;
  /** Where the pending column sits among the index cells, or null. */
  pendingAt: number | null;
  /** Cells a pending removal would take: an index level, and/or leaf columns. */
  tintLevel?: number;
  tintLeaves?: Set<number>;
  /** The entry this row shows while the pending column is open. */
  addEntry?: AddEntry;
  onAdd?: (field: string) => void;
  hover: { row: number; leaf: number } | null;
  hoverPath: unknown[] | undefined;
  onHover: (h: { row: number; leaf: number } | null) => void;
}

function Row({
  rowIndex,
  row,
  prevPath,
  nextPath,
  grouped,
  rowLevels,
  memberFormats,
  leaves,
  frame,
  leftOffset,
  gapAfter,
  bodyLeadGap,
  indexColumns,
  extraTop,
  zebra,
  pendingAt,
  tintLevel,
  tintLeaves,
  addEntry,
  onAdd,
  hover,
  hoverPath,
  onHover,
}: RowProps) {
  const hoveredRow = hover?.row === rowIndex;
  const gapTop = extraTop
    ? { borderTop: `${extraTop}px solid var(--pv-bg)` }
    : undefined;

  return (
    <tr style={{ height: ROW_HEIGHT + extraTop }}>
      {indexCols(
        rowLevels.length,
        pendingAt,
        (level) => {
          // Label shown only where this level's group starts.
          const show =
            !grouped ||
            !prevPath ||
            !prefixEqual(prevPath, row.path, level + 1);
          // Merge cells: drop the bottom rule while the group continues below.
          const continues =
            grouped && !!nextPath && prefixEqual(nextPath, row.path, level + 1);
          // Breadcrumb highlight: the label cell carrying an ancestor (or self)
          // of the hovered row.
          const lit =
            !!hoverPath && show && prefixEqual(row.path, hoverPath, level + 1);
          return (
            <th
              key={level}
              scope="row"
              className={cls(
                styles.rowHeaderCell,
                styles.indexTint,
                styles.left,
                lit && styles.rowHover,
                tintLevel === level && styles.removeTint,
              )}
              style={{
                left: leftOffset[level],
                // Gap only where this level starts a new block; spanning
                // (blank) cells stay continuous across the gap.
                ...(gapTop && show ? gapTop : {}),
                ...(continues ? { borderBottom: 'none' } : {}),
              }}
              onMouseEnter={() => onHover({ row: rowIndex, leaf: -1 })}
            >
              {show
                ? (memberFormats[level]?.(row.path[level] ?? null) ?? '')
                : ''}
            </th>
          );
        },
        () => (
          <td key="pending" className={styles.editCell} style={gapTop}>
            {addEntry?.kind === 'option' && (
              <button
                type="button"
                className={styles.addOption}
                onClick={() => onAdd?.(addEntry.id)}
              >
                {addEntry.label}
              </button>
            )}
            {addEntry?.kind === 'custom' && (
              <button
                type="button"
                className={cls(styles.addOption, styles.addCustom)}
                title="Not built yet"
              >
                Custom…
              </button>
            )}
            {addEntry?.kind === 'note' && (
              <span className={styles.addNote}>{addEntry.text}</span>
            )}
          </td>
        ),
      )}
      {row.cells.map((cell, i) => {
        const leaf = leaves[i]!;
        const ctx = makeCtx(leaf, cell, row.path, frame);
        const node: ReactNode = leaf.render
          ? leaf.render(ctx)
          : leaf.format(ctx);
        const isIndex = rowLevels.length === 0 && i < indexColumns;
        const cellHovered = hoveredRow && hover?.leaf === i;
        return (
          <td
            key={leaf.id}
            className={cls(
              alignClass(leaf.column.align),
              isIndex && styles.indexTint,
              zebra && rowIndex % 2 === 1 && styles.zebra,
              hoveredRow && styles.rowHover,
              cellHovered && styles.cellHover,
              tintLeaves?.has(i) && styles.removeTint,
            )}
            style={{
              ...leaf.style(ctx),
              ...edgeGapStyle(i, i, gapAfter, bodyLeadGap),
              ...gapTop,
            }}
            onMouseEnter={() => onHover({ row: rowIndex, leaf: i })}
          >
            {node}
          </td>
        );
      })}
    </tr>
  );
}

interface FooterRowProps {
  label: string;
  cells: Cell[];
  leaves: ResolvedLeaf[];
  frame: DataFrame;
  rowLevels: string[];
  gapAfter: number[];
  bodyLeadGap: number;
  bottom: number;
  leftOffset: number[];
  /** The label cell spans the pending column too, when one is showing. */
  extraIndexCols: number;
  tintLeaves?: Set<number>;
  /** Present in edit mode: drops this line from the footer. */
  onRemove?: () => void;
  onHover: (h: { row: number; leaf: number } | null) => void;
}

function FooterRow({
  label,
  cells,
  leaves,
  frame,
  rowLevels,
  gapAfter,
  bodyLeadGap,
  bottom,
  leftOffset,
  extraIndexCols,
  tintLeaves,
  onRemove,
  onHover,
}: FooterRowProps) {
  const sticky: CSSProperties = { position: 'sticky', bottom, zIndex: 1 };
  // What this row's own remove control would take is the whole row, so the
  // state is local rather than shared with the column tints.
  const [removing, setRemoving] = useState(false);
  return (
    <tr className={styles.summaryRow} style={{ height: ROW_HEIGHT }}>
      {rowLevels.length > 0 && (
        <th
          className={cls(
            styles.summaryLabel,
            styles.indexTint,
            removing && styles.removeTint,
          )}
          colSpan={rowLevels.length + extraIndexCols}
          style={{ ...sticky, left: leftOffset[0], zIndex: 3 }}
          onMouseEnter={() => onHover({ row: -1, leaf: -1 })}
        >
          {label}
          {onRemove && (
            <RemoveField
              title={`Remove the ${label} row`}
              onLink={setRemoving}
              onRemove={onRemove}
            />
          )}
        </th>
      )}
      {cells.map((cell, i) => {
        const leaf = leaves[i]!;
        const ctx = makeCtx(leaf, cell, [], frame);
        const node: ReactNode = leaf.render
          ? leaf.render(ctx)
          : leaf.format(ctx);
        return (
          <td
            key={leaf.id}
            className={cls(
              alignClass(leaf.column.align),
              (removing || tintLeaves?.has(i)) && styles.removeTint,
            )}
            style={{
              ...leaf.style(ctx),
              ...edgeGapStyle(i, i, gapAfter, bodyLeadGap),
              ...sticky,
            }}
            // Footer sentinel row (-1): lights the column header, no body row.
            onMouseEnter={() => onHover({ row: -1, leaf: i })}
          >
            {node}
          </td>
        );
      })}
    </tr>
  );
}
