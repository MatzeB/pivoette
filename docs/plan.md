# Pivoette — In-Browser Pivot Table Editor

## Context

Greenfield project (empty dir `/Users/matze/dev/pivoette`, no git yet, Node 25 available, pnpm being
installed). Goal: a client-side, in-browser pivot-table / data-analysis component. A user loads tabular
data (JSON rows for now) and gets a live table driven by a **declarative configuration language** — the
serializable contract that a future interactive editor will manipulate. This first milestone delivers the
**columnar data model**, the **pivot engine** (with a **flat/detail mode** for non-aggregated tables), a
rich **display-column layer** (formatting, row-level computed columns, composite multi-field columns with
custom sort keys, conditional styling), a **virtualized read-only render**, and **worked examples** built
alongside. The **interactive config editor is designed-for but deferred** — v1 renders from a config object.
Underlying data-cell editing is out of scope.

Decisions locked with the user: **TypeScript**, **React**, **plain JS arrays per column**; config-driven
rendering first (interactive editor later); measures default to innermost column level; row-only
virtualization (≤ few hundred columns); no filtering (data pre-filtered upstream); grand-total summary
footer computed from source.

## Tech stack & tooling

- **Vite** in **library mode** (`build.lib`) + **React 19** + **TypeScript** (strict). Ships as an
  embeddable/publishable component; the engine (`data`/`pivot`/`format`) is framework-agnostic and usable
  standalone. `vite-plugin-dts` emits type declarations.
- **pnpm** package manager.
- **CSS Modules** for component structure/layout + inline `CSSProperties` for dynamic per-cell format/style
  output (zero runtime style deps).
- **ESLint** flat config + `typescript-eslint`; **Prettier**.
- **Vitest** for unit tests (engine/aggregations/formatting are pure and highly testable).
- **@tanstack/react-virtual** for **row** virtualization (columns assumed ≤ few hundred → rendered
  normally; engine runs on the main thread).
- **git** initialized with a Node `.gitignore`.
- Deferred editor only: **@dnd-kit/core** (not a v1 dependency).

`package.json`: `exports` map for the library entry; scripts `dev` (demo), `build` (lib), `preview`,
`lint`, `format`, `test`.

## Proposed structure

Library (`src/`) is the published surface; the demo app (`demo/`) is the dev harness hosting the four
examples — kept separate so example/demo code never leaks into the package build.

```
pivoette/
├── package.json (exports), vite.config.ts (lib mode + dts), tsconfig.json, eslint.config.js, .prettierrc, .gitignore
├── src/                                # ← the published library
│   ├── index.ts                        # public API: DataTable, computePivot, fromRows, registries, types
│   ├── data/
│   │   ├── types.ts                    # ColumnType, DataColumn, DataFrame
│   │   ├── frame.ts                    # DataFrame factory + columnByName lookup
│   │   └── import.ts                   # fromRows(rows: Record<string, unknown>[]) + type inference
│   ├── pivot/
│   │   ├── spec.ts                     # ViewSpec, AxisField, ColumnDef, CellRef, SortSpec, isFlat
│   │   ├── aggregations.ts             # aggregation registry
│   │   ├── result.ts                   # engine output: multi-level index trees, cells, summaryRow
│   │   └── engine.ts                   # computeView(frame, spec) -> result (pivot + flat + derived cols)
│   ├── format/
│   │   ├── context.ts                  # CellCtx type
│   │   ├── format.ts                   # format-function registry (number/currency/percent/duration)
│   │   ├── style.ts                    # style-function registry (signColors/conditional)
│   │   └── expression.ts               # compileExpression() — Function-based custom fns
│   └── components/
│       ├── DataTable.tsx               # virtualized render for both pivot & flat, headers, footer
│       └── DataTable.module.css        # scoped structural styles
└── demo/
    ├── index.html, main.tsx, App.tsx   # example switcher + <DataTable/>
    └── examples/<name>/                # per example: view.ts (ViewSpec) + generate.py (seeded) + data.json
                                        #   ticker, benchmark, regression, tokens
                                        #   regression also emits stress.json (~10k+ rows) for perf testing
```

## Data model (`data/`)

```ts
type ColumnType = 'int' | 'float' | 'string' | 'json'; // every column is nullable

interface DataColumn {
  name: string;
  type: ColumnType;
  values: Array<number | string | unknown | null>;
}
interface DataFrame {
  columns: DataColumn[];
  length: number;
  columnByName: Map<string, DataColumn>;
}
```

- `fromRows(rows)`: union all keys → columns; infer type per column (**int** if every non-null is an
  integer, **float** if any non-null is fractional, **json** for objects/arrays, else **string**); missing
  keys → `null`. Plain arrays keep null handling trivial; the `DataFrame` interface hides representation so
  a TypedArray/validity-bitmap backend can be swapped in later without touching the engine.

## View spec (`pivot/spec.ts`)

> The authoritative types live in `src/pivot/spec.ts`, which carries a doc comment per key.
> The sketch below is the shape and the reasoning; it is not kept in sync field-for-field.

```ts
interface AxisField {
  field: string;
  label?: string; // header text for this level
  sort?: 'asc' | 'desc'; // priority is level order, outermost first
  meta?: ColumnMetaInput; // layered over the data's
}

interface ViewSpec {
  pivotRows?: AxisField[];
  pivotColumns?: AxisField[];
  columns: ColumnDef[]; // every displayed column, in order
  columnAxis?: 'pivotRows' | 'pivotColumns'; // where the columns level sits; default pivotColumns
  sort?: SortSpec[]; // flat only: sort rows by column id
  showSummary?: boolean; // grand-total footer row
  emptyDisplay?: string; // placeholder for empty groups (default "")
}
```

`pivotRows`/`pivotColumns` are ordered field lists → multi-level (pandas-style) indexes. The columns that
aggregate form their own level, inserted per `columnAxis` (default: innermost column level; a UI toggle
moves it to rows). Filtering is intentionally out of scope (assume data is pre-filtered upstream).

**One vocabulary, not two.** There is no `mode` flag and no separate measure type: `columns` is always the
displayed columns, and a view is a pivot exactly when it groups or aggregates (see `isFlat`). What a column
_is_ follows from which key it sets — `agg` for a measure, `compute` for a derived column, neither for a
plain projection — so the flat and pivot arms of the spec collapsed into one.

**Display labels are decoupled from data field names**, and each label sits on the thing it names:
`AxisField.label` for an index level, `ColumnDef.label` for a displayed column (required for computed ones
like `Δ%`, which have no source field). Keeping them there rather than in a map keyed by field name is what
stops a label from naming a field that is not on the axis — and lets the label and sort travel with a field
when the editor pivots it to the other axis.

### Flat/detail mode & display columns (`pivot/spec.ts`, `display/`)

Not every table is aggregated — the stock-ticker example (below) is a **flat detail table**: one output row
per source row, no grouping. Flat is not a mode but the absence of one: a view with no axes and no `agg`.
It shares the entire downstream **display-column layer** with pivot output. A displayed column:

```ts
interface CellRef {
  colPath: string[];
  column: string;
} // address a pivot leaf: column-key path + column id

interface ColumnDef {
  id: string;
  label?: string;
  source?: string; // the data field this column reads; defaults to `id`
  agg?: string; // aggregate `source` over each group — this is what makes a measure
  compute?: string; // JS expr over named `inputs` (+ row context) -> value
  inputs?: Record<string, CellRef | string>; // alias -> cell ref (pivot) or column id (flat);
  //   flat mode defaults to sibling columns by id, so `inputs` is optional there
  format?: FormatSpec; // tier 1: text
  style?: StyleSpec; // tier 2: inline CSS
  render?: RenderSpec; // tier 3: full React cell (supersedes format/style default rendering)
  composite?: {
    // sugar over a Tier-3 `imageText` renderer: multiple fields in one cell
    fields: string[];
    sortKey: string; // field/expr used to SORT this column (e.g. the description)
  };
  place?: 'append' | { after: string }; // where a derived column lands in the leaf order
}
```

A column that belongs to a _pivot level_ rather than to the innermost columns level is a
`ComputedMember` on that `AxisField` instead — see "Computed members" below.

**Computed columns, unified.** A computed column runs `compute` over named `inputs`:

- **Flat mode** (ticker) — inputs default to sibling columns by id: win/loss `$` = `current - base`,
  win/loss `%` = `(current - base)/base`.
- **Pivot mode** (before/after) — inputs are explicit **cell references** addressing leaves across the
  column dimension: `inputs: { before: {colPath:['before'], column:'mean'}, after:{colPath:['after'],
column:'mean'} }`, `compute: '(after - before)/before'`. The engine evaluates these **after** base cells
  exist, appending them as extra leaf columns (`place`). They sit in the same `columns` list as the
  measures; `normalizeView` is what splits the two apart for the engine.
- **Computed members** — a Δ% sitting beside `before` and `after` is not an innermost column at all: it is
  an extra _member of the revision level_. It is declared there, as `AxisField.computed`, and its `inputs`
  name sibling members (`{ member: 'before' }`) rather than paths. How often it repeats is then read off the
  axis — once per distinct combination of the levels outside it — so one Δ% definition yields a Δ% inside
  _each_ platform group, and moving `platform` to `pivotRows` leaves a single correct Δ% rather than a
  dangling reference. `place: { after: 'after' }` positions it among the level's members. Omitting a ref's
  `column` reads whichever measure the cell sits under, so the one expression covers every measure.
  Supported on the innermost `pivotColumns` level: an outer level's synthetic member would have to produce
  a subtree, and a row level would have to synthesize rows.

## Scale ladders (`format/ladders.ts`)

Presenting a measured number takes three decisions: _which_ magnitude to show it in, _converting_ it, and
_labelling_ it. Conversion is `ColumnDef.factor`; labelling is `unit`/`scale` metadata through `unitLabels`.
Choosing had no home, so a formatter that needed one (the old `duration` built-in) did all three privately —
and its unit became characters inside a string that the placement toggles could not see or move.

A **ladder** does only the choosing: an ordered list of rungs, each a magnitude in the column's base unit
plus the `scale`/`unit` names that label it. `chooseStep` picks the rung that puts the column's median
absolute value in `[1, 1000)`; the caller converts with the rung's factor and labels from its metadata,
through the same path every other unit takes. Ladders are a registry (`si`, `duration`, `bytes` ship;
`registerLadder` adds more), because time is not an SI ladder — `s → min → h` is 60×/3600×, no prefix at all.

`SCALE_FACTOR` in `data/meta.ts` gives scale names their magnitudes. It is deliberately narrower than
`SCALE_SHORT`: a scale may be labelled without being measurable, so an unregistered name still renders in a
header and simply cannot auto-scale. Scales stay _names_ rather than numbers because a name carries the
symbol too, and magnitudes collide where symbols do not — `centi` and `percent` are both 1e-2.

Selection runs as one post-pass in `computeView`, since a scale is chosen from data and leaves are built
before any cell exists. Leaves are grouped by `scalePool ?? id` — "one scale per column" is a pool of one,
so there is no second code path — and only `leaf.format` is rewrapped: `Cell.value` stays in stored units,
so sorting, styles and derived expressions keep meaning what they did.

## Aggregations (`pivot/aggregations.ts`)

Registry of `{ id, label, reduce(values, type) }` where each reducer applies its own null policy (skipna by
default, matching pandas). Ship: **sum, count, countDistinct, min, max, mean** (with `avg` alias),
**median, std, variance, first, last, percentile (p25/p50/p75)**. Note `avg`≡`mean`. A `ColumnDef.expression`
selects a **custom** aggregation: `compileExpression` builds a `Function` receiving the group's value array.

## Engine (`pivot/engine.ts`)

`computeView(frame, spec)` dispatches on `spec.mode`: **flat** projects one output row per source row through
the display-column layer (no grouping); **pivot** runs the algorithm below. Both share downstream computed
columns, formatting, and styling.

`computePivot(frame, spec): PivotResult`:

1. For each row, compute a row-key tuple (from `spec.rows`) and column-key tuple (from `spec.columns`);
   group source row indices by (serialized rowKey → colKey).
2. Collect distinct row/column keys; build ordered multi-level index trees, honoring each `AxisField.sort`
   (else first-seen order). Insert the **measures level** into the row or column index per
   `columnAxis` (default innermost column level), producing the final leaf-column order.
3. For each (rowKey × colKey × measure) run the aggregation over the source column's grouped values.
   Empty groups render as `spec.emptyDisplay`.
4. **Summary footer** (when `showSummary`): compute a totals row **from source**, not from displayed
   cells — mechanically a `pivotRows: []` pivot over the same columns, so grand-total `mean`/`median`/
   `countDistinct`/`std` are correct (each cell uses `valueSpec.summaryAgg ?? valueSpec.agg`).
5. Emit `PivotResult` = `{ rowIndex, columnIndex, rows: [{ path, cells }], summaryRow? }` with header trees
   carrying span info for rowspan/colspan rendering.

## Formatting & styling (`format/`)

Both formatting and styling are **pluggable functions**, not fixed enums. A column's `format` and `style`
each resolve to a function; the built-ins (currency, percent, `duration`, red/green `signColors`) are simply
**registered examples** of these function types, and users can supply arbitrary ones. All three cell hooks
receive the same rich, typed **`CellCtx`**:

```ts
interface CellCtx {
  value: unknown; // this cell's value
  inputs: Record<string, unknown>; // resolved compute inputs (sibling ids / cell-ref aliases)
  rowPath: unknown[]; // this row's index path (multi-level)
  colPath: unknown[]; // this column's key path (multi-level)
  column: ResolvedColumn; // the column def + resolved label/format/style
  frame: DataFrame; // escape hatch to the source data
}
```

### Three tiers of cell customization (progressive, opt-in per column)

Escalate only as far as you need — each tier is a one-liner in the config:

```ts
type FormatFn = (ctx: CellCtx) => string; // 1. text content
type StyleFn = (ctx: CellCtx) => React.CSSProperties; // 2. inline CSS on the default cell
type CellRender = (ctx: CellCtx) => React.ReactNode; // 3. full React component — owns the whole cell

// each spec: built-in by name (+options) | inline fn | inline expression string
type FormatSpec =
  | { name: string; options?: object }
  | { fn: FormatFn }
  | { expression: string };
type StyleSpec =
  { name: string; options?: object } | { fn: StyleFn } | { expression: string };
type RenderSpec =
  | { name: string; options?: object }
  | { fn: CellRender }
  | { expression: string };
```

- **Tier 1 — text (`format`).** Return the display string. Default rendering wraps it in a styled `<td>`.
- **Tier 2 — style (`style`).** Return `CSSProperties` merged onto the default cell (colors, align, weight).
- **Tier 3 — component (`render`).** Return arbitrary React — takes over the entire cell (image + text,
  sparkline, badge, link…). When present it supersedes `format`/`style` default rendering (the renderer may
  still call the format/style helpers from `ctx` if it wants). The **composite** "asset" column is just a
  built-in Tier-3 renderer (`imageText`), so `composite` becomes sugar over `render`.

### Registries

- **Format built-ins:** `number`/`integer`/`currency`/`percent` (memoized **`Intl.NumberFormat`** —
  `currency` → `$`, `signDisplay:'exceptZero'` → explicit `+`, `compact` → K/M/B), and **`duration`** (SI-time:
  base unit default **ns**, auto-scales ns…h, 3 sig figs, right-aligned, `prefix` for `± `; 60-based `m`/`h`
  make it a small dedicated fn, not pure `Intl`).
- **Style built-ins:** `signColors` (red/green by sign), `conditional` (`when` expr → CSS), static
  alignment/weight. Numeric columns right-align by default.
- **Render built-ins:** `imageText` (the composite asset cell); more can be registered.
- Inline `fn`/`expression` variants use `expression.ts`: `compileExpression(src)` = memoized
  `new Function(...)` in try/catch. Local, trusted data → `Function` is acceptable; documented as a trust
  boundary. Built-ins are the encouraged path; raw functions/components are the escape hatch.

## Components (`components/`)

- **DataTable.tsx** — the single render surface for both modes. Takes the engine output + resolved
  `ColumnDef[]`; sticky multi-level headers (rowspan/colspan) for pivot, flat headers for detail; virtualizes
  body rows via `@tanstack/react-virtual` (columns rendered normally); renders the `summaryRow` as a sticky
  footer. Per cell, applies the three tiers: `render` (full component) if present, else `format` text styled
  by `style`.
- **App.tsx** — loads a sample dataset, holds a `ViewSpec` config in state, `useMemo` over the engine on
  change, renders the table. A small dataset/example switcher drives the worked examples.
- **Interactive config editor — deferred.** v1 renders from a `ViewSpec` object (hand-written / example
  configs). The editor (field zones, add/remove aggs, drag-and-drop via `@dnd-kit`) is designed-for by making
  `ViewSpec` fully serializable, and built in a later milestone.

## Examples (`demo/examples/`) — built alongside the component

Each example is a `{ data.json, view.ts (ViewSpec) }` pair, exercised in the demo app and referenced by
tests. They double as living documentation of the configuration language.

**Producing the datasets is an explicit work item.** For each example, a small seeded **Python generator**
(`demo/examples/<name>/generate.py`, committed alongside its checked-in `data.json`) makes the data realistic
and regenerable. Python here is a **dev-time-only tool** (standard library + seeded RNG for determinism) — it
is _not_ a library/demo runtime dependency; the shipped package and demo stay pure TS. Requirements per set:
plausible labels/values; **each showcase table renders ~50–100 output rows** (fills 1–2 screens) — for the
pivots, size the source data so the _grouped_ result lands in that range; **multiple samples per (group)
cell** where aggregation matters — the benchmark set needs several timings per (benchmark, dataSize, arch) so
min/max/mean/variance differ, and the before/after set needs samples per (app, platform, revision) so Δ% is
meaningful. Ticker/token sets get 50–100 rows with varied signs and magnitudes (to exercise sign coloring and
compact K/M/B). Keep files small (committed JSON), deterministic (seeded RNG), and include a couple of
`null`s to exercise skipna handling.

**Stress fixture (themed).** 50–100 rows won't stress **row virtualization** (that engages at thousands), so
the **before/after** generator emits _two_ outputs: the small `data.json` showcase **and** a large
`stress.json` (~10k+ rows — many synthetic applications) used by a virtualization smoke test and an optional
demo toggle. This exercises the perf path with on-theme data instead of a throwaway dataset.

**1. Stock ticker (flat).** One row per symbol; no axes and no `agg`. Columns:

- `asset` — **composite**: small preview image (URL) + text description in one cell; **sorts by the
  description text** (`composite.sortKey`).
- `price` — current price; `currency` USD, 2 decimals, right-aligned.
- `basePrice` — currency USD, 2 decimals, right-aligned.
- `plChange` — **computed** `price - basePrice`; currency, `signDisplay:'exceptZero'` (explicit `+`),
  `signColors` red/green.
- `plPercent` — **computed** `(price - basePrice) / basePrice`; `percent`, `signDisplay:'exceptZero'`,
  `signColors` red/green.

This one example validates flat mode, composite columns with a distinct sort key, computed columns, currency
/ percent / sign formatting, and conditional sign coloring.

**2. Kernel benchmark (aggregated pivot).** Source rows are individual samples
`{ benchmark, dataSize, architecture, timeNs }` (many per cell). Config:

- `rows: ['benchmark']`.
- `columns: ['dataSize', 'architecture']` — level 1 `tiny|small|medium|large`, level 2 `x86|AArch64`.
- `columns: [mean, min, max, variance]` of `timeNs` → the innermost (3rd) column level via default
  `columnAxis`. Header tree ≈ 4 × 2 × 4 leaf columns.
- **mean/min/max** formatted with the **`duration`** built-in (ns…h, 3 sig figs, right-aligned). The
  **variance** column is deliberately _not_ time-scaled (variance is in ns², not a duration) — it uses a
  plain `number` format with `prefix: '± '`. `showSummary` off (a grand-total across benchmarks isn't
  meaningful here).

This example validates multi-level column indexes, four simultaneous measures, the measures-innermost
placement, and the `duration` formatter — complementing the flat ticker (example 1).

**3. Before/after regression (pivot + derived columns).** Source rows
`{ app, platform, revision, timeNs }` where `platform ∈ {Intel, AMD, GPU}`, `revision ∈ {before, after}`.
Config:

- `pivotRows: [{ field: 'app', label: 'Application' }]` — showing the header text differs from the data
  field name. (The `Δ%` computed column likewise carries an arbitrary `label`, since it has no source field.)
- `columns: ['platform', 'revision']` — level 1 `Intel|AMD|GPU`, level 2 `before|after`.
- `columns: [mean]` of `timeNs` (base metric), `duration`-formatted.
- on the `revision` level: `computed: [{ id:'delta', label:'Δ%',
 inputs:{ before:{member:'before'}, after:{member:'after'} },
 compute:'(after - before)/before', place:{ after:'after' },
 format:{ name:'percent', options:{ signDisplay:'exceptZero' } },
 style:{ name:'signColors', options:{ negative:'green', positive:'red' } } }]` — so each platform group
  shows **before · after · Δ%**, with Δ% referencing that platform's own cells.

Note the **domain-inverted coloring**: for benchmark _time_, a negative delta (faster) is green and a
positive delta (regression) is red — the opposite of the ticker's P/L — demonstrating why style is a
pluggable function. This example validates cross-column cell references, per-group repeated derived columns,
and relative column addressing.

**4. AI token spend (multi-level rows).** The row-axis counterpart to example 2 — deep nested rows instead
of deep columns. Source rows `{ team, project, model, inputTokens, outputTokens, cachedTokens, costUsd }`,
one per usage record. Config:

- `rows: ['team', 'project', 'model']` → **3-level nested row index**; `team`/`project` cells span their
  children (rowspan), each `AxisField` carrying its own `label`.
- `columns: []` → no column grouping, so the measures themselves become the columns.
- `columns: [sum(inputTokens) 'Input', sum(outputTokens) 'Output', sum(cachedTokens) 'Cached',
sum(costUsd) 'Price']` — token sums use `number` with `compact` (K/M/B), right-aligned; Price uses
  `currency` USD.
- `computed: [{ id:'total', label:'Total', compute:'input + output + cached',
 inputs:{ input:'Input', output:'Output', cached:'Cached' }, place:{ after:'Cached' },
 format:{ name:'number', options:{ compact:true } } }]` — a sibling computed total-tokens column.
- `showSummary: true` → a **meaningful grand-total footer** (all sums additive, so the footer equals the
  column totals — the correct/simple case, complementing example 2's non-additive caveat).

This is the anchor for **multi-level rows**: rowspan header rendering, per-level sort, and the natural
future home for inline per-level subtotals (per team / per project). It also re-uses compact-number and
currency formatting and shows every row level carrying its own label.

## Verification

- **Unit (`pnpm test`)**: deterministic Vitest suites for `import` (type inference, nulls), each
  aggregation (incl. null policy, median/percentile/distinct), and `computePivot` (single- and multi-level
  axes, multiple measures, measure placement columns↔rows, sorting) against a small fixed fixture with
  hand-computed expected values. Include a **summary-footer correctness** test proving grand-total `mean` is
  computed from source (≠ mean-of-group-means) for unequal group sizes.
  Add tests for **computed columns** (`plChange`/`plPercent`), **composite sort** (asset column
  orders by description, not image URL), the **`duration` formatter** (boundary scaling: e.g. 999 ns →
  `999 ns`, 1_000 ns → `1.00 µs`, 1_500_000 ns → `1.50 ms`, 90e9 ns → `1.50 m`; 3-sig-fig rounding; `± `
  prefix), **per-group derived columns** (Δ% appears once per platform, each referencing that platform's
  own before/after via relative `colPath`), and **multi-level rows** (3-level nested index: correct rowspan
  grouping, per-level sort, and additive summary footer equal to column totals).
- **Manual (`pnpm dev`)**: switch to the **stock-ticker** example → confirm composite asset cells, right-
  aligned currency, red/green `+`/`−` P/L. Switch to the **kernel-benchmark** example → confirm the 3-level
  column header (dataSize → architecture → mean/min/max/±variance), duration-formatted mean/min/max cells,
  and the plain-number `± ` variance column. Switch to the **before/after regression** example → confirm each
  platform group (Intel/AMD/GPU) shows before · after · Δ%, with green for faster / red for regressions.
  Switch to the **AI token spend** example → confirm 3-level nested rows with rowspan grouping, compact
  K/M/B token counts, currency Price, a computed Total column, and the grand-total footer.
- **Lint/format**: `pnpm lint` and `pnpm format` clean.

## Out of scope (this milestone)

**Interactive config editor** (v1 renders from a serializable `ViewSpec`; editor is a later milestone);
underlying data-cell editing; filtering UI (assume pre-filtered data); CSV/Parquet/Arrow import (JSON rows
only); custom JS sort-key expressions; **inline per-level subtotals** (only the grand-total footer ships
now — same source-recompute mechanism extends to subtotals later); column virtualization + Web-Worker engine
offload; persistence/sharing of pivot configs; TypedArray/Arrow columnar backend (interface leaves room for
all of these).
