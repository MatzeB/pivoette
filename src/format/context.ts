/**
 * The context object handed to every cell hook (format/style/render) and to
 * computed-column expressions. Kept rich and stable so new capabilities don't
 * require breaking the function signatures.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { DataFrame } from '../data/types';
import type { ColumnMeta } from '../data/meta';
import type { ColumnDef, ValueSpec } from '../pivot/spec';

export type Align = 'left' | 'right' | 'center';

/** A column in the rendered output, with its label/format/style resolved. */
export interface ResolvedColumn {
  id: string;
  label: string;
  align: Align;
  /** Present for flat / computed columns. */
  def?: ColumnDef;
  /** Present for measure columns. */
  value?: ValueSpec;
  /** Metadata of the source field behind this column (flat source / measure). */
  meta?: ColumnMeta;
  /** Metadata of every source field, for composite multi-field columns. */
  sources?: ColumnMeta[];
}

export interface CellCtx {
  /**
   * This cell's value, in display units: the column's `factor` is already
   * applied, so `value > 50` means 50%. The label is separate — `column.meta`.
   */
  value: unknown;
  /**
   * Resolved compute inputs (sibling ids / cell-ref aliases). A referenced
   * measure is already factored; this column's own factor applies after.
   */
  inputs: Record<string, unknown>;
  /** This row's index path (multi-level). */
  rowPath: unknown[];
  /** This column's key path (multi-level). */
  colPath: unknown[];
  /** The resolved column this cell belongs to. */
  column: ResolvedColumn;
  /** Escape hatch to the source data. */
  frame: DataFrame;
}

export type FormatFn = (ctx: CellCtx) => string;
export type StyleFn = (ctx: CellCtx) => CSSProperties;
export type CellRender = (ctx: CellCtx) => ReactNode;
