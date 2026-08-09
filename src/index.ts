/** Pivoette — in-browser pivot-table / data-analysis component. */

// Component
export { DataTable } from './components/DataTable';
export type {
  DataTableProps,
  DataTableDisplay,
  UnitPlacement,
} from './components/DataTable';

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

// Bundles — data + metadata + view as one JSON document (see agent_usage.md)
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
export { registerStyle, resolveStyle } from './format/style';
export { registerRender, resolveRender } from './format/render';
export {
  chooseStep,
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
