/**
 * SVG path strings for the marks.
 *
 * Kept out of the components because path arithmetic is the part worth testing
 * without a DOM, and because a host writing its own mark should be able to
 * reuse the geometry without reusing the component.
 *
 * Coordinates are rounded to two decimals throughout. At five hundred points
 * the untrimmed `d` attribute runs to several kilobytes of digits nobody can
 * see, and the string is built and parsed on every render.
 */

/** Two decimals is finer than a pixel; anything beyond it is noise. */
function r(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface PlotPoint {
  x: number;
  /** Null is a hole: the line breaks and picks up on the far side. */
  y: number | null;
}

/**
 * Contiguous runs of non-null points.
 *
 * A gap is a real statement — the account did not exist yet — so the line has
 * to break rather than interpolate across it. Exposed because the area fill and
 * the line have to agree about where the breaks are.
 */
export function runs(
  points: readonly PlotPoint[],
): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  for (const p of points) {
    if (p.y === null) {
      if (current.length > 0) out.push(current);
      current = [];
    } else {
      current.push({ x: p.x, y: p.y });
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * A polyline through the points, one `M` per contiguous run.
 *
 * A single point still emits a move and a zero-length line, so that a series
 * with one datum is visible under a round line cap rather than absent.
 */
export function linePath(points: readonly PlotPoint[]): string {
  return runs(points)
    .map((run) => {
      const head = run[0]!;
      if (run.length === 1)
        return `M${r(head.x)},${r(head.y)}L${r(head.x)},${r(head.y)}`;
      return (
        `M${r(head.x)},${r(head.y)}` +
        run
          .slice(1)
          .map((p) => `L${r(p.x)},${r(p.y)}`)
          .join('')
      );
    })
    .join('');
}

/**
 * The same runs closed down to a baseline, for the wash under a line.
 *
 * Runs of a single point are dropped: a fill two pixels wide reads as a
 * speck of dirt rather than as area.
 */
export function areaPath(
  points: readonly PlotPoint[],
  baseline: number,
): string {
  return runs(points)
    .filter((run) => run.length > 1)
    .map((run) => {
      const head = run[0]!;
      const tail = run[run.length - 1]!;
      return (
        `M${r(head.x)},${r(baseline)}` +
        run.map((p) => `L${r(p.x)},${r(p.y)}`).join('') +
        `L${r(tail.x)},${r(baseline)}Z`
      );
    })
    .join('');
}

/**
 * A bar from a baseline to a value, rounded at the data end only.
 *
 * Rounding both ends would detach the bar from its axis and make it read as a
 * floating capsule; rounding the growing end alone is what makes a column look
 * finished. A bar that grows downwards rounds its bottom, so the corner that
 * is rounded is always the one the data reached.
 *
 * Degenerate sizes are clamped rather than refused: a value near zero produces
 * a bar shorter than the corner radius, and an unclamped arc there crosses
 * itself into a bow tie.
 */
export function barPath(
  x: number,
  baseline: number,
  value: number,
  width: number,
  radius = 4,
): string {
  const w = Math.max(width, 0);
  const height = Math.abs(value - baseline);
  const down = value > baseline;
  // Never taller than half the bar and never wider than half of it, so the two
  // corner arcs cannot meet and overshoot.
  const rad = Math.max(0, Math.min(radius, w / 2, height));
  const x0 = r(x);
  const x1 = r(x + w);
  const base = r(baseline);
  const tip = r(value);
  if (w === 0 || height === 0) return `M${x0},${base}L${x1},${base}`;
  // Sweep direction follows the growth direction so the arc bulges outwards.
  const sweep = down ? 0 : 1;
  const inset = down ? -rad : rad;
  return (
    `M${x0},${base}` +
    `L${x0},${r(value + inset)}` +
    `A${r(rad)},${r(rad)} 0 0 ${sweep} ${r(x + rad)},${tip}` +
    `L${r(x + w - rad)},${tip}` +
    `A${r(rad)},${r(rad)} 0 0 ${sweep} ${x1},${r(value + inset)}` +
    `L${x1},${base}Z`
  );
}
