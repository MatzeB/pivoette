/**
 * A panel showing a `ViewSpec`'s lists directly: the two pivot axes, the
 * displayed columns, and the footer aggregations.
 *
 * Every list can be added to from here too, through the menu under it; the
 * table's own `+` is the other way in for row fields. Offering fields needs
 * `frame` — without it only the view's derived fields, which the view itself
 * names, can be offered. All of it is presentation over `ops.ts`, which is
 * where the behaviour is tested.
 */
import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { aggregationIds } from '../pivot/aggregations';
import { isFlat } from '../pivot/spec';
import type { AxisField, ViewSpec } from '../pivot/spec';
import type { DataTableDisplay } from '../components/DataTable';
import type { CellValue, DataColumn, DataFrame } from '../data/types';
import { computeView, fieldMembers } from '../pivot/engine';
import {
  CHART_COLORS,
  CHART_MARKS,
  PATH_SEPARATOR,
  markOf,
} from '../graph/pivot-chart';
import type { ChartColors, ChartMark } from '../graph/pivot-chart';
import { isTimestamp } from '../data/temporal';
import { Format } from '../format/builtins';
import {
  addColumn,
  addField,
  addFooterRow,
  applyDrop,
  moveBar,
  removeColumn,
  removeField,
  removeFilter,
  removeFooterRow,
  setChart,
  setColumnAgg,
  setExcluded,
  setMark,
  setShowAs,
  setShowSummary,
  toFlat,
  toPivot,
} from './ops';
import type { DragRef, FieldZone, RemovalRef } from './ops';
import styles from './ViewEditor.module.css';

export interface ViewEditorProps {
  view: ViewSpec;
  onViewChange: (next: ViewSpec) => void;
  display?: DataTableDisplay;
  onDisplayChange?: (next: DataTableDisplay) => void;
  /** Supplies display names; falls back to raw field names without it. */
  frame?: DataFrame;
  /**
   * Palette, matching `DataTable`'s own prop. The panel renders outside the
   * table, so it cannot inherit the table's — pass the same value to both.
   */
  theme?: 'auto' | 'light' | 'dark';
  className?: string;
  /**
   * Show a Reset button, which calls this. The panel does not know what the
   * view started as — the host does, so the host restores it.
   */
  onReset?: () => void;
  /** Whether there is anything to reset; the button is disabled if not. */
  canReset?: boolean;
  /**
   * Called with what a remove button would take while it is hovered or
   * focused, and with `null` once it is not. Pass it on to the table's
   * `removing` prop and the table shows it in red, as its own controls do.
   */
  onRemovePreview?: (ref: RemovalRef | null) => void;
  /**
   * The same, for an entry merely pointed at: called with it while the
   * pointer is over its row, and with `null` once it is not. Pass it on to
   * the table's `locating` prop and the table shows where that entry is, in
   * blue — which column a measure is, which index level a row field.
   */
  onLocatePreview?: (ref: RemovalRef | null) => void;
}

function ResetButton({
  onReset,
  enabled,
}: {
  onReset: () => void;
  enabled: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.reset}
      disabled={!enabled}
      title="Restore the view as it was loaded"
      onClick={onReset}
    >
      Reset
    </button>
  );
}

function Row({
  label,
  onRemove,
  onPreview,
  onLocate,
  drag,
  over,
  children,
}: {
  label: string;
  onRemove?: () => void;
  /** The remove button is pointed at (true), or no longer is (false). */
  onPreview?: (on: boolean) => void;
  /** The row itself is pointed at (true), or no longer is (false). */
  onLocate?: (on: boolean) => void;
  /** Absent for a list that cannot be reordered. */
  drag?: React.HTMLAttributes<HTMLLIElement> & { draggable: true };
  over?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li
      className={`${styles.row} ${drag ? styles.draggable : ''} ${
        over ? styles.over : ''
      }`}
      {...drag}
      onMouseEnter={() => onLocate?.(true)}
      onMouseLeave={() => onLocate?.(false)}
    >
      <span className={styles.label} title={label}>
        {label}
      </span>
      {children}
      {onRemove && (
        <button
          type="button"
          className={styles.remove}
          title="Remove"
          onMouseEnter={() => onPreview?.(true)}
          onMouseLeave={() => onPreview?.(false)}
          onFocus={() => onPreview?.(true)}
          onBlur={() => onPreview?.(false)}
          onClick={() => {
            // The row goes with the click, and takes its mouseleave with it.
            onPreview?.(false);
            onLocate?.(false);
            onRemove();
          }}
        >
          ×
        </button>
      )}
    </li>
  );
}

function Section({
  title,
  empty,
  emptyText,
  drop,
  over,
  children,
  after,
}: {
  title: string;
  empty: boolean;
  /** What an empty list says, when the default does not fit. */
  emptyText?: string;
  /**
   * Drop handlers for the list as a whole, landing past its last entry. The
   * rows only accept a drop *at* their own index, which leaves the end of a
   * list unreachable — and an empty list, having no rows at all, unreachable
   * entirely. This is the target for both.
   */
  drop?: React.HTMLAttributes<HTMLElement>;
  over?: boolean;
  children?: ReactNode;
  /** Under the list, empty or not: the section's own add control. */
  after?: ReactNode;
}) {
  return (
    <section
      className={`${styles.section} ${over ? styles.overSection : ''}`}
      {...drop}
    >
      <h4 className={styles.heading}>{title}</h4>
      {empty ? (
        <p className={styles.empty}>
          {emptyText ??
            (drop ? 'none — drop one here, or use the + in the table' : 'none')}
        </p>
      ) : (
        <ul className={styles.list}>{children}</ul>
      )}
      {after}
    </section>
  );
}

interface Choice {
  value: string;
  label: string;
}

/**
 * The menu under a list that adds to it. Always showing its prompt — picking
 * acts at once and the menu snaps back, so it is a command, not a setting.
 * The usual choices come first; `more` folds the rest into a group of their
 * own. Nothing to offer, no menu.
 */
function AddMenu({
  title,
  prompt,
  first,
  more = [],
  onPick,
}: {
  title: string;
  prompt: string;
  first: Choice[];
  more?: Choice[];
  onPick: (value: string) => void;
}) {
  if (first.length + more.length === 0) return null;
  const options = (choices: Choice[]) =>
    choices.map((c) => (
      <option key={c.value} value={c.value}>
        {c.label}
      </option>
    ));
  return (
    <select
      className={styles.add}
      value=""
      title={title}
      onChange={(e) => onPick(e.target.value)}
    >
      <option value="" disabled>
        {prompt}
      </option>
      {options(first)}
      {more.length > 0 && <optgroup label="More">{options(more)}</optgroup>}
    </select>
  );
}

/** What each way of drawing a measure is called in the menu. */
const MARK_LABELS: Record<ChartMark, string> = {
  bar: 'Bar',
  range: 'Range',
  dot: 'Dot',
  none: 'Readout only',
};

/** What each colour scheme is called in the menu. */
const COLOR_LABELS: Record<ChartColors, string> = {
  series: 'a colour per bar',
  shades: 'shades of one colour',
  nested: 'colour by first field, shade by second',
};

/** A labelled on/off setting, as one row of a list. */
function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <li className={styles.row}>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
    </li>
  );
}

/** Most members a filter lists; a field with more is a search problem. */
const MEMBER_LIMIT = 200;

/** A member's identity, matching how the engine groups and filters. */
const memberKey = (value: CellValue | undefined) =>
  JSON.stringify(value ?? null);

/**
 * One filtered field: a disclosure reading "all" or "2 hidden", which opens
 * onto a checkbox per member. The members are listed from the whole dataset,
 * not the filtered one — an unchecked member has to stay on the list to be
 * checked again — and only once opened, since listing them means preparing
 * the frame.
 */
function FilterEntry({
  field,
  label,
  view,
  frame,
  onExclude,
  onClear,
}: {
  field: string;
  label: string;
  view: ViewSpec;
  frame: DataFrame;
  onExclude: (values: CellValue[]) => void;
  /** Present while the field has a filter at all: drops it. */
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const excluded = view.filter?.[field]?.exclude ?? [];
  const out = new Set(excluded.map(memberKey));
  const members = useMemo(
    () => (open ? fieldMembers(frame, view, field) : []),
    [open, frame, view, field],
  );
  // Known once the list is open; until then the count of hidden members is
  // what the summary can say.
  const none =
    members.length > 0 && members.every((m) => out.has(memberKey(m.value)));

  function toggle(value: CellValue, on: boolean) {
    const key = memberKey(value);
    onExclude(
      on ? [...excluded, value] : excluded.filter((v) => memberKey(v) !== key),
    );
  }

  return (
    <li className={styles.filter}>
      <details
        className={styles.filterBody}
        open={open}
        onToggle={(e) => setOpen(e.currentTarget.open)}
      >
        <summary className={styles.filterSummary}>
          <span className={styles.label} title={label}>
            {label}
          </span>
          <span className={styles.filterStatus}>
            {none
              ? 'none'
              : excluded.length > 0
                ? `${excluded.length} hidden`
                : 'all'}
          </span>
        </summary>
        {open && (
          <>
            <ul className={styles.members}>
              {members.slice(0, MEMBER_LIMIT).map((m) => {
                const on = !out.has(memberKey(m.value));
                return (
                  <li key={memberKey(m.value)}>
                    <label className={styles.member}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(m.value, on)}
                      />
                      <span className={styles.label}>
                        {m.label === '' ? '(empty)' : m.label}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {members.length > MEMBER_LIMIT && (
              <p className={styles.empty}>
                the first {MEMBER_LIMIT} of {members.length}
              </p>
            )}
            {excluded.length > 0 && (
              <button
                type="button"
                className={styles.showAll}
                onClick={() => onExclude([])}
              >
                show all
              </button>
            )}
          </>
        )}
      </details>
      {onClear && (
        <button
          type="button"
          className={styles.remove}
          title="Remove the filter"
          onClick={onClear}
        >
          ×
        </button>
      )}
    </li>
  );
}

/**
 * What a new measure over `column` starts out aggregating by: a sum where
 * there are numbers to add, the latest of a set of instants, and a count of
 * anything else — the one aggregation every column supports. The panel's
 * own select changes it afterwards.
 */
function defaultAgg(column: DataColumn | undefined): string {
  if (!column) return 'count';
  if (isTimestamp(column.meta)) return 'max';
  return column.type === 'int' || column.type === 'float' ? 'sum' : 'count';
}

/**
 * The add menu's entry for the grand total. Parenthesized, so it cannot be
 * mistaken for an aggregation id.
 */
const GRAND_TOTAL = '(total)';

/**
 * What a footer row is usually for, offered first; every other registered
 * aggregation follows under "More". `mean` is the average.
 */
const COMMON_TOTALS = ['sum', 'mean', 'median', 'min', 'max'];

export function ViewEditor({
  view,
  onViewChange,
  display,
  onDisplayChange,
  frame,
  theme = 'auto',
  className,
  onReset,
  canReset = true,
  onRemovePreview,
  onLocatePreview,
}: ViewEditorProps) {
  const dragged = useRef<DragRef | null>(null);
  const [over, setOver] = useState<DragRef | null>(null);
  // `auto` is the absence of the attribute: the palette's media query decides.
  const paletteFor = theme === 'auto' ? undefined : theme;

  /** Report `ref` to the host while its remove button is pointed at. */
  const preview = (ref: RemovalRef) =>
    onRemovePreview && ((on: boolean) => onRemovePreview(on ? ref : null));
  const locate = (ref: RemovalRef) =>
    onLocatePreview && ((on: boolean) => onLocatePreview(on ? ref : null));

  const name = (field: string) =>
    frame?.columnByName.get(field)?.meta.displayName ?? field;
  /** Same precedence the engine gives an axis level's header. */
  const axisName = (a: AxisField) => a.label ?? name(a.field);

  function drop(to: DragRef) {
    const from = dragged.current;
    dragged.current = null;
    setOver(null);
    if (from) {
      applyDrop(from, to, {
        view,
        display: display ?? {},
        onViewChange,
        onDisplayChange,
      });
    }
  }

  /** Accepting a drop at `ref`. Shared by the rows and their section. */
  function dropProps(ref: DragRef) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!dragged.current) return;
        e.preventDefault();
        // A row sits inside its section, which also accepts drops. Without
        // this the section would answer for every row and the only reachable
        // position would be the end of the list.
        e.stopPropagation();
        setOver(ref);
      },
      onDragLeave: () => setOver(null),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        drop(ref);
      },
    };
  }

  /** Handlers for one draggable entry. */
  function dragProps(ref: DragRef) {
    return {
      draggable: true as const,
      onDragStart: (e: React.DragEvent) => {
        dragged.current = ref;
        e.dataTransfer.effectAllowed = 'move';
        // Firefox will not start a drag without data on the transfer.
        e.dataTransfer.setData('text/plain', `${ref.zone}:${ref.index}`);
      },
      ...dropProps(ref),
      onDragEnd: () => {
        dragged.current = null;
        setOver(null);
      },
    };
  }

  const isOver = (ref: DragRef) =>
    over?.zone === ref.zone && over.index === ref.index;

  /** The whole list as a target: one past the end, so a drop appends. */
  const appendTo = (zone: DragRef['zone'], count: number) => ({
    drop: dropProps({ zone, index: count } as DragRef),
    over: isOver({ zone, index: count } as DragRef),
  });

  /**
   * Fields that can still go on an axis: the groupable columns — the split
   * the table's own `+` offers — and every derived field, which exists to be
   * grouped by. One field sits on at most one axis. A raw timestamp is left
   * out: nearly every instant is its own group. It is offered as a column
   * instead, and a derived field is how to group by one.
   */
  const placed = new Set(
    [...(view.pivotRows ?? []), ...(view.pivotColumns ?? [])].map(
      (a) => a.field,
    ),
  );
  const groupable: Choice[] = [
    ...(frame?.columns ?? [])
      .filter((c) => c.meta.category === 'index' && !isTimestamp(c.meta))
      .map((c) => c.name),
    ...Object.keys(view.derive ?? {}),
  ]
    .filter((field) => !placed.has(field))
    .map((field) => ({ value: field, label: name(field) }));

  /**
   * The fields a filter is shown for: every field on an axis — the members a
   * reader most often wants to drop are the ones they can see — and any other
   * field already filtered on, so no filter is ever in force out of sight.
   */
  const axisFields = [...(view.pivotRows ?? []), ...(view.pivotColumns ?? [])];
  const filterFields = [
    ...new Set([
      ...axisFields.map((a) => a.field),
      ...Object.keys(view.filter ?? {}),
    ]),
  ];
  /** The rest of the groupable fields, for filtering on one not shown. */
  const filterable: Choice[] = [
    ...(frame?.columns ?? [])
      .filter((c) => c.meta.category === 'index' && !isTimestamp(c.meta))
      .map((c) => c.name),
    ...Object.keys(view.derive ?? {}),
  ]
    .filter((field) => !filterFields.includes(field))
    .map((field) => ({ value: field, label: name(field) }));

  // Listing members needs the data, so without a frame there is no section.
  const filters = frame && (
    <Section
      title="Filter"
      empty={filterFields.length === 0}
      emptyText="none"
      after={
        <AddMenu
          title="Add a filter"
          prompt="+ filter by…"
          first={filterable}
          onPick={(field) => onViewChange(setExcluded(view, field, []))}
        />
      }
    >
      {filterFields.map((field) => {
        const onAxis = axisFields.find((a) => a.field === field);
        return (
          <FilterEntry
            key={field}
            field={field}
            label={onAxis ? axisName(onAxis) : name(field)}
            view={view}
            frame={frame}
            onExclude={(values) =>
              onViewChange(
                // An axis field is listed anyway; an empty filter on it is
                // noise in the spec. Any other field keeps its entry.
                values.length === 0 && onAxis
                  ? removeFilter(view, field)
                  : setExcluded(view, field, values),
              )
            }
            onClear={
              view.filter?.[field]
                ? () => onViewChange(removeFilter(view, field))
                : undefined
            }
          />
        );
      })}
    </Section>
  );

  const zone = (title: string, key: FieldZone) => {
    const fields = view[key] ?? [];
    return (
      <Section
        title={title}
        empty={fields.length === 0}
        // A flat table draws no + of its own and takes no drop; the menu
        // below is the way in.
        {...(flat ? { emptyText: 'none' } : appendTo(key, fields.length))}
        after={
          <AddMenu
            title={`Add a field to ${title.toLowerCase()}`}
            prompt="+ add a field…"
            first={groupable}
            onPick={(field) =>
              onViewChange(
                // A flat table becomes the pivot that shows the same rows,
                // its index columns as the row levels, before the field joins.
                flat
                  ? toPivot(view, display?.indexColumns ?? 0, key, field)
                  : addField(view, key, field),
              )
            }
          />
        }
      >
        {fields.map((axisField, i) => (
          <Row
            key={axisField.field}
            label={axisName(axisField)}
            drag={dragProps({ zone: key, index: i })}
            over={isOver({ zone: key, index: i })}
            onRemove={() => onViewChange(removeField(view, key, i))}
            onPreview={preview({ zone: key, index: i })}
            onLocate={locate({ zone: key, index: i })}
          />
        ))}
      </Section>
    );
  };

  const flat = isFlat(view);
  const footer = display?.footer ?? [];
  /** Drawn as a chart: the same lists, under the names a chart gives them. */
  const asChart = !flat && display?.as === 'chart';
  // A bundle need not carry a display at all; its footer starts empty.
  const shown = display ?? {};
  // The grand total is a property of a pivot view; a flat one has no groups
  // for it to total over the way the engine computes it.
  const summary = !flat && !!view.showSummary;

  /**
   * Both kinds of footer line, in the order the table draws them: the
   * display's rows over the displayed values, then the grand total over the
   * source rows. Only the first kind can be reordered — the total always
   * comes last.
   */
  // A chart draws no footer, so there is nothing for its rows to edit.
  const totals = onDisplayChange && !asChart && (
    <Section
      title="Totals"
      empty={footer.length === 0 && !summary}
      emptyText="none"
      {...appendTo('footer', footer.length)}
      after={
        <AddMenu
          title="Add a total row"
          prompt="+ add a total…"
          first={[
            ...(!flat && !summary
              ? [{ value: GRAND_TOTAL, label: 'Total (over the source rows)' }]
              : []),
            ...COMMON_TOTALS.map((id) => ({ value: id, label: id })),
          ]}
          more={aggregationIds()
            .filter((id) => !COMMON_TOTALS.includes(id))
            .map((id) => ({ value: id, label: id }))}
          onPick={(choice) => {
            if (choice === GRAND_TOTAL) {
              onViewChange(setShowSummary(view, true));
            } else onDisplayChange(addFooterRow(shown, choice));
          }}
        />
      }
    >
      {footer.map((f, i) => (
        <Row
          key={`${f.agg}${i}`}
          label={f.label}
          drag={dragProps({ zone: 'footer', index: i })}
          over={isOver({ zone: 'footer', index: i })}
          onRemove={() => onDisplayChange(removeFooterRow(shown, i))}
          onPreview={preview({ zone: 'footer', index: i })}
          onLocate={locate({ zone: 'footer', index: i })}
        />
      ))}
      {summary && (
        <Row
          key="grand-total"
          label="Total"
          onRemove={() => onViewChange(setShowSummary(view, false))}
          onPreview={preview({ zone: 'summary' })}
          onLocate={locate({ zone: 'summary' })}
        />
      )}
    </Section>
  );

  /**
   * Fields a new measure can aggregate. Any field can be counted, so the
   * measures come first — the `data` columns, and timestamps, whose latest or
   * earliest is worth a column — and the identifiers after. A field may be
   * measured more than once, under different aggregations.
   */
  const measurable = (usual: boolean): Choice[] =>
    (frame?.columns ?? [])
      .filter(
        (c) => (c.meta.category === 'data' || isTimestamp(c.meta)) === usual,
      )
      .map((c) => ({ value: c.name, label: name(c.name) }));

  const resetButton = onReset && (
    <ResetButton onReset={onReset} enabled={canReset} />
  );
  const reset = resetButton && (
    <div className={styles.actions}>{resetButton}</div>
  );

  /**
   * The bars within a category, in the order they are drawn: the column
   * fields' members, which only the computed view knows — a member that
   * exists in the data but is filtered out is not a bar.
   */
  const bars = useMemo(() => {
    if (!asChart || !frame) return [];
    let keys: string[];
    try {
      const depth = (view.pivotColumns ?? []).length;
      keys = [
        ...new Set(
          computeView(frame, view).leaves.map((l) =>
            l.colPath.slice(0, depth).join(PATH_SEPARATOR),
          ),
        ),
      ].filter((k) => k !== '');
    } catch {
      // The chart says what is wrong with the view; the list just goes empty.
      return [];
    }
    const order = display?.chart?.barOrder ?? [];
    const rank = new Map(order.map((k, i) => [k, i]));
    return keys
      .map((key, i) => ({ key, i }))
      .sort(
        (a, b) =>
          (rank.get(a.key) ?? order.length + a.i) -
          (rank.get(b.key) ?? order.length + b.i),
      )
      .map((e) => e.key);
  }, [asChart, frame, view, display?.chart?.barOrder]);

  const showAs = onDisplayChange && !flat && (
    <Section title="Show as" empty={false}>
      <li className={styles.toggle} role="radiogroup" aria-label="Show as">
        {(['table', 'chart'] as const).map((as) => (
          <button
            key={as}
            type="button"
            role="radio"
            aria-checked={(display?.as ?? 'table') === as}
            className={styles.toggleButton}
            onClick={() => onDisplayChange(setShowAs(shown, as))}
          >
            {as === 'table' ? 'Table' : 'Chart'}
          </button>
        ))}
      </li>
    </Section>
  );

  const chart = display?.chart ?? {};
  const fieldsMeasured = new Set(view.columns.map((c) => c.source ?? c.id))
    .size;
  const chartSection = asChart && onDisplayChange && (
    <>
      <Section title="Chart" empty={false}>
        <li className={styles.row}>
          <span className={styles.label}>Orientation</span>
          <select
            className={styles.agg}
            value={chart.orientation ?? 'horizontal'}
            onChange={(e) =>
              onDisplayChange(
                setChart(shown, {
                  orientation: e.target.value as 'horizontal' | 'vertical',
                }),
              )
            }
          >
            <option value="horizontal">horizontal</option>
            <option value="vertical">vertical</option>
          </select>
        </li>
        <li className={styles.row}>
          <span className={styles.label}>Colours</span>
          <select
            className={styles.agg}
            value={chart.colors ?? ''}
            title="What a bar's colour says"
            onChange={(e) =>
              onDisplayChange(
                setChart(shown, {
                  colors: (e.target.value || undefined) as
                    ChartColors | undefined,
                }),
              )
            }
          >
            <option value="">automatic</option>
            {CHART_COLORS.map((c) => (
              <option
                key={c}
                value={c}
                // Nesting needs a field to pick the hue and one to shade it.
                disabled={
                  c === 'nested' && (view.pivotColumns ?? []).length < 2
                }
              >
                {COLOR_LABELS[c]}
              </option>
            ))}
          </select>
        </li>
        <li className={styles.row}>
          <span className={styles.label}>Baseline</span>
          <input
            className={styles.number}
            type="number"
            step="any"
            placeholder="0"
            title="The value bars grow from. Empty is zero."
            // Keyed on the stored value, so an outside change shows through
            // while a half-typed `1.` is left alone.
            key={String(chart.baseline)}
            defaultValue={chart.baseline ?? ''}
            onChange={(e) => {
              const text = e.target.value.trim();
              const value = text === '' ? undefined : Number(text);
              if (value !== undefined && !Number.isFinite(value)) return;
              onDisplayChange(setChart(shown, { baseline: value }));
            }}
          />
        </li>
        <Check
          label="Baseline in the middle"
          checked={!!chart.symmetric}
          onChange={(on) =>
            onDisplayChange(setChart(shown, { symmetric: on || undefined }))
          }
        />
        <Check
          label="Values at the bar ends"
          checked={chart.labels ?? true}
          onChange={(on) =>
            onDisplayChange(setChart(shown, { labels: on ? undefined : false }))
          }
        />
        <Check
          label="Read out on hover"
          checked={chart.hover ?? true}
          onChange={(on) =>
            onDisplayChange(setChart(shown, { hover: on ? undefined : false }))
          }
        />
        {/* Only worth offering when the values measure several fields. */}
        {fieldsMeasured > 1 && (
          <>
            <Check
              label="A panel per measured field"
              checked={chart.split ?? true}
              onChange={(on) =>
                onDisplayChange(
                  setChart(shown, { split: on ? undefined : false }),
                )
              }
            />
            {(chart.split ?? true) && (
              <Check
                label="Panels share a scale"
                checked={chart.sharedScale ?? true}
                onChange={(on) =>
                  onDisplayChange(
                    setChart(shown, { sharedScale: on ? undefined : false }),
                  )
                }
              />
            )}
          </>
        )}
      </Section>
      {bars.length > 1 && (
        <Section title="Bar order" empty={false}>
          {bars.map((key, i) => (
            <Row key={key} label={key}>
              <button
                type="button"
                className={styles.step}
                title="Draw earlier"
                aria-label={`Move ${key} earlier`}
                disabled={i === 0}
                onClick={() => onDisplayChange(moveBar(shown, bars, i, i - 1))}
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.step}
                title="Draw later"
                aria-label={`Move ${key} later`}
                disabled={i === bars.length - 1}
                onClick={() => onDisplayChange(moveBar(shown, bars, i, i + 1))}
              >
                ↓
              </button>
            </Row>
          ))}
        </Section>
      )}
    </>
  );

  if (flat) {
    return (
      <div
        className={`${styles.root} ${className ?? ''}`}
        data-theme={paletteFor}
      >
        {zone('Pivot rows', 'pivotRows')}
        {zone('Pivot columns', 'pivotColumns')}
        <Section title="Columns" empty={view.columns.length === 0}>
          {view.columns.map((def, i) => (
            <Row
              key={def.id}
              label={def.label ?? def.id}
              onLocate={locate({ zone: 'columns', index: i })}
            />
          ))}
        </Section>
        {filters}
        {totals}
        <p className={styles.note}>
          One row per source row. Add a field to pivot rows or columns to group
          them: the index columns become row levels, and every other column
          shows its group’s value, or “(several)” where the group’s rows differ.
        </p>
        {reset}
      </div>
    );
  }

  /**
   * Back to one row per source row. Its own action, not what removing the
   * last axis field does: it drops whatever only means something over a
   * group, so it should be asked for.
   */
  const listRows = onDisplayChange && (
    <button
      type="button"
      className={styles.reset}
      title="Show the source rows instead: one row each, aggregations and grand total dropped"
      onClick={() => {
        const { view: next, indexColumns } = toFlat(view);
        // The display first: a flat view cannot be drawn as a chart, and
        // the table should never get the one without the other.
        onDisplayChange({ ...shown, as: undefined, indexColumns });
        onViewChange(next);
      }}
    >
      List source rows
    </button>
  );

  return (
    <div
      className={`${styles.root} ${className ?? ''}`}
      data-theme={paletteFor}
    >
      {showAs}
      {zone(asChart ? 'Categories' : 'Pivot rows', 'pivotRows')}
      {zone(asChart ? 'Bars' : 'Pivot columns', 'pivotColumns')}

      <Section
        title={asChart ? 'Values' : 'Columns'}
        empty={view.columns.length === 0}
        {...appendTo('columns', view.columns.length)}
        after={
          <AddMenu
            title="Add a column"
            prompt="+ add a column…"
            first={measurable(true)}
            more={measurable(false)}
            onPick={(field) => {
              const column = frame?.columnByName.get(field);
              onViewChange(
                addColumn(view, field, defaultAgg(column), {
                  label: name(field),
                  // Nothing is deduced for an instant, which would otherwise
                  // print as epoch milliseconds.
                  ...(isTimestamp(column?.meta)
                    ? { format: { fnName: Format.RelativeTime } }
                    : {}),
                }),
              );
            }}
          />
        }
      >
        {view.columns.map((column, i) => (
          <Row
            key={column.id}
            label={column.label ?? name(column.source ?? column.id)}
            drag={dragProps({ zone: 'columns', index: i })}
            over={isOver({ zone: 'columns', index: i })}
            // `removeColumn` refuses to drop the last measure, since there
            // would be nothing left to aggregate; offer no control for it.
            onRemove={
              removeColumn(view, i) === view
                ? undefined
                : () => onViewChange(removeColumn(view, i))
            }
            onPreview={preview({ zone: 'columns', index: i })}
            onLocate={locate({ zone: 'columns', index: i })}
          >
            {/* Only a measure has an aggregation to choose. */}
            {column.agg !== undefined && (
              <select
                className={styles.agg}
                value={column.agg}
                title="Aggregation"
                onChange={(e) =>
                  onViewChange(setColumnAgg(view, i, e.target.value))
                }
              >
                {aggregationIds().map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            )}
            {asChart && onDisplayChange && (
              <select
                className={styles.agg}
                value={markOf(view, display?.chart, i)}
                title="Draw as"
                onChange={(e) =>
                  onDisplayChange(
                    setMark(shown, column.id, e.target.value as ChartMark),
                  )
                }
              >
                {CHART_MARKS.map((mark) => (
                  <option key={mark} value={mark}>
                    {MARK_LABELS[mark]}
                  </option>
                ))}
              </select>
            )}
          </Row>
        ))}
      </Section>

      {chartSection}
      {filters}
      {totals}
      {(listRows || resetButton) && (
        <div className={styles.actions}>
          {listRows}
          {resetButton}
        </div>
      )}
    </div>
  );
}
