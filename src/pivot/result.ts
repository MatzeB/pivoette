/**
 * The engine's output model — a fully-resolved, render-ready structure shared
 * by flat and pivot modes. Cell hooks (format/style/render) are resolved once
 * per leaf column here so the component just applies them.
 */
import type { CellValue, DataFrame } from '../data/types';
import type {
  CellRender,
  FormatFn,
  ResolvedColumn,
  StyleFn,
} from '../format/context';

export interface Cell {
  /** In display units: `factor` is applied here, so formatting, sorting, and
   * footer aggregates all read the same number. */
  value: unknown;
  /** Resolved compute inputs (for computed columns); usually absent. */
  inputs?: Record<string, unknown>;
}

/** A value/data leaf column with its rendering functions resolved. */
export interface ResolvedLeaf {
  id: string;
  /** Column-key path used to build the multi-level header. */
  colPath: string[];
  column: ResolvedColumn;
  format: FormatFn;
  style: StyleFn;
  render?: CellRender;
}

/**
 * Renders an index member — a row or column key value — for display. Grouping
 * and sorting keep the raw value; only the label goes through here.
 */
export type MemberFormat = (value: CellValue) => string;

/** A node in the multi-level column header forest. */
export interface HeaderNode {
  label: string;
  /** Number of leaf descendants (colspan). */
  span: number;
  children: HeaderNode[];
  /** Depth of this node's subtree used to compute rowspan for shallow leaves. */
  leaf: boolean;
}

export interface ResultRow {
  /** Row index path (length = rowLevels.length; empty for flat). */
  path: CellValue[];
  /** Aligned to `leaves`. */
  cells: Cell[];
}

export interface ViewResult {
  mode: 'pivot' | 'flat';
  /** Labels for the leading row-index columns (pivot); empty for flat. */
  rowLevels: string[];
  /** Renders each row level's members; aligned to `rowLevels`. */
  rowMemberFormats: MemberFormat[];
  leaves: ResolvedLeaf[];
  /** Multi-level header forest over `leaves`. */
  columnHeader: HeaderNode[];
  /** Number of header rows (max colPath depth). */
  columnHeaderDepth: number;
  rows: ResultRow[];
  /** Footer row aligned to `leaves`, if requested. */
  summary?: Cell[];
  frame: DataFrame;
}

/** Build the multi-level header forest from the leaves' column paths. */
export function buildHeader(leaves: ResolvedLeaf[]): {
  forest: HeaderNode[];
  depth: number;
} {
  const depth = leaves.reduce((m, l) => Math.max(m, l.colPath.length), 0);

  function build(subset: ResolvedLeaf[], level: number): HeaderNode[] {
    const order: string[] = [];
    const groups = new Map<string, ResolvedLeaf[]>();
    for (const leaf of subset) {
      const seg = leaf.colPath[level] ?? '';
      if (!groups.has(seg)) {
        groups.set(seg, []);
        order.push(seg);
      }
      groups.get(seg)!.push(leaf);
    }
    return order.map((seg) => {
      const grp = groups.get(seg)!;
      const isLeaf = grp.every((l) => l.colPath.length <= level + 1);
      if (isLeaf) {
        return { label: seg, span: grp.length, children: [], leaf: true };
      }
      const children = build(grp, level + 1);
      const span = children.reduce((s, c) => s + c.span, 0);
      return { label: seg, span, children, leaf: false };
    });
  }

  return { forest: build(leaves, 0), depth: Math.max(depth, 1) };
}
