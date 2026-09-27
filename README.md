# Pivoette

An in-browser pivot-table and data-analysis component for React.

Load tabular data, from rows, CSV or a URL, and describe the table you want as
a plain JSON **view spec**: what to group by, what to aggregate, and how to
format and style it. Pivoette computes the pivot client-side and renders it as
a virtualized table. Because the view is plain data, it can be saved, diffed,
edited interactively, or written by an LLM.

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

## Features

### Pivot and flat tables

Both kinds of table share a single vocabulary. `columns` always lists the
displayed columns, and a view is a pivot exactly when it groups (declares
`pivotRows` or `pivotColumns`) or aggregates (a column has an `agg`).
Otherwise it's a flat table with one output row per source row:

```ts
const flat: ViewSpec = {
  columns: [{ id: 'symbol' }, { id: 'price', label: 'Last' }, { id: 'volume' }],
  sort: [{ field: 'volume', direction: 'desc' }],
};
```

- **Multi-level axes.** Axes nest in array order, so
  `pivotRows: [{ field: 'team' }, { field: 'project' }]` puts projects inside
  teams. Header cells span their children on both axes.
- **Axis settings.** Each axis level carries its own `label`, `sort` and
  metadata. They travel with the field when it moves to the other axis.
- **Where the measures go.** With several measures, `columnAxis` decides
  whether the measure level goes on the innermost column level (the default) or
  on the rows.
- **Totals from the source rows.** `showSummary` adds a grand-total row that
  is computed from the source rows, not from the displayed cells, so the grand
  `mean` or `median` is correct even when groups differ in size. Extra footer
  rows (`display.footer`) summarize the displayed values instead.
- **Large tables.** Body rows are virtualized, so tables with thousands of rows
  stay responsive.

### Aggregations

`sum` · `count` · `countDistinct` · `min` · `max` · `mean` (`avg`) ·
`variance` · `std` · `median` · `p25` · `p50` · `p75` · `first` · `last`

Nulls are skipped, as in pandas. `summaryAgg` lets the total row use a
different aggregation than the cells. Add your own with
`registerAggregation(id, label, values => result)`, or give a column an inline
`expression` over the group's values.

### Data in

`DataTable` accepts an array of row objects, a `{ meta, rows }` document that
carries column metadata along with the rows, or a prebuilt `DataFrame`. Data
is stored column by column, and the type of each column (`int`, `float`,
`string`, `json`) is inferred.

```ts
import { fromCsv, fromRows } from 'pivoette';

const frame = fromCsv(text, { delimiter: ';', nullValues: ['n/a'] });
```

### Units and formatting

Describe what a column **is** instead of how to format it. Formats are
deduced from each column's metadata:

```ts
meta: {
  revenue: { kind: ['price'], unit: ['dollar'] },
  latency: { kind: ['duration'], unit: ['second'], scale: ['milli'] },
  throughput: { kind: ['memory', '1/duration'], unit: ['byte', '1/second'], scale: ['mebi', null] },
}
```

- **Compound units.** Units are lists of factors, so `m²`, `tok/s` and
  `MiB/s` all compose.
- **Locale-aware.** Currency placement and decimals follow the reader's
  locale through `Intl`: `$1,234.50` in `en-US`, `1.234,50 $` in `de-DE`.
- **Unit and scale placement.** A column's unit and scale can be shown in the
  header, next to every value, or not at all (`unitPlacement`,
  `scalePlacement`).
- **Formatting options.** `format: { options: { … } }` passes
  `Intl.NumberFormat` options on top of the deduced format.
- **Converting values.** `factor` converts stored values to displayed ones,
  and sorting and totals use the converted values too.

**Automatic scaling.** With `autoScale: true`, the data picks the magnitude, so
a column stored in nanoseconds shows as `4.34 µs` without the spec saying so.
The engine picks the scale from a registered list of steps (`si`, `duration`,
`bytes`, or your own through `registerLadder`), and only the display changes:
sorting and expressions still see the stored value. Columns that share a
`scalePool` choose one scale together, so a row can't end up half in `ns` and
half in `µs`.

### Derived fields and computed columns

**`derive`** adds fields to the data before grouping, so an axis can group by
them. Expressions can use temporal helpers (`year`, `quarter`, `month`, `day`,
`hour`, `isoWeek`, `weekday`, `dateOnly`, …), and timestamp columns arrive
already decoded:

```ts
derive: {
  weekday: { compute: 'weekday(committedAt)', meta: { kind: ['weekday'] } },
},
pivotColumns: [{ field: 'weekday' }],
```

Weekdays come out in the locale's calendar order, and a `timeZone` on the
view controls how timestamps are interpreted.

**Computed columns** compute a value from other columns in the same row:

```ts
{ id: 'pl', label: 'P/L', compute: 'price - basePrice', meta: { kind: ['price'], unit: ['dollar'] } }
```

**Computed members** add a member to a pivot level, calculated from that
level's other members. For example, a Δ beside `before` and `after`:

```ts
pivotColumns: [
  { field: 'platform' },
  {
    field: 'revision',
    computed: [{
      id: 'delta', label: 'Δ',
      inputs: { before: { member: 'before' }, after: { member: 'after' } },
      compute: '(after - before) / before',
      place: { after: 'after' },
    }],
  },
],
```

The Δ repeats once per platform and always reads its own platform's cells. If
`platform` moves to the rows, the Δ stays correct.

### Cell customization

Each column can go as far as it needs:

1. **`format`**: the text of the cell.
2. **`style`**: CSS merged onto the default cell. Built in: `signColors`,
   `conditional` and `static`.
3. **`render`**: a whole React component that takes over the cell. The
   built-in `imageText` renderer backs `composite` columns, which show several
   fields in one cell (such as an icon and a name) and sort by one of them.

Each hook can be a registered function referenced by name (`{ fnName,
options }`, which keeps the view serializable), an inline function or an
expression string. Every hook receives the same cell context: value, inputs,
row and column path, and the source frame. Register your own with
`registerFormat`, `registerStyle` and `registerRender`.

### Presentation

`display` options change how the table looks without changing its data: zebra
striping, a frameless look, spacing between column and row groups, tinted
index columns, click-to-sort headers, header highlighting on hover, and
light, dark or automatic theming.

### Interactive editing

Pass `editing` and own the view in state, and users can build the table in
place. Each list has a `+` on the grid, fields and columns can be dragged
between the axes, and headers have buttons that remove them:

```tsx
const [view, setView] = useState(initialView);
<DataTable data={rows} view={view} editing onViewChange={setView} />;
```

`ViewEditor` is an optional side panel that lists what is configured, where
items can be reordered, removed, or given a different aggregation. The same
operations (`addField`, `moveField`, `setColumnAgg`, …) are exported as
pure functions over a `ViewSpec`.

### Charts

Charts are built by nesting components rather than through a config object.
`GraphBox` works out the scales from the field names, and every mark inside it
reads them. Charts use the same metadata, units and automatic scaling as
tables, so a balance column declared in dollars gets a `Net worth ($k)` axis
without extra configuration.

```tsx
<GraphBox
  data={rows}
  x="month"
  y="balance"
  series="account"
  agg="sum"
  height={340}
>
  <Axis side="left" grid />
  <Axis side="bottom" />
  <LineSeries />
  <Legend />
</GraphBox>
```

`BarSeries`, `Scrubber` (a hover readout), point marks and labels are
included too. Custom marks can read `useGraph()` and `useDatum()`.

### Web component

For pages that don't use React, `pnpm build:element` produces
`dist-element/pivoette-element.js`. It's a single self-contained file that
defines `<pivoette-table>`:

```html
<script src="/static/pivoette-element.js" defer></script>
<pivoette-table src="/data/revenue.pivoette.json"></pivoette-table>
```

The element takes a **bundle**: one JSON document holding the data, the
column metadata and the view. It renders inside a shadow root, so page CSS and
table CSS stay separate. `validateBundle` reports every problem in a bundle at
once instead of rendering a blank box.

### Framework-agnostic engine

The data model and pivot engine (`fromRows`, `fromCsv`, `computeView`,
`loadBundle`, …) don't depend on React, so they can be used on their own. For
example, you can compute a pivot on a server or in a worker.

> [!WARNING]
> `compute`, `expression` and inline expression hooks are JavaScript evaluated
> with `new Function`. Only render view specs from sources you trust, or
> render them in a sandboxed iframe on a separate origin.

## Examples

[`demo/examples`](demo/examples) contains worked examples: a stock ticker,
kernel benchmarks, a before/after regression, AI token spend, fleet metrics,
commit history and a net-worth chart. Each example has a seeded `generate.py`
that regenerates its data. Run `pnpm dev` to browse them with each example's
source shown next to it.

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
