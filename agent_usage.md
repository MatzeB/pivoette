# Writing a Pivoette table bundle

You are producing a **bundle**: one JSON document holding data, column metadata,
and a view. Dropping it into a page as `<pivoette-table>` renders a pivot table.

Everything is plain JSON. There is no code to write and nothing to import.

```html
<pivoette-table>
  <script type="application/json">
    { "data": {...}, "view": {...} }
  </script>
</pivoette-table>
```

Only two fields are required: `data` and `view`.

---

## 1. The shortest possible bundle

```json
{
  "data": {
    "csv": "region,quarter,revenue\nEU,Q1,120\nEU,Q2,150\nUS,Q1,340\nUS,Q2,310\n"
  },
  "view": {
    "pivotRows": [{ "field": "region" }],
    "pivotColumns": [{ "field": "quarter" }],
    "columns": [{ "id": "rev", "source": "revenue", "agg": "sum" }]
  }
}
```

|        | Q1  | Q2  |
| ------ | --- | --- |
| **EU** | 120 | 150 |
| **US** | 340 | 310 |

That is the whole model: `pivotRows` and `pivotColumns` name fields to
**group by**, and `columns` is what gets displayed — here, aggregated.
Everything below is refinement.

---

## 2. `data` — exactly one source

| Field        | Use                                                                 |
| ------------ | ------------------------------------------------------------------- |
| `csv`        | Inline CSV text. **Prefer this** — 3–5× smaller than `rows`.        |
| `rows`       | Inline array of row objects. Use for ragged or nested data.         |
| `url`        | Fetched at render time. Relative URLs resolve against the bundle's. |
| `format`     | `"csv"` or `"json"`, for `url` only. Inferred from the suffix.      |
| `csvOptions` | `delimiter`, `noHeader`, `nullValues`.                              |

Give **one** of `csv` / `rows` / `url`. More than one is an error.

```jsonc
{ "data": { "csv": "a,b\n1,2\n" } }
{ "data": { "rows": [{ "a": 1, "b": 2 }] } }
{ "data": { "url": "./sales.csv" } }
{ "data": { "url": "./sales.tsv", "format": "csv", "csvOptions": { "delimiter": "\t" } } }
```

**Types are decided per column, not per cell.** A CSV column becomes numeric
only if _every_ non-empty value in it parses as a finite number. One `"n/a"` in
a `quantity` column makes the whole column strings, and `sum` will then be
rejected. Use `csvOptions.nullValues` to say what a blank looks like:

```json
{
  "data": {
    "csv": "...",
    "csvOptions": { "nullValues": ["", "NA", "-", "null"] }
  }
}
```

Escaping for inline CSV: it is a JSON string, so newlines are `\n` and quotes
are `\"`. RFC 4180 quoting works — `"Smith, John"` is one field.

**Rule of thumb:** inline anything under ~5,000 rows. Beyond that, write the CSV
to a separate file and point `url` at it — the bundle stays readable and the
browser can cache the data separately.

---

## 3. `view` — columns, and the axes to pivot them over

There is one vocabulary for both kinds of table. `columns` is always the list of
displayed columns. `pivotRows` and `pivotColumns` are optional axes to group
them over.

```jsonc
{
  "pivotRows": [{ "field": "author" }], // group down the page
  "pivotColumns": [{ "field": "weekday", "sort": "asc" }], // group across
  "columns": [
    { "id": "added", "source": "linesAdded", "agg": "sum", "label": "Added" },
  ],
  "showSummary": true, // grand total row
  "locale": "de-DE", // defaults to the reader's
  "timeZone": "Europe/Berlin", // defaults to "auto"
}
```

**A view is a pivot if it groups or aggregates** — that is, if it declares
`pivotRows`/`pivotColumns`, or any column has an `agg`. Otherwise it is flat:
one output row per source row. There is no mode flag.

```json
{
  "columns": [
    { "id": "symbol" },
    { "id": "price", "label": "Last" },
    { "id": "volume" }
  ],
  "sort": [{ "field": "volume", "direction": "desc" }]
}
```

That is a flat table: no axes, no `agg`. `source` defaults to `id`, so a plain
projection is just `{ "id": "price" }`.

Nesting is by array order: `"pivotRows": [{"field": "team"}, {"field":
"author"}]` puts authors inside teams.

### Axis entries (`pivotRows` / `pivotColumns`)

| Field   | Meaning                                                           |
| ------- | ----------------------------------------------------------------- |
| `field` | Required. The column to group by.                                 |
| `label` | Header text for the level. Defaults to the field's `displayName`. |
| `sort`  | `"asc"` or `"desc"`. Priority is level order, outermost first.    |
| `meta`  | Metadata for this field, layered over the data's (see §4).        |

Without `sort`, a level keeps the order its members were first seen in.

### Aggregations (`agg`)

`sum` · `count` · `countDistinct` · `min` · `max` · `mean` (`avg`) · `variance` ·
`std` · `median` · `p25` · `p50` · `p75` · `first` · `last`

All but `count` and `countDistinct` need a **numeric** column.

### `columns` entries

Which of three keys a column sets is what the column _is_: `agg` makes it a
measure, `compute` makes it derived (§6), neither makes it a plain projection.
In a pivot every column needs one of the two — a bare projection means nothing
once rows have been collapsed into groups.

| Field        | Meaning                                                      |
| ------------ | ------------------------------------------------------------ |
| `id`         | Required, unique. Referenced by sorts and computed columns.  |
| `source`     | The field to read. Defaults to `id`.                         |
| `agg`        | Aggregate `source` over each group; makes this a measure.    |
| `label`      | Header text. Defaults to a name derived from the field.      |
| `factor`     | Multiply before formatting (see §5).                         |
| `summaryAgg` | Aggregation for the footer, if it should differ from `agg`.  |
| `format`     | `{ "options": { … } }` to tweak the deduced format (see §5). |

---

## 4. `meta` — describing the columns

`meta` describes **the data**, not the view: what a column means and what its
numbers are measured in. It is keyed by field name.

```json
{
  "meta": {
    "revenue": {
      "kind": ["price"],
      "unit": ["dollar"],
      "displayName": "Revenue"
    },
    "latency": { "kind": ["duration"], "unit": ["second"], "scale": ["milli"] },
    "committedAt": { "kind": ["timestamp"], "encoding": "rfc3339" }
  }
}
```

| Field         | Meaning                                                         |
| ------------- | --------------------------------------------------------------- |
| `displayName` | Header text. Defaults to the field name.                        |
| `kind`        | Semantic dimension — drives the deduced format.                 |
| `unit`        | The unit, e.g. `byte`, `second`, `dollar`.                      |
| `scale`       | Prefix, e.g. `milli`, `mega`, `mebi`, `percent`.                |
| `encoding`    | How a raw value encodes what it represents. Today: `"rfc3339"`. |

`kind` values: `name` `uid` `url` `timestamp` `date` `year` `month` `weekday`
`calendarWeek` `duration` `price` `count` `percentage` `memory` `length` `area`
`volume` `speed` `mass` `temperature` `intensity` `power` `energy` `frequency`
`longitude` `latitude`. Custom strings are fine — they just carry no deduction.

Units with known short forms: `second` `minute` `hour` `day` `meter` `gram`
`kilogram` `byte` `bit` `token` `request` `operation` `cycle` `watt` `joule`
`hertz` `kelvin` `celsius` `ampere` `volt` `candela` `mole` `pixel` `dollar`
`euro` `pound` `yen`. Anything else is used verbatim.

Scales: `femto` `pico` `nano` `micro` `milli` `centi` `deci` `kilo` `mega`
`giga` `tera` `peta`, the binary `kibi` `mebi` `gibi` `tebi` `pebi`, and
`percent`.

### Compound units

The unit fields are **parallel arrays**, one entry per factor. Repeating a
factor squares it; a `1/` prefix inverts it.

```jsonc
{ "kind": ["length", "length"], "unit": ["meter", "meter"] }        // m²
{ "kind": ["tokens", "1/duration"], "unit": ["token", "1/second"] } // tok/s
{ "kind": ["memory", "1/duration"], "unit": ["byte", "1/second"],
  "scale": ["mebi", null] }                                          // MiB/s
```

Use `null` for a factor that has no entry in that field. A single-factor unit
can be written as a bare string: `"unit": "byte"` means `["byte"]`.

> **Units are labels. They never transform a number.** Declaring
> `scale: ["mega"]` does not divide by a million — it says the values already
> _are_ megabytes. To convert, use `factor` (§5), or `autoScale` (§5) to have
> the scale chosen from the data.

### Currencies

Symbol placement and decimal count come from the reader's locale via `Intl`, so
`{ "kind": ["price"], "unit": ["dollar"] }` renders `$1,234.50` in `en-US` and
`1.234,50 $` in `de-DE`. Long names (`dollar`, `euro`, `yen`, `franc`, …), ISO
codes (`"CHF"`), and bare symbols (`"$"`) all work.

### Timestamps

Give a timestamp column an `encoding` so it can be decoded:

```json
{ "meta": { "committedAt": { "kind": ["timestamp"], "encoding": "rfc3339" } } }
```

Then group by parts of it using `derive` (§6).

---

## 5. Formatting

**Start by declaring the unit, not the format.** A format is deduced from
`kind`/`unit`/`scale`, and that is usually the right one.

To adjust it, pass options — this _merges into_ the deduced format rather than
replacing it:

```json
{
  "id": "mem",
  "source": "rssBytes",
  "agg": "max",
  "format": { "options": { "maximumFractionDigits": 0 } }
}
```

Options are `Intl.NumberFormat` options: `minimumFractionDigits`,
`maximumFractionDigits`, `useGrouping`, `notation`, and so on.

`factor` converts stored values to displayed ones. A ratio stored as `0.0523`
displayed as `5.2%`:

```json
{
  "id": "rate",
  "source": "errorRate",
  "agg": "mean",
  "factor": 100,
  "meta": { "kind": ["percentage"], "scale": ["percent"] }
}
```

`factor` is applied by the engine, so it holds for sorting and footers too.

### `autoScale` — let the data pick the scale

`factor` is a decision you make in advance. When the right scale depends on how
big the numbers turn out to be, `autoScale` reads it off the data instead:
nanoseconds display as `4.34 µs` without the spec saying so.

```json
{
  "meta": {
    "timeNs": { "kind": ["duration"], "unit": ["second"], "scale": ["nano"] }
  },
  "view": {
    "pivotRows": [{ "field": "app" }],
    "columns": [
      { "id": "mean", "source": "timeNs", "agg": "mean", "autoScale": true }
    ]
  }
}
```

The declared `scale` is the point it scales **from**, so a column must say what
its numbers already are. The chosen scale is ordinary metadata, which is what
makes it move with the unit placement (§7) like any other label.

| Spelling                                          | Meaning                                                                                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"autoScale": true`                               | Pick the ladder from `kind` — `duration`, `memory`, else `si`.                                                                                                  |
| `"autoScale": "si"`                               | Name the ladder: `si`, `duration`, or `bytes`.                                                                                                                  |
| `"autoScale": { "ladder": "si", "per": "value" }` | `per: "value"` lets each cell pick its own rung, the way `1.24 ms` and `117 ns` can sit in one column. Its label rides the value and cannot move to the header. |

Only the display changes: the stored value is untouched, so sorting, styles and
any expression over the value keep meaning what they did.

**`scalePool`** makes related columns choose together, so a row cannot end up
half in `ns` and half in `µs`:

```json
{
  "columns": [
    {
      "id": "mean",
      "source": "timeNs",
      "agg": "mean",
      "autoScale": true,
      "scalePool": "times"
    },
    {
      "id": "max",
      "source": "timeNs",
      "agg": "max",
      "autoScale": true,
      "scalePool": "times"
    }
  ]
}
```

It defaults to the column's own `id` — a pool of one — so leaving it off is what
gives each column its own scale.

A column can only scale along a unit with a known magnitude. A compound unit
(`tok/s`, `m²`) has none, and neither does an unregistered scale name — both are
still perfectly good _labels_, they just cannot be a starting point.

---

## 6. `derive` — virtual columns

Computed before grouping, so the pivot axes may name them. Each is a JS
expression over the source fields.

```json
{
  "view": {
    "derive": {
      "weekday": {
        "compute": "weekday(committedAt)",
        "meta": { "kind": ["weekday"] }
      },
      "month": {
        "compute": "month(committedAt)",
        "meta": { "kind": ["month"] }
      },
      "churn": { "compute": "linesAdded + linesRemoved" }
    },
    "pivotRows": [{ "field": "author" }],
    "pivotColumns": [{ "field": "weekday" }],
    "columns": [{ "id": "churn", "agg": "sum" }]
  }
}
```

Temporal helpers available in `compute`: `year`, `quarter`, `month`, `day`,
`hour`, `isoWeek`, `isoWeekday`, `weekday`, `dateOnly` (a YYYY-MM-DD string),
and `parseTime`. A column whose metadata declares a timestamp arrives already
decoded to epoch milliseconds. Weekdays come out as **locale ordinals** (0 = the
locale's first day), so they sort into calendar order with no sort spec.

Derives are evaluated in declaration order, so one may reference an earlier one.

---

## 7. `display` — presentation

All optional, all with sensible defaults.

| Field              | Default | Effect                                                   |
| ------------------ | ------- | -------------------------------------------------------- |
| `unitPlacement`    | `off`   | `header` \| `value` \| `off` — where the unit label goes |
| `scalePlacement`   | `off`   | Same, for the scale prefix                               |
| `footer`           | —       | `[{ "label": "Total", "agg": "sum" }]`                   |
| `zebra`            | `false` | Alternate row shading                                    |
| `sortable`         | `true`  | Click-to-sort headers                                    |
| `frameless`        | `false` | Spacing instead of inner borders                         |
| `hideRules`        | `false` | Drop the header rule and footer double line              |
| `groupSpacing`     | `0`     | Px gap at column-group boundaries                        |
| `rowGroupSpacing`  | `0`     | Px gap between row-index blocks                          |
| `indexGap`         | `0`     | Px gap between index columns and data                    |
| `highlightHeaders` | `true`  | Highlight the hovered cell's column header               |
| `indexColumns`     | `0`     | Flat view: leading columns tinted as an index            |

Top-level siblings of `display`: `title`, `height` (number of px or a CSS
length, default `420`), and `theme` (`"auto"` \| `"light"` \| `"dark"`).

---

## 8. A complete example

Commit activity by author and weekday:

```json
{
  "version": 1,
  "title": "Commit activity",
  "data": {
    "csv": "author,committedAt,linesAdded,linesRemoved\nada,2026-03-02T09:14:00Z,120,8\nada,2026-03-04T17:02:00Z,44,91\ngrace,2026-03-02T11:30:00Z,310,12\ngrace,2026-03-06T08:45:00Z,75,60\n"
  },
  "meta": {
    "committedAt": { "kind": ["timestamp"], "encoding": "rfc3339" },
    "author": { "kind": ["name"], "displayName": "Author" },
    "linesAdded": { "kind": ["count"], "unit": ["line"] },
    "linesRemoved": { "kind": ["count"], "unit": ["line"] }
  },
  "view": {
    "derive": {
      "weekday": {
        "compute": "weekday(committedAt)",
        "meta": { "kind": ["weekday"] }
      }
    },
    "pivotRows": [{ "field": "author", "sort": "asc" }],
    "pivotColumns": [{ "field": "weekday" }],
    "columns": [
      { "id": "added", "source": "linesAdded", "agg": "sum", "label": "+" },
      { "id": "removed", "source": "linesRemoved", "agg": "sum", "label": "−" }
    ],
    "showSummary": true
  },
  "display": {
    "footer": [{ "label": "Total", "agg": "sum" }],
    "zebra": true,
    "groupSpacing": 8
  },
  "height": 360
}
```

---

## 9. Before you emit a bundle

Check each of these — they are the mistakes that actually happen:

1. **Every `pivotRows`/`pivotColumns` `field` and every `columns[].source` is a
   real column** —
   spelled as it appears in the CSV header, or defined in `derive`.
2. **Aggregated fields are numeric.** If a column has any non-numeric value it
   is a string column, and only `count`/`countDistinct` will work on it.
3. **`columns[].id` values are unique.**
4. **`data` has exactly one of `csv` / `rows` / `url`.**
5. **You declared units instead of hand-writing formats.**
6. **Grouping fields have few distinct values.** Grouping by a near-unique
   column produces one row per record, which is not a pivot table. Group by
   category-like columns; aggregate the rest.

If you have the library available, `validateBundle(bundle, frame)` returns
_every_ problem at once rather than throwing on the first, so one pass fixes
them all. `describeFrame(frame)` reports each column's type, `category`
(`index` = groupable, `data` = aggregatable), distinct count, and sample values
— run it before writing the view if you are unsure what the data looks like.

At render time an invalid bundle displays its problem list in the page instead
of silently showing nothing, so a mistake is visible rather than mysterious.
