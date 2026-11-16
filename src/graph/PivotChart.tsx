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
import { Marker, PointLabel, ReferenceLine, Whisker } from './marks';
import { Scrubber } from './Scrubber';
import { graphFromView } from './pivot-chart';
import type { PivotGraph } from './pivot-chart';
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
        problems: [e instanceof Error ? e.message : String(e)],
        notes: [],
      };
    }
  }, [frame, view, chart]);

  const { graph, problems, notes } = built;
  if (!graph) {
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
  const hover = chart?.hover ?? true;
  // Lying down, the chart is as tall as its bars need: a list grows with its
  // entries. Standing up, the bars share the width, and a fixed height reads.
  const bars = graph.series.length;
  const height =
    chart?.height ??
    (horizontal
      ? Math.max(
          160,
          graph.categories.length * (bars * (MAX_BAR_WIDTH - 4) + GROUP_PAD) +
            CHROME,
        )
      : 320);

  return (
    <div className={className}>
      <GraphBox
        graph={graph}
        orientation={horizontal ? 'horizontal' : 'vertical'}
        baseline={chart?.baseline}
        symmetric={chart?.symmetric}
        headroom={labels ? LABEL_ROOM : 0}
        height={height}
        width={width}
        theme={theme}
        locale={locale}
        timeZone={timeZone}
        // A value axis that does not reach zero would draw bars from wherever
        // it starts, which overstates every difference between them.
        includeZero={chart?.baseline === undefined}
        // Bars are few and wide; standing up, the labels need the room above.
        margin={horizontal ? undefined : { top: 24 }}
      >
        <Axis side={horizontal ? 'bottom' : 'left'} grid />
        <Axis side={horizontal ? 'left' : 'bottom'} />
        {hover && <Scrubber dots={false} />}
        <BarSeries>
          <Whisker />
          <Marker />
          {labels && <PointLabel at="all" side="outside" />}
        </BarSeries>
        {chart?.baseline !== undefined && <ReferenceLine />}
        <Legend />
      </GraphBox>
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
