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
    "rows": ["region"],
    "columns": ["quarter"],
    "values": [{ "id": "rev", "field": "revenue", "agg": "sum" }]
  }
}
```

|        | Q1  | Q2  |
| ------ | --- | --- |
| **EU** | 120 | 150 |
| **US** | 340 | 310 |

That is the whole model: `rows` and `columns` name fields to **group by**,
`values` names fields to **aggregate**. Everything below is refinement.

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

## 3. `view` — pivot mode

```jsonc
{
  "rows": ["author"], // group down the page; [] for no row grouping
  "columns": ["weekday"], // group across the page; [] for no column grouping
  "values": [
    // at least one measure
    { "id": "added", "field": "linesAdded", "agg": "sum", "label": "Added" },
  ],
  "rowSort": [{ "field": "added", "direction": "desc" }],
  "columnSort": [{ "field": "weekday" }],
  "showSummary": true, // grand total row/column
  "locale": "de-DE", // defaults to the reader's
  "timeZone": "Europe/Berlin", // defaults to "auto"
}
```

Nesting is by array order: `"rows": ["team", "author"]` puts authors inside
teams.

### Aggregations (`agg`)

`sum` · `count` · `countDistinct` · `min` · `max` · `mean` (`avg`) · `variance` ·
`std` · `median` · `p25` · `p50` · `p75` · `first` · `last`

All but `count` and `countDistinct` need a **numeric** column.

### `values` entries

| Field        | Meaning                                                      |
| ------------ | ------------------------------------------------------------ |
| `id`         | Required, unique. Referenced by sorts and computed columns.  |
| `field`      | Required. The column to aggregate.                           |
| `agg`        | Required.                                                    |
| `label`      | Header text. Defaults to a name derived from the field.      |
| `factor`     | Multiply before formatting (see §5).                         |
| `summaryAgg` | Aggregation for the footer, if it should differ from `agg`.  |
| `format`     | `{ "options": { … } }` to tweak the deduced format (see §5). |

### Flat mode

For a plain table with no grouping, set `mode: "flat"` and list columns:

```json
{
  "mode": "flat",
  "columns": [
    { "id": "symbol" },
    { "id": "price", "label": "Last" },
    { "id": "volume" }
  ],
  "sort": [{ "field": "volume", "direction": "desc" }]
}
```

`source` defaults to `id`, so a plain projection is just `{ "id": "price" }`.

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
> _are_ megabytes. To convert, use `factor` (§5).

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
  "field": "rssBytes",
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
  "field": "errorRate",
  "agg": "mean",
  "factor": 100,
  "meta": { "kind": ["percentage"], "scale": ["percent"] }
}
```

`factor` is applied by the engine, so it holds for sorting and footers too.

---

## 6. `derive` — virtual columns

Computed before grouping, so `rows`/`columns` may name them. Each is a JS
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
    "rows": ["author"],
    "columns": ["weekday"],
    "values": [{ "id": "churn", "field": "churn", "agg": "sum" }]
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
| `indexColumns`     | `0`     | Flat mode: leading columns tinted as an index            |

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
    "rows": ["author"],
    "columns": ["weekday"],
    "values": [
      { "id": "added", "field": "linesAdded", "agg": "sum", "label": "+" },
      { "id": "removed", "field": "linesRemoved", "agg": "sum", "label": "−" }
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

1. **Every name in `rows`, `columns`, and `values[].field` is a real column** —
   spelled as it appears in the CSV header, or defined in `derive`.
2. **Aggregated fields are numeric.** If a column has any non-numeric value it
   is a string column, and only `count`/`countDistinct` will work on it.
3. **`values[].id` values are unique.**
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
