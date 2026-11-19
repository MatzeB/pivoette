/**
 * A pivot view drawn as grouped bars: the component behind
 * `display.as === 'chart'`.
 *
 * It composes the same marks a hand-written chart would — this file is an
 * ordinary `<GraphBox>` composition, whose data comes from the pivot engine
 * through `graphFromView` instead of from field names. What it adds is the
 * part a configured chart needs and a composed one does not: saying, in place
 * of a blank box, why a view cannot be drawn.
 */
import { useMemo } from 'react';
import { fromDataset } from '../data/import';
import type { DataFrame, DatasetJson } from '../data/types';
import { computeView } from '../pivot/engine';
import type { ViewSpec } from '../pivot/spec';
import type { DataTableDisplay } from '../components/DataTable';
import { Axis } from './Axis';
import { BarSeries } from './BarSeries';
import { GraphBox } from './GraphBox';
import { Legend } from './Legend';
import { Box, Marker, PointLabel, ReferenceLine, Whisker } from './marks';
import { Scrubber } from './Scrubber';
import { graphFromView } from './pivot-chart';
import type { PivotGraph } from './pivot-chart';
import { categoryMargin } from './levels';
import { MAX_BAR_WIDTH } from './BarSeries';
import styles from './Graph.module.css';

export interface PivotChartProps {
  data: Record<string, unknown>[] | DatasetJson | DataFrame;
  view: ViewSpec;
  /** Only `display.chart` is read. */
  display?: DataTableDisplay;
  /** Fixed width. Omitted, the chart fills its container. */
  width?: number;
  theme?: 'auto' | 'light' | 'dark';
  locale?: string;
  timeZone?: string;
  className?: string;
}

/** Room past the longest bar for its printed value. */
const LABEL_ROOM = 44;
/** Space between two side-by-side panels, and the left margin of all but the
 * first: room for the value axis's first tick label to centre on its edge. */
const PANEL_GAP = 24;
/** Air above and below each category's group of bars. */
const GROUP_PAD = 18;
/** The plot's own margins plus the value axis and its title. */
const CHROME = 12 + 46;

function isFrame(data: PivotChartProps['data']): data is DataFrame {
  return typeof data === 'object' && data !== null && 'columnByName' in data;
}

export function PivotChart({
  data,
  view,
  display,
  width,
  theme = 'auto',
  locale,
  timeZone,
  className,
}: PivotChartProps) {
  const frame = useMemo(
    () => (isFrame(data) ? data : fromDataset(data)),
    [data],
  );
  const chart = display?.chart;
  const built = useMemo<PivotGraph>(() => {
    try {
      return graphFromView(computeView(frame, view), view, chart);
    } catch (e) {
      // A view mid-edit can name a field that is gone; say so in place.
      return {
        graph: null,
        panels: [],
        problems: [e instanceof Error ? e.message : String(e)],
        notes: [],
      };
    }
  }, [frame, view, chart]);

  const { panels, problems, notes } = built;
  if (panels.length === 0) {
    return (
      <div
        className={`${styles.root} ${styles.problems} ${className ?? ''}`}
        data-theme={theme === 'auto' ? undefined : theme}
        role="alert"
      >
        {problems.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
    );
  }

  const horizontal = (chart?.orientation ?? 'horizontal') === 'horizontal';
  const labels = chart?.labels ?? true;
  const boxes = chart?.plot === 'boxes';
  const hover = chart?.hover ?? true;
  const first = panels[0]!.graph;
  // Lying down, the chart is as tall as its bars need: a list grows with its
  // entries. Standing up, the bars share the width, and a fixed height reads.
  // Panels share one height, so their rows line up across them.
  const bars = Math.max(...panels.map((x) => x.graph.series.length));
  const height =
    chart?.height ??
    (horizontal
      ? Math.max(
          160,
          first.categories.length * (bars * (MAX_BAR_WIDTH - 4) + GROUP_PAD) +
            CHROME,
        )
      : 320);

  // Side by side, only the first panel names the categories; the rest start
  // a gap's width from the one before. Each panel's flex basis is the margin
  // it carries, so the space that is left — the plots — is shared equally.
  const split = panels.length > 1;
  const labelled = horizontal
    ? categoryMargin(first.categories, first.categoryPaths)
    : undefined;
  const leftOf = (i: number) =>
    !split || !horizontal ? undefined : i === 0 ? labelled! : PANEL_GAP;
  const share =
    width === undefined
      ? undefined
      : split && horizontal
        ? (width - labelled! - PANEL_GAP * (panels.length - 1)) / panels.length
        : width / panels.length;
  const widthOf = (i: number) =>
    share === undefined
      ? undefined
      : split && horizontal
        ? Math.floor(share + leftOf(i)!)
        : Math.floor(share);

  return (
    <div className={className}>
      <div className={styles.panels}>
        {panels.map((panel, i) => (
          <div
            key={panel.key || i}
            className={styles.panel}
            style={{
              flex:
                width === undefined
                  ? `1 1 ${leftOf(i) ?? 0}px`
                  : `0 0 ${widthOf(i)}px`,
            }}
          >
            <GraphBox
              graph={panel.graph}
              orientation={horizontal ? 'horizontal' : 'vertical'}
              baseline={chart?.baseline}
              symmetric={chart?.symmetric}
              headroom={labels ? LABEL_ROOM : 0}
              height={height}
              width={widthOf(i)}
              theme={theme}
              locale={locale}
              timeZone={timeZone}
              // A value axis that does not reach zero would draw bars from
              // wherever it starts, which overstates every difference.
              includeZero={chart?.baseline === undefined}
              margin={
                horizontal
                  ? leftOf(i) === undefined
                    ? undefined
                    : { left: leftOf(i) }
                  : // Standing up, the labels need the room above the bars.
                    { top: 24 }
              }
            >
              <Axis side={horizontal ? 'bottom' : 'left'} grid />
              {(!split || !horizontal || i === 0) && (
                <Axis side={horizontal ? 'left' : 'bottom'} />
              )}
              {hover && <Scrubber dots={false} />}
              <BarSeries body={boxes ? 'none' : 'bar'}>
                <Whisker />
                {boxes && <Box />}
                {/* Smaller in a box plot: there it sits on a box, not a bar,
                    and must not hide the median line beside it. */}
                <Marker own={boxes} size={boxes ? 3.5 : undefined} />
                {labels && <PointLabel at="all" side="outside" />}
              </BarSeries>
              {chart?.baseline !== undefined && <ReferenceLine />}
              {/* Once: the bars are the same in every panel. */}
              {i === 0 && <Legend />}
            </GraphBox>
          </div>
        ))}
      </div>
      {notes.length > 0 && (
        <div className={styles.notes}>
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}
    </div>
  );
}
