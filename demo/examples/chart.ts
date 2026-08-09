/**
 * What the demo hands a chart example.
 *
 * Table examples export a `ViewSpec` and a `DataTableDisplay`, because a table
 * is fully described by configuration. A chart is not: which marks it carries
 * and in what order they paint is the composition itself, so a chart example
 * exports a *component* instead. This is the shape the harness calls it with.
 */
import type { DatasetJson, GraphUnitPlacement } from '../../src';

export interface ChartExampleProps {
  data: DatasetJson | Record<string, unknown>[];
  theme?: 'auto' | 'light' | 'dark';
  locale?: string;
  timeZone?: string;
  /** Driven by the harness's placement select, like the table examples'. */
  unitPlacement?: GraphUnitPlacement;
}

export type ChartExample = (props: ChartExampleProps) => React.ReactNode;
