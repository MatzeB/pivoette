# Pivoette

An in-browser pivot-table and data-analysis component for React.

Load tabular data, from rows, CSV or a URL, and describe the table you want as
a plain JSON **view spec**: what to group by, what to aggregate, and how to
format and style it. Pivoette computes the pivot client-side and renders it as
a virtualized table. Because the view is plain data, it can be saved, diffed,
edited interactively, or written by an LLM.

- **Pivot and flat tables.** Group by any number of row and column fields, or
  show the rows as they are.
- **Aggregations.** `sum`, `count`, `countDistinct`, `min`, `max`, `mean`,
  `median`, `std`, percentiles, `first`/`last`, and your own through
  `registerAggregation`.
- **Unit-aware formatting.** Column metadata such as currencies, compound
  units and timestamps drives headers and number formats, and `autoScale` picks
  thousands, millions and so on from the data.
- **Derived and composite columns.** Row-level computed fields, multi-field
  cells with their own sort keys, and conditional styling.
- **Interactive editing.** An optional `ViewEditor` and editable headers turn
  a view into something users can rearrange.
- **Charts.** Composable `GraphBox`, `LineSeries`, `BarSeries`, `Axis` and
  `Legend` components that share the table's data model and formatting.
- **Embeddable anywhere.** A self-contained `<pivoette-table>` web component
  needs no React on the host page.

## Getting started

```sh
pnpm add pivoette react react-dom
```

```tsx
import { DataTable } from 'pivoette';
import 'pivoette/style.css';

const rows = [
  { region: 'EU', quarter: 'Q1', revenue: 120 },
  { region: 'EU', quarter: 'Q2', revenue: 150 },
  { region: 'US', quarter: 'Q1', revenue: 340 },
  { region: 'US', quarter: 'Q2', revenue: 310 },
];

export function Revenue() {
  return (
    <DataTable
      data={rows}
      height={400}
      view={{
        pivotRows: [{ field: 'region' }],
        pivotColumns: [{ field: 'quarter' }],
        columns: [{ id: 'rev', source: 'revenue', agg: 'sum' }],
      }}
    />
  );
}
```

|        | Q1  | Q2  |
| ------ | --- | --- |
| **EU** | 120 | 150 |
| **US** | 340 | 310 |

`pivotRows` and `pivotColumns` name the fields to group by, and `columns` is
what gets displayed. Everything else is refinement.

To let users edit the table, pass `editing` and keep the view in state:

```tsx
const [view, setView] = useState(initialView);
<DataTable data={rows} view={view} editing onViewChange={setView} />;
```

The engine (`fromRows`, `fromCsv`, `computeView` and friends) does not depend
on React and can be used on its own.

## Web component

For pages that don't use React, such as a chat UI that renders tables an
agent produces, build the standalone element:

```sh
pnpm build:element   # → dist-element/pivoette-element.js
```

```html
<script src="/static/pivoette-element.js" defer></script>

<pivoette-table src="/data/revenue.pivoette.json"></pivoette-table>
```

The element renders inside a shadow root, so host CSS can't reach in and its
CSS can't leak out. It also validates the bundle and shows every problem in
place instead of rendering a blank box. See [EMBEDDING.md](EMBEDDING.md).

## Documentation

- [agent_usage.md](agent_usage.md) is the full reference for the bundle and
  view format: data sources, column metadata, formatting, `autoScale`,
  `derive` and `display`. It's written to be handed to an LLM as-is.
- [EMBEDDING.md](EMBEDDING.md) covers integrating the web component, including
  its security considerations.
- [`demo/examples`](demo/examples) contains worked examples: a stock ticker,
  benchmarks, regression results, token usage, metrics, commit history and a
  net-worth chart.

> [!WARNING]
> View specs can contain `compute` and `expression` fields. These are
> JavaScript expressions evaluated with `new Function`. Only render specs from
> sources you trust, or sandbox them. [EMBEDDING.md](EMBEDDING.md) explains the
> options.

## Development

```sh
pnpm install
pnpm dev             # demo app with all examples
pnpm test            # vitest
pnpm lint
pnpm format:check
pnpm build           # library → dist/
pnpm build:element   # web component → dist-element/
```

## License

[MIT](LICENSE)
