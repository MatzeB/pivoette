import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CellCtx } from '../format/context';
import type { CellValue, DataFrame } from '../data/types';
import { fromRows } from '../data/import';
import { computeView } from '../pivot/engine';
import { getAggregation } from '../pivot/aggregations';
import type { Cell, ResolvedLeaf, ResultRow } from '../pivot/result';
import type { ViewSpec } from '../pivot/spec';
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
}

export interface DataTableProps {
  data: Record<string, unknown>[] | DataFrame;
  view: ViewSpec;
  height?: number | string;
  theme?: 'auto' | 'light' | 'dark';
  display?: DataTableDisplay;
  className?: string;
}

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

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
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

// ---------------------------------------------------------------------------

export function DataTable({
  data,
  view,
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
    footer = [],
  } = display;

  const result = useMemo(() => {
    const frame = Array.isArray(data) ? fromRows(data) : data;
    return computeView(frame, view);
  }, [data, view]);

  const { rowLevels, leaves, summary, frame } = result;
  const depth = result.columnHeaderDepth;

  const [sort, setSort] = useState<SortState | null>(null);
  // Hovered cell: row index + leaf index (leaf = -1 when hovering an index cell).
  const [hover, setHover] = useState<{ row: number; leaf: number } | null>(
    null,
  );

  const headerRows = useMemo(
    () => headerRowsRanged(result.columnHeader, depth),
    [result, depth],
  );

  // Measured widths (index columns + leaves) and group-boundary gaps.
  const { indexW, leafW, gapAfter, leftOffset } = useMemo(() => {
    const sample = result.rows.slice(0, 200);
    // Footer/summary values are often wider than body cells — measure them too.
    const footerVals = footer.map(({ agg }) => {
      const reduce = getAggregation(agg).reduce;
      return leaves.map((_, li) =>
        reduce(
          result.rows.map((r) => (r.cells[li]!.value ?? null) as CellValue),
        ),
      );
    });
    const leafW = leaves.map((leaf, li) => {
      if (leaf.render) return 200;
      let w = widthOf(leaf.column.label);
      for (const r of sample) {
        const text = leaf.format(makeCtx(leaf, r.cells[li]!, r.path, frame));
        w = Math.max(w, widthOf(text));
      }
      // Footer/summary render bold — measure with the bold face.
      if (summary) {
        const t = leaf.format(makeCtx(leaf, summary[li]!, [], frame));
        w = Math.max(w, widthOf(t, true));
      }
      for (const fv of footerVals) {
        const t = leaf.format(makeCtx(leaf, { value: fv[li]! }, [], frame));
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
  }, [result, leaves, rowLevels, frame, groupSpacing, depth, footer, summary]);

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

  // Column footers (over displayed cell values).
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

  // Virtualization.
  const scrollRef = useRef<HTMLDivElement>(null);
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
  const totalCols = rowLevels.length + leaves.length;

  const wrapperCls = [
    styles.wrapper,
    frameless ? styles.frameless : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  function leafHeaderCls(hc: HCell): string {
    const isLeafCol = hc.leafStart === hc.leafEnd;
    const hovered =
      highlightHeaders &&
      hover != null &&
      hover.leaf >= hc.leafStart &&
      hover.leaf <= hc.leafEnd;
    return [
      isLeafCol && sortable ? styles.sortable : '',
      hovered ? styles.headerHi : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  return (
    <div
      ref={scrollRef}
      className={wrapperCls}
      data-theme={theme === 'auto' ? undefined : theme}
      style={{ maxHeight: height }}
      onMouseLeave={() => setHover(null)}
    >
      <table className={styles.table} style={{ width: totalWidth }}>
        <colgroup>
          {indexW.map((w, i) => (
            <col key={`i${i}`} style={{ width: w }} />
          ))}
          {leafW.map((w, i) => (
            <col
              key={`l${i}`}
              style={{
                width: w + gapAfter[i]! + (i === 0 ? bodyLeadGap : 0),
              }}
            />
          ))}
        </colgroup>

        <thead onMouseOver={() => setHover(null)}>
          {headerRows.map((hrow, level) => (
            <tr key={level} style={{ height: HEADER_H }}>
              {level === 0 &&
                rowLevels.map((lvl, i) => {
                  const active =
                    sort?.key.kind === 'index' && sort.key.level === i;
                  return (
                    <th
                      key={`ih${i}`}
                      rowSpan={depth}
                      className={`${styles.corner} ${styles.rowHeaderCell} ${styles.indexTint} ${sortable ? styles.sortable : ''}`}
                      style={{
                        top: 0,
                        left: leftOffset[i],
                        ...(i === 0
                          ? {}
                          : { borderLeft: '1px solid var(--pv-border)' }),
                      }}
                      onClick={() => cycleSort({ kind: 'index', level: i })}
                    >
                      {lvl}
                      {sortArrow(active)}
                    </th>
                  );
                })}
              {hrow.map((hc, ci) => {
                const isLeafCol = hc.leafStart === hc.leafEnd;
                const active =
                  isLeafCol &&
                  sort?.key.kind === 'leaf' &&
                  sort.key.index === hc.leafStart;
                return (
                  <th
                    key={ci}
                    colSpan={hc.colSpan}
                    rowSpan={hc.rowSpan}
                    className={leafHeaderCls(hc)}
                    style={{
                      top: level * HEADER_H,
                      ...edgeGapStyle(
                        hc.leafStart,
                        hc.leafEnd,
                        gapAfter,
                        bodyLeadGap,
                      ),
                    }}
                    onClick={
                      isLeafCol
                        ? () => cycleSort({ kind: 'leaf', index: hc.leafStart })
                        : undefined
                    }
                  >
                    {hc.label}
                    {sortArrow(active)}
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
                leaves={leaves}
                frame={frame}
                leftOffset={leftOffset}
                gapAfter={gapAfter}
                bodyLeadGap={bodyLeadGap}
                indexColumns={indexColumns}
                extraTop={extraTop[item.index] ?? 0}
                zebra={zebra}
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

        {(summary || footerRows.length > 0) && (
          <tfoot>
            {(() => {
              const lines = [
                ...footerRows,
                ...(summary ? [{ label: 'Total', cells: summary }] : []),
              ];
              const contentBottom = lines.length * ROW_HEIGHT;
              // Lineless: a small background gap; otherwise a contiguous
              // accountant-style double line directly against the data.
              const separator = (
                <tr key="fsep" aria-hidden="true">
                  <td
                    colSpan={totalCols}
                    className={hideRules ? styles.footSpace : styles.footDouble}
                    style={{
                      position: 'sticky',
                      bottom: contentBottom,
                      zIndex: 4,
                    }}
                    // Leaving the body into the footer drops the body-row hover.
                    onMouseEnter={() => setHover({ row: -1, leaf: -1 })}
                  />
                </tr>
              );
              return [
                separator,
                ...lines.map((fr, fi) => (
                  <FooterRow
                    key={`f${fi}`}
                    label={fr.label}
                    cells={fr.cells}
                    leaves={leaves}
                    frame={frame}
                    rowLevels={rowLevels}
                    gapAfter={gapAfter}
                    bodyLeadGap={bodyLeadGap}
                    bottom={(lines.length - 1 - fi) * ROW_HEIGHT}
                    leftOffset={leftOffset}
                    onHover={setHover}
                  />
                )),
              ];
            })()}
          </tfoot>
        )}
      </table>
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
  leaves: ResolvedLeaf[];
  frame: DataFrame;
  leftOffset: number[];
  gapAfter: number[];
  bodyLeadGap: number;
  indexColumns: number;
  extraTop: number;
  zebra: boolean;
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
  leaves,
  frame,
  leftOffset,
  gapAfter,
  bodyLeadGap,
  indexColumns,
  extraTop,
  zebra,
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
      {rowLevels.map((_, level) => {
        // Label shown only where this level's group starts.
        const show =
          !grouped || !prevPath || !prefixEqual(prevPath, row.path, level + 1);
        // Merge cells: drop the bottom rule while the group continues below.
        const continues =
          grouped && !!nextPath && prefixEqual(nextPath, row.path, level + 1);
        // Breadcrumb highlight: the label cell carrying an ancestor (or self)
        // of the hovered row.
        const lit =
          !!hoverPath && show && prefixEqual(row.path, hoverPath, level + 1);
        const cls = [
          styles.rowHeaderCell,
          styles.indexTint,
          styles.left,
          lit ? styles.rowHover : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <th
            key={level}
            scope="row"
            className={cls}
            style={{
              left: leftOffset[level],
              // Gap only where this level starts a new block; spanning
              // (blank) cells stay continuous across the gap.
              ...(gapTop && show ? gapTop : {}),
              ...(continues ? { borderBottom: 'none' } : {}),
            }}
            onMouseEnter={() => onHover({ row: rowIndex, leaf: -1 })}
          >
            {show ? String(row.path[level] ?? '') : ''}
          </th>
        );
      })}
      {row.cells.map((cell, i) => {
        const leaf = leaves[i]!;
        const ctx = makeCtx(leaf, cell, row.path, frame);
        const node: ReactNode = leaf.render
          ? leaf.render(ctx)
          : leaf.format(ctx);
        const isIndex = rowLevels.length === 0 && i < indexColumns;
        const cellHovered = hoveredRow && hover?.leaf === i;
        const cls = [
          alignClass(leaf.column.align),
          isIndex ? styles.indexTint : '',
          zebra && rowIndex % 2 === 1 ? styles.zebra : '',
          hoveredRow ? styles.rowHover : '',
          cellHovered ? styles.cellHover : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <td
            key={leaf.id}
            className={cls}
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
  onHover,
}: FooterRowProps) {
  const sticky: CSSProperties = { position: 'sticky', bottom, zIndex: 1 };
  return (
    <tr className={styles.summaryRow} style={{ height: ROW_HEIGHT }}>
      {rowLevels.length > 0 && (
        <th
          className={`${styles.summaryLabel} ${styles.indexTint}`}
          colSpan={rowLevels.length}
          style={{ ...sticky, left: leftOffset[0], zIndex: 3 }}
          onMouseEnter={() => onHover({ row: -1, leaf: -1 })}
        >
          {label}
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
            className={alignClass(leaf.column.align)}
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
