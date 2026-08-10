/**
 * A line per series, and the mechanism that makes every point addressable.
 *
 * **Every child of a series component is rendered once per point**, inside a
 * context carrying that point. One rule, so `<LineSeries><Dot/></LineSeries>`
 * means what it looks like it means. Decorations belonging to the *series*
 * rather than to its points — the area wash, the built-in markers — are props,
 * because a child that appeared once among children that appear five hundred
 * times would be a trap.
 *
 * Two alternatives were passed over. A static flag on the child component
 * (`Dot.perDatum = true`, partitioned with `Children.toArray`) breaks the
 * moment a child is a fragment, a `memo()`, or the host's own wrapper, and is
 * invisible to the type system. A function child alone is explicit but pushes
 * the datum back into props, which is the thing the context exists to avoid —
 * so it is supported *as well*, funnelling into the same loop.
 */
import { useMemo } from 'react';
import { DatumContext, SeriesContext, renderDatum, useGraph } from './context';
import type { DatumChildren, GraphDatum } from './context';
import { areaPath, linePath } from './shape';
import type { PlotPoint } from './shape';
import { selectSeries } from './series';
import styles from './Graph.module.css';

/**
 * Above this many points, the built-in `markers` stop being drawn.
 *
 * A marker is at least eight pixels across by the mark spec, so five hundred of
 * them in a six-hundred-pixel plot would sit a pixel apart and smear over the
 * line they annotate. Dropping them is the drawing being honest about what fits.
 *
 * The cap governs `markers` and **not** the children, even though a `<Dot/>`
 * child draws the same circle. `markers` is this component's own mark, so it
 * knows exactly what suppressing it costs; a child is the host's, and it may
 * well render at one point in the series rather than at all of them —
 * `<PointLabel at="last">` does. Silently dropping it because the series is
 * long would be this component overruling a decision that was never its own.
 */
export const DEFAULT_MAX_MARKERS = 60;

export interface LineSeriesProps {
  /** Restrict to one series by key or index. Default: all of them. */
  only?: string | number;
  /**
   * Fill between the line and the baseline, as a 10% wash. Suits one or two
   * series; past that the washes overlap into mud and the lines read better
   * bare.
   */
  area?: boolean;
  /** Draw a dot on each point. Cheaper than a `<Dot/>` child, and capped. */
  markers?: boolean;
  /** Point count above which `markers` stops drawing. Children are unaffected. */
  maxMarkers?: number;
  /** Rendered once per point, inside that point's context. */
  children?: DatumChildren;
}

export function LineSeries({
  only,
  area = false,
  markers = false,
  maxMarkers = DEFAULT_MAX_MARKERS,
  children,
}: LineSeriesProps) {
  const { x, y, data, colorOf, baseline } = useGraph();
  // Memoised because it feeds the geometry memo below: `only` returns a fresh
  // array each render, which would miss the memo in exactly the case it exists
  // for.
  const list = useMemo(
    () => selectSeries(data.series, only),
    [data.series, only],
  );

  const geometry = useMemo(
    () =>
      list.map((series) => ({
        series,
        points: series.points.map<PlotPoint>((p) => ({
          x: x.at(p.x),
          y: p.y === null ? null : y.at(p.y),
        })),
      })),
    [list, x, y],
  );

  const showMarkers = markers && data.xs.length <= maxMarkers;
  const decorate = children !== undefined || showMarkers;

  return (
    <>
      {geometry.map(({ series, points }) => {
        const color = colorOf(series.slot);
        return (
          <SeriesContext.Provider key={series.key} value={{ series, color }}>
            <g data-series={series.key}>
              {area && (
                <path
                  className={styles.area}
                  d={areaPath(points, baseline)}
                  style={{ fill: color }}
                  fillOpacity={0.1}
                />
              )}
              <path
                className={styles.line}
                d={linePath(points)}
                style={{ stroke: color }}
              />
              {decorate &&
                points.map((pt, index) => {
                  if (pt.y === null) return null;
                  const datum: GraphDatum = {
                    point: series.points[index]!,
                    index,
                    cx: pt.x,
                    cy: pt.y,
                  };
                  return (
                    <DatumContext.Provider
                      // The x value, not the array index: prepending a point
                      // would otherwise renumber and remount every mark.
                      key={series.points[index]!.x}
                      value={datum}
                    >
                      {showMarkers && (
                        <circle
                          className={styles.dot}
                          cx={pt.x}
                          cy={pt.y}
                          r={4}
                          style={{ fill: color }}
                        />
                      )}
                      {renderDatum(children, datum, index)}
                    </DatumContext.Provider>
                  );
                })}
            </g>
          </SeriesContext.Provider>
        );
      })}
    </>
  );
}
