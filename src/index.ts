/** Pivoette — in-browser pivot-table / data-analysis component. */

// Component
export { DataTable } from './components/DataTable';
export type {
  DataTableProps,
  DataTableDisplay,
  UnitPlacement,
} from './components/DataTable';

// Charts — composed rather than configured: `GraphBox` resolves the scales and
// every mark nested inside reads them from context.
export { GraphBox, SERIES_SLOTS } from './graph/GraphBox';
export type { GraphBoxProps, GraphMargin } from './graph/GraphBox';
export { Axis } from './graph/Axis';
export type { AxisProps } from './graph/Axis';
export { LineSeries, DEFAULT_MAX_MARKERS } from './graph/LineSeries';
export type { LineSeriesProps } from './graph/LineSeries';
export { BarSeries, MAX_BAR_WIDTH } from './graph/BarSeries';
export type { BarSeriesProps } from './graph/BarSeries';
export { Dot, PointLabel } from './graph/marks';
export type { DotProps, PointLabelProps } from './graph/marks';
export { Legend } from './graph/Legend';
export type { LegendProps } from './graph/Legend';
export { Scrubber } from './graph/Scrubber';
export type { ScrubberProps, ScrubEntry, ScrubHit } from './graph/Scrubber';
export { renderDatum } from './graph/context';
export {
  useDatum,
  useGraph,
  useLayers,
  usePointer,
  useSeries,
  useSetPointer,
} from './graph/context';
export type {
  DatumChildren,
  GraphDatum,
  GraphGeometry,
  GraphLayers,
  GraphPointer,
  GraphSeriesCtx,
  GraphUnitPlacement,
  SetHover,
} from './graph/context';
export { buildGraphData, nearestIndex, selectSeries } from './graph/series';
export type {
  GraphData,
  GraphFields,
  GraphPoint,
  Series,
  XKind,
} from './graph/series';
// Scale factories, for a host building geometry without `GraphBox`. The
// numeric helpers behind them (`spread`, `niceDomain`, `tickDecimals`,
// `MAX_TICKS`) and `continuousScale` — whose fourth parameter is the private
// tick-generator contract between `scale` and `time` — stay internal.
export { bandScale, linearScale, tickStep, DEFAULT_TICKS } from './graph/scale';
export type {
  BandScale,
  ContinuousScale,
  Scale,
  ScaleKind,
  ScaleTick,
  TickSet,
} from './graph/scale';
// The calendar primitives a host would need to write its own time axis.
// `niceTimeDomain` and `timeTicks` are what `timeScale` is *made of*, so they
// stay internal rather than becoming a second way to ask the same question.
export { addTime, chooseInterval, floorTime, timeScale } from './graph/time';
export type { TimeInterval, TimeUnit } from './graph/time';
export { areaPath, barPath, linePath, runs } from './graph/shape';
export type { PlotPoint } from './graph/shape';
// `withUnit` is not here: it is `attachUnit(body, affixOf(labels))`, and two
// public names for one operation is how callers end up disagreeing.
export {
  axisTitle,
  tickFormatter,
  tickSpec,
  timeReadoutFormat,
  timeTickFormat,
} from './graph/axis-format';
export type { TimeTickFormat } from './graph/axis-format';

// Data model
export { datasetMeta, fromDataset, fromRows } from './data/import';
export { fromCsv, parseCsv, parseCsvRows } from './data/csv';
export type { CsvOptions } from './data/csv';
export { makeFrame, requireColumn, withMeta } from './data/frame';
export type {
  CellValue,
  ColumnType,
  DataColumn,
  DataColumnInput,
  DataFrame,
  DatasetJson,
  JsonValue,
} from './data/types';

// Column metadata (display name, category, compound units)
export { deriveColumns } from './data/derive';
export {
  decodeTime,
  firstDayOfWeek,
  isTimestamp,
  parseTime,
  resolveTimeZone,
  temporalHelpers,
  timeParts,
  zoneOffset,
} from './data/temporal';
export type { TimeParts } from './data/temporal';
export { currencyFacts } from './data/currency';
export type { CurrencyFacts } from './data/currency';
export {
  columnCurrency,
  ColumnKind,
  deduceCategory,
  kindId,
  normalizeMeta,
  SCALE_SHORT,
  UNIT_SHORT,
  unitLabels,
} from './data/meta';
export type {
  ColumnCategory,
  ColumnMeta,
  ColumnMetaInput,
  UnitLabels,
} from './data/meta';

// Engine
export { computeView } from './pivot/engine';
export { buildHeader } from './pivot/result';
export type {
  Cell,
  HeaderNode,
  MemberFormat,
  ResolvedLeaf,
  ResultRow,
  ViewResult,
} from './pivot/result';

// Config language
export { autoScaleOf, axisFields, isFlat, normalizeView } from './pivot/spec';
export type {
  AutoScaleSpec,
  AxisField,
  CellRef,
  ColumnDef,
  ComputedMember,
  DerivedField,
  MemberRef,
  FormatOptionsSpec,
  CompositeSpec,
  Direction,
  FormatSpec,
  MeasureColumn,
  NamedSpec,
  NormalizedView,
  RenderSpec,
  SortSpec,
  StyleSpec,
  ViewSpec,
} from './pivot/spec';

// Bundles — data + metadata + view as one JSON document
export { describeFrame, loadBundle, loadRows, validateBundle } from './bundle';
export type { BundleData, ColumnSummary, PivoetteBundle } from './bundle';

// Editing
export { ViewEditor } from './editor/ViewEditor';
export type { ViewEditorProps } from './editor/ViewEditor';
export {
  addColumn,
  addField,
  addFooterRow,
  moveColumn,
  moveField,
  moveFooterRow,
  removeColumn,
  removeField,
  removeFooterRow,
  setColumnAgg,
  setShowSummary,
} from './editor/ops';
export type { FieldRef, FieldZone } from './editor/ops';

// Registries (built-ins + extension points)
export {
  aggregationIds,
  getAggregation,
  registerAggregation,
} from './pivot/aggregations';
export type { Aggregation, Reducer } from './pivot/aggregations';
export { deduceFormat } from './format/deduce';
export { registerFormat, resolveFormat } from './format/format';
export { affixOf, attachUnit } from './format/label';
export type { UnitAffix } from './format/label';
export { registerStyle, resolveStyle } from './format/style';
export { registerRender, resolveRender } from './format/render';
export {
  chooseStep,
  defaultLadder,
  getLadder,
  hasLadder,
  ladderIds,
  registerLadder,
} from './format/ladders';
export type { Ladder, ScaleStep } from './format/ladders';
export { Format, Render, Style } from './format/builtins';
export { compileExpression, evalExpression } from './format/expression';
export type {
  Align,
  CellCtx,
  CellRender,
  FormatFn,
  ResolvedColumn,
  StyleFn,
} from './format/context';
