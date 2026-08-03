# Embedding Pivoette in another app

The goal: an agent writes a JSON bundle into a sandbox, the chat renders it as a
table, and the host app needs **one file and one script tag**.

## 1. Build the file

```sh
pnpm build:element
```

Produces `dist-element/pivoette-element.js` — 269 KB, 87 KB gzipped, and fully
self-contained:

- React and ReactDOM are bundled in (not `peerDependencies` here — the host page
  needs no React of its own, and any React it does have is untouched)
- every stylesheet is inlined as a string and adopted into a shadow root
- no `import` statements, no network fetches for assets

Copy that one file into the other project's static assets.

## 2. Add it to the chat page

```html
<script src="/static/pivoette-element.js" defer></script>
```

That is the whole integration. The script defines `<pivoette-table>` as a side
effect, so **markup inserted later upgrades on its own** — a chat message
arriving over a websocket ten minutes after page load renders with no extra
call, no `React.render`, and no script in the message itself.

## 3. What the agent emits

Either inline the bundle:

```html
<pivoette-table height="380">
  <script type="application/json">
    {
      "data": { "csv": "region,q,rev\nEU,Q1,120\n" },
      "view": {
        "rows": ["region"],
        "columns": ["q"],
        "values": [{ "id": "rev", "field": "rev", "agg": "sum" }]
      }
    }
  </script>
</pivoette-table>
```

…or point at a file the agent already wrote to the sandbox:

```html
<pivoette-table src="/sandbox/abc123/revenue.pivoette.json"></pivoette-table>
```

Relative `data.url` paths inside the bundle resolve against the bundle's own
URL, so an agent can write `revenue.pivoette.json` next to `revenue.csv` and
reference it as `"./revenue.csv"`.

Hand `agent_usage.md` to the agent as the format spec.

### Attributes

| Attribute | Effect                                                         |
| --------- | -------------------------------------------------------------- |
| `src`     | URL of a bundle JSON. Omit to use the inline `<script>` child. |
| `height`  | Overrides the bundle's `height`. Default `420`.                |
| `theme`   | `auto` (default), `light`, `dark`.                             |

All three are observed, so changing one re-renders. Concurrent loads are
token-guarded: a slow fetch can never overwrite a newer one.

## 4. What this buys you

**Style isolation, both ways.** The table lives in a shadow root with its
stylesheet adopted into it. Host CSS cannot reach in — a global
`table { border: 5px solid red }` in the chat's own stylesheet does not touch
it — and the table's CSS cannot leak out into the chat.

**Visible failures.** A generated bundle can be wrong. `validateBundle` runs
before render and reports _every_ problem at once, in the page:

> This table's spec has problems:
>
> - view.rows[0]: no column named "regoin". Available: region, quarter, revenue
> - view.values[0]: unknown agg "total". Available: sum, count, …

So a mistake shows up as a fixable list rather than a blank box — and the agent
can be shown that text to correct itself in one pass.

**Sane lifecycle.** Unmount is deferred by a microtask and re-checks
`isConnected`, so moving the element within the DOM (as virtualized chat lists
do) does not tear down and rebuild the table.

## ⚠️ Before you ship this: `compute` is code execution

`ViewSpec` supports `derive[].compute`, `values[].expression`, and
`compute`/`expression` on columns. These are **JavaScript expressions evaluated
with `new Function`** (`src/format/expression.ts`). That is what makes derived
columns and custom aggregations work.

In your setup, bundles are **authored by an LLM from data of unknown
provenance** and rendered **in your app's origin**. So an expression in a bundle
can read `document.cookie` and `localStorage`, and call your API as the logged-in
user. A prompt injection in a CSV the agent ingested is enough to get there — the
agent does not have to be malicious, just persuaded.

Three ways to close it, roughly in order of effort:

1. **Strict mode** — reject any bundle carrying `compute` / `expression` before
   rendering. Cheapest and safest; costs you derived columns (so no grouping by
   weekday, which is a real loss).
2. **Render in a sandboxed iframe** — `<iframe sandbox="allow-scripts">` from a
   _different_ origin, with the element inside it. Expressions still work but run
   with no access to your cookies, storage, or same-origin API. This is the
   option that keeps the feature and closes the hole.
3. **Expression allowlist** — parse rather than `new Function`, permitting only
   arithmetic and the temporal helpers. Most work, best UX.

Nothing here is decided yet, and the element as built does **option 0** — it
evaluates whatever the bundle says. Pick one before this reaches a page holding a
real session.
