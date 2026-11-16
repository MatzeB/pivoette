/**
 * Categories with more than one level — `CPython · richards` — laid out the way
 * the table lays out its row index: a column per level, each as wide as its
 * own longest label, and an outer label written once per group rather than
 * on every row.
 *
 * Shared by `GraphBox`, which reserves the left margin, and `Axis`, which
 * draws into it, so the room asked for and the room used are one sum.
 */

/**
 * Roughly one character's width in the UI sans at tick size.
 *
 * Deliberately an estimate. The exact answer needs `getBBox`, which jsdom does
 * not implement, or a canvas `measureText`, which is not available under the
 * test environment either — so reaching for one would make every chart with a
 * left axis untestable here. A margin only has to be close, and `margin` is
 * there for the case where close is not close enough.
 */
export const CHAR_W = 6.6;

/** Outer levels are set bold, which runs about this much wider. */
const BOLD = 1.1;

/** Air between two level columns. */
export const LEVEL_GAP = 14;

/** Clearance between the innermost column and the plot. */
export const LEVEL_INSET = 8;

/** Width of each level's column, outermost first. */
export function levelWidths(paths: readonly (readonly string[])[]): number[] {
  const depth = paths[0]?.length ?? 0;
  return Array.from({ length: depth }, (_v, level) => {
    let widest = 0;
    for (const path of paths) {
      widest = Math.max(widest, path[level]?.length ?? 0);
    }
    const weight = level < depth - 1 ? BOLD : 1;
    return Math.ceil(widest * CHAR_W * weight);
  });
}

/** All the columns together, gaps included. */
export function levelsWidth(paths: readonly (readonly string[])[]): number {
  const widths = levelWidths(paths);
  return (
    widths.reduce((sum, w) => sum + w, 0) +
    LEVEL_GAP * Math.max(0, widths.length - 1)
  );
}

/** Where each column starts, given where the plot does. */
export function levelStarts(
  paths: readonly (readonly string[])[],
  plotLeft: number,
): number[] {
  const widths = levelWidths(paths);
  let x = plotLeft - LEVEL_INSET - levelsWidth(paths);
  return widths.map((w) => {
    const start = x;
    x += w + LEVEL_GAP;
    return start;
  });
}

/**
 * The shallowest level at which row `index` starts a new group: 0 when its
 * outermost label differs from the row above's, the innermost level when
 * only that does. The first row starts every group.
 *
 * Row `index` shows its labels from this level inwards — the ones above are
 * still the previous row's, and the table does not repeat them either.
 */
export function newFrom(
  paths: readonly (readonly string[])[],
  index: number,
): number {
  const path = paths[index]!;
  if (index === 0) return 0;
  const above = paths[index - 1]!;
  const level = path.findIndex((part, i) => part !== above[i]);
  return level === -1 ? path.length : level;
}

/** The narrowest left margin a chart gets, labels or not. */
export const MIN_LEFT = 48;

/**
 * The left margin a horizontal chart's categories need: their columns when
 * they have several levels, else the longest joined label.
 *
 * Exported because a chart split into side-by-side panels draws the labels
 * once, on the first, and has to size that panel's share to match.
 */
export function categoryMargin(
  categories: readonly string[],
  paths: readonly (readonly string[])[] | undefined,
): number {
  if (paths) return Math.ceil(2 + LEVEL_INSET + levelsWidth(paths));
  const widest = categories.reduce((m, l) => Math.max(m, l.length), 0);
  return Math.max(MIN_LEFT, Math.ceil(10 + widest * CHAR_W));
}
