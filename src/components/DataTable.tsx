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
  /** Px gap inserted at column-group boundaries (0 = off). */
  groupSpacing?: number;
  /** Flat mode: number of leading columns to tint as an index (default 0). */
  indexColumns?: number;
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
    indexColumns = 0,
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
    // Group gaps: bigger gap for shallower boundaries; none at innermost level.
    const gapAfter = leaves.map(() => 0);
    if (groupSpacing > 0) {
      for (let i = 0; i < leaves.length - 1; i++) {
        const a = leaves[i]!.colPath;
        const b = leaves[i + 1]!.colPath;
        let L = 0;
        while (L < depth && a[L] === b[L]) L++;
        if (L < depth - 1) gapAfter[i] = groupSpacing * (depth - 1 - L);
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

  // Index/body separation gap.
  const bodyLeadGap =
    groupSpacing > 0 && rowLevels.length > 0 ? groupSpacing * 2 : 0;

  const totalWidth =
    indexW.reduce((a, b) => a + b, 0) +
    leafW.reduce((a, b, i) => a + b + gapAfter[i]!, 0) +
    bodyLeadGap;

  // Sorting.
  const rows = useMemo(() => {
    if (!sort) return result.rows;
    const dir = sort.dir === 'desc' ? -1 : 1;
    const get = (r: ResultRow) =>
      sort.key.kind === 'leaf'
        ? r.cells[sort.key.index]?.value
        : r.path[sort.key.level];
    return [...result.rows].sort((a, b) => compareValues(get(a), get(b)) * dir);
  }, [result.rows, sort]);

  const grouped = sort === null; // only show grouped (blanked) row labels unsorted

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
    estimateSize: () => ROW_HEIGHT,
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

        <thead>
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
            return (
              <Row
                key={item.index}
                rowIndex={item.index}
                row={row}
                prevPath={grouped ? prev?.path : undefined}
                grouped={grouped}
                rowLevels={rowLevels}
                leaves={leaves}
                frame={frame}
                leftOffset={leftOffset}
                gapAfter={gapAfter}
                bodyLeadGap={bodyLeadGap}
                indexColumns={indexColumns}
                hover={hover}
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
              return [
                // Background-colored gap between the body and the sticky footer.
                <tr key="fgap" aria-hidden="true">
                  <td
                    colSpan={totalCols}
                    className={styles.footGap}
                    style={{
                      position: 'sticky',
                      bottom: lines.length * ROW_HEIGHT,
                    }}
                  />
                </tr>,
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
                    topRule={fi === 0}
                    bottom={(lines.length - 1 - fi) * ROW_HEIGHT}
                    leftOffset={leftOffset}
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

interface RowProps {
  rowIndex: number;
  row: ResultRow;
  prevPath: unknown[] | undefined;
  grouped: boolean;
  rowLevels: string[];
  leaves: ResolvedLeaf[];
  frame: DataFrame;
  leftOffset: number[];
  gapAfter: number[];
  bodyLeadGap: number;
  indexColumns: number;
  hover: { row: number; leaf: number } | null;
  onHover: (h: { row: number; leaf: number } | null) => void;
}

function Row({
  rowIndex,
  row,
  prevPath,
  grouped,
  rowLevels,
  leaves,
  frame,
  leftOffset,
  gapAfter,
  bodyLeadGap,
  indexColumns,
  hover,
  onHover,
}: RowProps) {
  const rowHovered = hover?.row === rowIndex;
  return (
    <tr style={{ height: ROW_HEIGHT }}>
      {rowLevels.map((_, level) => {
        let show = true;
        if (grouped && prevPath) {
          show = false;
          for (let l = 0; l <= level; l++)
            if (prevPath[l] !== row.path[l]) show = true;
        }
        const cls = [
          styles.rowHeaderCell,
          styles.indexTint,
          styles.left,
          rowHovered ? styles.rowHover : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <th
            key={level}
            scope="row"
            className={cls}
            style={{ left: leftOffset[level] }}
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
        const cellHovered = rowHovered && hover?.leaf === i;
        const cls = [
          alignClass(leaf.column.align),
          isIndex ? styles.indexTint : '',
          rowHovered ? styles.rowHover : '',
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
  topRule: boolean;
  bottom: number;
  leftOffset: number[];
}

function FooterRow({
  label,
  cells,
  leaves,
  frame,
  rowLevels,
  gapAfter,
  bodyLeadGap,
  topRule,
  bottom,
  leftOffset,
}: FooterRowProps) {
  const cls = `${styles.summaryRow} ${topRule ? styles.footTop : ''}`;
  const sticky: CSSProperties = { position: 'sticky', bottom, zIndex: 1 };
  return (
    <tr className={cls} style={{ height: ROW_HEIGHT }}>
      {rowLevels.length > 0 && (
        <th
          className={`${styles.summaryLabel} ${styles.indexTint}`}
          colSpan={rowLevels.length}
          style={{ ...sticky, left: leftOffset[0], zIndex: 3 }}
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
          >
            {node}
          </td>
        );
      })}
    </tr>
  );
}
