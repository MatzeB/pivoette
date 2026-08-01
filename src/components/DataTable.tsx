import { useMemo, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CellCtx } from '../format/context';
import type { DataFrame } from '../data/types';
import { fromRows } from '../data/import';
import { computeView } from '../pivot/engine';
import type { Cell, ResolvedLeaf, ResultRow } from '../pivot/result';
import { toHeaderRows } from '../pivot/result';
import type { ViewSpec } from '../pivot/spec';
import styles from './DataTable.module.css';

export interface DataTableProps {
  /** Row objects (rows of dicts) or a prebuilt DataFrame. */
  data: Record<string, unknown>[] | DataFrame;
  view: ViewSpec;
  /** Max height of the scroll container (default 480px). */
  height?: number | string;
  /**
   * Color theme. `auto` (default) follows the OS via `prefers-color-scheme`;
   * `light`/`dark` force a theme regardless of the OS setting.
   */
  theme?: 'auto' | 'light' | 'dark';
  className?: string;
}

const ROW_HEIGHT = 30;

function alignClass(align: 'left' | 'right' | 'center'): string {
  if (align === 'right') return styles.numeric!;
  if (align === 'center') return styles.center!;
  return styles.left!;
}

/** True if any ancestor level (0..level) differs between two row paths. */
function changedAt(
  prev: unknown[] | undefined,
  cur: unknown[],
  level: number,
): boolean {
  if (!prev) return true;
  for (let l = 0; l <= level; l++) {
    if (prev[l] !== cur[l]) return true;
  }
  return false;
}

function renderCell(
  leaf: ResolvedLeaf,
  cell: Cell,
  rowPath: unknown[],
  frame: DataFrame,
): { node: ReactNode; style: CSSProperties } {
  const ctx: CellCtx = {
    value: cell.value,
    inputs: cell.inputs ?? {},
    rowPath,
    colPath: leaf.colPath,
    column: leaf.column,
    frame,
  };
  const style = leaf.style(ctx);
  const node = leaf.render ? leaf.render(ctx) : leaf.format(ctx);
  return { node, style };
}

export function DataTable({
  data,
  view,
  height = 480,
  theme = 'auto',
  className,
}: DataTableProps) {
  const result = useMemo(() => {
    const frame = Array.isArray(data) ? fromRows(data) : data;
    return computeView(frame, view);
  }, [data, view]);

  const { rowLevels, leaves, rows, summary, frame } = result;
  const headerRows = toHeaderRows(
    result.columnHeader,
    result.columnHeaderDepth,
  );

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

  return (
    <div
      ref={scrollRef}
      className={`${styles.wrapper} ${className ?? ''}`}
      data-theme={theme === 'auto' ? undefined : theme}
      style={{ maxHeight: height }}
    >
      <table className={styles.table}>
        <thead>
          {headerRows.map((hrow, level) => (
            <tr key={level}>
              {level === 0 && rowLevels.length > 0 && (
                <th
                  className={`${styles.corner} ${styles.rowHeaderCell}`}
                  colSpan={rowLevels.length}
                  rowSpan={result.columnHeaderDepth}
                >
                  {rowLevels.join(' · ')}
                </th>
              )}
              {hrow.map((hc, i) => (
                <th key={i} colSpan={hc.colSpan} rowSpan={hc.rowSpan}>
                  {hc.label}
                </th>
              ))}
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
                row={row}
                prevPath={prev?.path}
                rowLevels={rowLevels}
                leaves={leaves}
                frame={frame}
              />
            );
          })}
          {paddingBottom > 0 && (
            <tr className={styles.spacer} style={{ height: paddingBottom }}>
              <td colSpan={totalCols} />
            </tr>
          )}
        </tbody>

        {summary && (
          <tfoot>
            <tr className={styles.summaryRow}>
              {rowLevels.length > 0 && (
                <th
                  className={styles.summaryLabel}
                  colSpan={Math.max(rowLevels.length, 1)}
                >
                  Total
                </th>
              )}
              {summary.map((cell, i) => {
                const leaf = leaves[i]!;
                const { node, style } = renderCell(leaf, cell, [], frame);
                return (
                  <td
                    key={leaf.id}
                    className={alignClass(leaf.column.align)}
                    style={style}
                  >
                    {node}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

interface RowProps {
  row: ResultRow;
  prevPath: unknown[] | undefined;
  rowLevels: string[];
  leaves: ResolvedLeaf[];
  frame: DataFrame;
}

function Row({ row, prevPath, rowLevels, leaves, frame }: RowProps) {
  return (
    <tr style={{ height: ROW_HEIGHT }}>
      {rowLevels.map((_, level) => {
        const show = changedAt(prevPath, row.path, level);
        const cls =
          level === 0
            ? `${styles.rowHeaderCell}`
            : `${styles.rowHeaderCell} ${styles.left}`;
        return (
          <th key={level} className={cls} scope="row">
            {show ? String(row.path[level] ?? '') : ''}
          </th>
        );
      })}
      {row.cells.map((cell, i) => {
        const leaf = leaves[i]!;
        const { node, style } = renderCell(leaf, cell, row.path, frame);
        return (
          <td
            key={leaf.id}
            className={alignClass(leaf.column.align)}
            style={style}
          >
            {node}
          </td>
        );
      })}
    </tr>
  );
}
