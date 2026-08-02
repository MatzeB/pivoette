/** Pivoette — in-browser pivot-table / data-analysis component. */

// Component
export { DataTable } from './components/DataTable';
export type { DataTableProps, DataTableDisplay } from './components/DataTable';

// Data model
export { fromRows } from './data/import';
export { makeFrame, requireColumn } from './data/frame';
export type {
  CellValue,
  ColumnType,
  DataColumn,
  DataFrame,
  JsonValue,
} from './data/types';

// Engine
export { computeView } from './pivot/engine';
export { buildHeader, toHeaderRows } from './pivot/result';
export type {
  Cell,
  HeaderCell,
  HeaderNode,
  ResolvedLeaf,
  ResultRow,
  ViewResult,
} from './pivot/result';

// Config language
export { isFlat } from './pivot/spec';
export type {
  CellRef,
  ColumnDef,
  CompositeSpec,
  Direction,
  FormatSpec,
  NamedSpec,
  PivotSpec,
  RenderSpec,
  SortSpec,
  StyleSpec,
  TableSpec,
  ValuePlacement,
  ValueSpec,
  ViewSpec,
} from './pivot/spec';

// Registries (built-ins + extension points)
export {
  aggregationIds,
  getAggregation,
  registerAggregation,
} from './pivot/aggregations';
export type { Aggregation, Reducer } from './pivot/aggregations';
export { registerFormat, resolveFormat } from './format/format';
export { registerStyle, resolveStyle } from './format/style';
export { registerRender, resolveRender } from './format/render';
export { compileExpression, evalExpression } from './format/expression';
export type {
  Align,
  CellCtx,
  CellRender,
  FormatFn,
  ResolvedColumn,
  StyleFn,
} from './format/context';
