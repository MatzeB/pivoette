/**
 * The contexts that let a chart be composed rather than configured.
 *
 * `<GraphBox>` computes the scales once and every mark reads them, so a host
 * can nest its own `<circle>` beside the built-in ones and place it correctly
 * without being handed anything. That is what a context is for, and it is the
 * only place in this codebase that uses one: everywhere else the component tree
 * is shallow and known, and prop lists say more than a hidden channel would.
 * A chart tree is neither — its depth and contents are the host's to choose.
 *
 * There are five, and the split is about *when each changes*:
 *
 * - `GraphContext` changes when the data or the size does. Nearly everything
 *   reads it.
 * - `PointerValueContext` changes on every mouse move. Only the scrubber's own
 *   three pieces read it, so a sweep repaints three leaves instead of the chart.
 * - `PointerSetContext` never changes — it holds a `useState` setter, so the hit
 *   rect can *write* the hover without subscribing to it.
 * - `LayersContext` changes once, when the two portal targets mount.
 * - `SeriesContext` / `DatumContext` are mounted by a series mark around its
 *   per-point children.
 *
 * Splitting alone would not be enough: React re-renders a component's whole
 * returned subtree when its own state changes, however many contexts that state
 * is spread across. `PointerProvider` therefore owns the hover state and takes
 * `children` **as a prop**, so the element it re-renders is the same object it
 * was handed and React bails out on the marks. Inlining that JSX would quietly
 * undo the whole arrangement.
 */
import { createContext, useContext } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { Scale, TickSet } from './scale';
import type { GraphData, GraphPoint, Series } from './series';

/**
 * Where a chart says what its numbers are measured in.
 *
 * One setting for the whole chart, not per mark. The axis title, the tick
 * labels, a `<PointLabel>`, and the scrubber's readout are all reading the same
 * value axis, so each deciding for itself is how `Net worth ($k)` ends up with
 * `$372.9k` beside it and `$163.09k` under the pointer — the unit stated three
 * times for one axis. Mirrors `DataTableDisplay.unitPlacement`, with `axis`
 * playing the part `header` plays for a table.
 */
export type GraphUnitPlacement = 'axis' | 'value' | 'off';

export interface GraphGeometry {
  x: Scale;
  y: Scale;
  /** The plot area, inside the margins, in SVG user units (= CSS pixels). */
  plot: { left: number; top: number; width: number; height: number };
  data: GraphData;
  /** The CSS colour for a series slot, as a `var()` reference. */
  colorOf: (index: number) => string;
  /** Where the unit is stated. Every mark that could state it reads this. */
  unitPlacement: GraphUnitPlacement;
  /** Ticks each axis aims for, so an axis and the margin estimate agree. */
  ticks: number;
  /**
   * Pixel row the value axis calls zero, clamped into the plot.
   *
   * One definition for the three marks that need it: a bar grows from it, an
   * area fills to it, and an outside `<PointLabel>` picks its side against it.
   * Computing it separately is how a bar ends up growing from the clamped zero
   * while its label picks a side from the unclamped one, and lands inside the
   * fill.
   */
  baseline: number;
  /**
   * A value in display units, as the chart writes it — precision and unit
   * placement already applied.
   *
   * Built once here rather than per mark. Three marks used to compose this
   * pipeline themselves and disagreed about precision, so one point read
   * `$160k` on the axis, `$163.1k` as an end label, and `$163.09k` under the
   * pointer; and `PointLabel` rebuilt an `Intl.NumberFormat` per point.
   */
  formatValue: (value: number, decimals?: number) => string;
  /**
   * Fraction digits the value axis's own tick step needs, and the base every
   * other mark measures from.
   *
   * A tick and a point label are not asking the same question: a tick rounds
   * to the step it sits on, while a label or a readout names one point and
   * wants a digit past it. Deriving the second from the first keeps them one
   * rule apart instead of three unrelated constants.
   */
  valueDecimals: number;
  /**
   * The x axis's ticks, generated once. `Axis` paints them and `Scrubber` reads
   * the calendar interval off them — regenerating cost a `formatToParts` per
   * tick to answer one enum.
   */
  xTicks: TickSet;
  locale: string | undefined;
  timeZone: string | undefined;
}

export interface GraphPointer {
  /** Null when the pointer is away. `index` indexes `GraphData.xs`. */
  hover: { index: number; px: number } | null;
}

export interface GraphSeriesCtx {
  series: Series;
  /** This series' colour. Constant across its points, so it lives here rather
   * than being repeated in every datum. */
  color: string;
}

export interface GraphDatum {
  point: GraphPoint;
  /** Index into `series.points`, and into `GraphData.xs`. */
  index: number;
  /** Where the point sits, in the SVG's user coordinates. */
  cx: number;
  cy: number;
}

/**
 * The two HTML containers a chart can put text into.
 *
 * Marks are SVG children, but a legend and a scrubber readout are HTML — see
 * `Graph.module.css` for why. Rather than making the host pass them through
 * separate props, both are written among the children like any other mark and
 * portal themselves into the right layer.
 */
export interface GraphLayers {
  /** Absolutely positioned over the plot, for the scrubber readout. */
  overlay: HTMLDivElement | null;
  /** In normal flow beneath the plot, for the legend. */
  below: HTMLDivElement | null;
}

/**
 * What a series component accepts as children: elements replicated once per
 * point, or a function called with each point.
 */
export type DatumChildren =
  ReactNode | ((datum: GraphDatum, index: number) => ReactNode);

/** Render a series' children for one point, whichever shape they came in. */
export function renderDatum(
  children: DatumChildren,
  datum: GraphDatum,
  index: number,
): ReactNode {
  return typeof children === 'function' ? children(datum, index) : children;
}

export const GraphContext = createContext<GraphGeometry | null>(null);
export const LayersContext = createContext<GraphLayers>({
  overlay: null,
  below: null,
});
export const PointerValueContext = createContext<GraphPointer>({ hover: null });

/**
 * The full `useState` setter, so a writer can compute the next hover from the
 * current one without subscribing to it. That is what makes the throttle
 * possible: returning the previous object unchanged when the index has not
 * moved lets React bail out of the update entirely.
 */
export type SetHover = Dispatch<SetStateAction<GraphPointer['hover']>>;

export const PointerSetContext = createContext<SetHover>(() => {});
export const SeriesContext = createContext<GraphSeriesCtx | null>(null);
export const DatumContext = createContext<GraphDatum | null>(null);

function required<T>(value: T | null, what: string, inside: string): T {
  if (value === null) {
    throw new Error(`${what} must be rendered inside ${inside}.`);
  }
  return value;
}

/** The scales, plot area, and data. Throws outside a `<GraphBox>`. */
export function useGraph(): GraphGeometry {
  return required(useContext(GraphContext), 'A chart mark', '<GraphBox>');
}

/** The HTML layers, for a mark whose output is text rather than geometry. */
export function useLayers(): GraphLayers {
  return useContext(LayersContext);
}

/** What the pointer is doing. Subscribing repaints on every move. */
export function usePointer(): GraphPointer {
  return useContext(PointerValueContext);
}

/** Report where the pointer is, without subscribing to the answer. */
export function useSetPointer(): SetHover {
  return useContext(PointerSetContext);
}

/** The series a mark belongs to. Throws outside one. */
export function useSeries(): GraphSeriesCtx {
  return required(useContext(SeriesContext), 'This mark', 'a series component');
}

/** The point a per-datum child is standing on. Throws outside one. */
export function useDatum(): GraphDatum {
  return required(
    useContext(DatumContext),
    'This mark',
    'a series component, as a per-point child',
  );
}
