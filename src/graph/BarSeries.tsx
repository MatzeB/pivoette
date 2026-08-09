/**
 * Bars, grouped side by side within each x position.
 *
 * Per-point children work exactly as they do on a line — see `LineSeries` for
 * the rule and why it is the only one. What differs is that a bar occupies a
 * slot rather than a coordinate, so several series have to share the band
 * between them, and the sharing is what most of this file is about.
 *
 * Only grouping, not stacking. Stacked bars need a second pass to accumulate
 * and a rule for what a negative segment means inside a positive stack; that is
 * a decision worth making with a real use in front of it.
 */
import { useMemo } from 'react';
import { DatumContext, SeriesContext, useGraph } from './context';
import type { GraphDatum } from './context';
import { barPath } from './shape';
import type { DatumChildren } from './LineSeries';
import styles from './Graph.module.css';

/**
 * Bars stop widening here.
 *
 * A bar that fills its slot leaves no air between neighbours, and past a
 * certain width the extra ink says nothing the length did not already say.
 * Capping it lets a chart with three categories look deliberate rather than
 * like a stretched version of one with thirty.
 */
export const MAX_BAR_WIDTH = 24;

/** The surface-coloured air between two touching bars. */
const GAP = 2;

/** Corner radius on the growing end. */
const RADIUS = 4;

export interface BarSeriesProps {
  /** Restrict to one series by key or index. Default: all of them. */
  only?: string | number;
  /** Cap on a single bar's thickness. */
  maxWidth?: number;
  /**
   * What a bar's colour stands for. Default `'series'`.
   *
   * `'category'` gives each bar the slot of its own x position instead. On its
   * own that is redundant — the axis already names the categories, and colour
   * that repeats the label earns nothing. It pays when the same categories are
   * a *series* somewhere else on the page: matching slots let a reader carry
   * an identity from one chart to the other, which is the whole reason the
   * palette is assigned in a fixed order rather than cycled.
   *
   * Only meaningful for a single series; several series sharing a band would
   * each colour their bars the same way and lose their own identity.
   */
  colorBy?: 'series' | 'category';
  /** Rendered once per bar, inside that bar's context. */
  children?: DatumChildren;
}

export function BarSeries({
  only,
  maxWidth = MAX_BAR_WIDTH,
  colorBy = 'series',
  children,
}: BarSeriesProps) {
  const { x, y, plot, data, colorOf } = useGraph();

  const all = data.series;
  const list = useMemo(() => {
    if (only === undefined) return all;
    if (typeof only === 'number') {
      const one = all[only];
      return one ? [one] : [];
    }
    return all.filter((s) => s.key === only);
  }, [all, only]);

  // Every series takes a share of the slot, whether or not it was filtered
  // out — so hiding one widens nothing and the bars stay where they were.
  const slot =
    x.kind === 'band'
      ? x.bandwidth()
      : plot.width / Math.max(data.xs.length, 1);
  const share = slot / Math.max(all.length, 1);
  const width = Math.max(1, Math.min(maxWidth, share - GAP));

  // The bars grow from the axis's own zero when it is on screen, and from the
  // nearer edge when it is not — a bar starting off-canvas has no length the
  // reader can measure.
  const baseline = Math.min(
    Math.max(y.at(0), plot.top),
    plot.top + plot.height,
  );

  return (
    <>
      {list.map((series) => {
        // Position within the group by the series' place in the full list.
        const rank = all.indexOf(series);
        const offset = (rank - (all.length - 1) / 2) * share;
        return (
          <g key={series.key} data-series={series.key}>
            {series.points.map((point, index) => {
              if (point.y === null) return null;
              const centre = x.at(point.x) + offset;
              const top = y.at(point.y);
              const color = colorOf(
                colorBy === 'category' ? index : series.index,
              );
              const datum: GraphDatum = { point, index, cx: centre, cy: top };
              return (
                // The series context is mounted per bar rather than per series
                // so that `colorBy` reaches the children too: a `<Dot/>` or a
                // `<PointLabel/>` on a category-coloured bar reads the colour
                // that bar actually is. Bars are few — a band scale is what
                // makes them legible at all — so the extra providers cost
                // nothing worth measuring.
                <SeriesContext.Provider key={point.x} value={{ series, color }}>
                  <DatumContext.Provider value={datum}>
                    <path
                      className={styles.bar}
                      d={barPath(
                        centre - width / 2,
                        baseline,
                        top,
                        width,
                        RADIUS,
                      )}
                      style={{ fill: color }}
                    />
                    {typeof children === 'function'
                      ? children(datum, index)
                      : children}
                  </DatumContext.Provider>
                </SeriesContext.Provider>
              );
            })}
          </g>
        );
      })}
    </>
  );
}
