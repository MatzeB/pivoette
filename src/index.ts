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
export { makeFrame, requireColumn } from './data/frame';
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
export {
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
