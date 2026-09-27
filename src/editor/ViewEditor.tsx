/**
 * A panel showing a `ViewSpec`'s lists directly: the two pivot axes, the
 * displayed columns, and the footer aggregations.
 *
 * Adding happens in the table — every list has its own `+` on the grid — so
 * this is for seeing what is configured, reordering it, and removing it. All of
 * it is presentation over `ops.ts`, which is where the behaviour is tested.
 */
import { useRef, useState } from 'react';
import { aggregationIds } from '../pivot/aggregations';
import { isFlat } from '../pivot/spec';
import type { AxisField, ViewSpec } from '../pivot/spec';
import type { DataTableDisplay } from '../components/DataTable';
import type { DataFrame } from '../data/types';
import {
  applyDrop,
  removeColumn,
  removeField,
  removeFooterRow,
  setColumnAgg,
} from './ops';
import type { DragRef, FieldZone } from './ops';
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
}

function ResetButton({
  onReset,
  enabled,
}: {
  onReset: () => void;
  enabled: boolean;
}) {
  return (
    <div className={styles.actions}>
      <button
        type="button"
        className={styles.reset}
        disabled={!enabled}
        title="Restore the view as it was loaded"
        onClick={onReset}
      >
        Reset
      </button>
    </div>
  );
}

function Row({
  label,
  onRemove,
  drag,
  over,
  children,
}: {
  label: string;
  onRemove?: () => void;
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
          onClick={onRemove}
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
  drop,
  over,
  children,
}: {
  title: string;
  empty: boolean;
  /**
   * Drop handlers for the list as a whole, landing past its last entry. The
   * rows only accept a drop *at* their own index, which leaves the end of a
   * list unreachable — and an empty list, having no rows at all, unreachable
   * entirely. This is the target for both.
   */
  drop?: React.HTMLAttributes<HTMLElement>;
  over?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section
      className={`${styles.section} ${over ? styles.overSection : ''}`}
      {...drop}
    >
      <h4 className={styles.heading}>{title}</h4>
      {empty ? (
        <p className={styles.empty}>
          {drop ? 'none — drop one here, or use the + in the table' : 'none'}
        </p>
      ) : (
        <ul className={styles.list}>{children}</ul>
      )}
    </section>
  );
}

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
}: ViewEditorProps) {
  const dragged = useRef<DragRef | null>(null);
  const [over, setOver] = useState<DragRef | null>(null);
  // `auto` is the absence of the attribute: the palette's media query decides.
  const paletteFor = theme === 'auto' ? undefined : theme;

  if (isFlat(view)) {
    return (
      <div
        className={`${styles.root} ${className ?? ''}`}
        data-theme={paletteFor}
      >
        <Section title="Columns" empty={view.columns.length === 0}>
          {view.columns.map((def) => (
            <Row key={def.id} label={def.label ?? def.id} />
          ))}
        </Section>
        <p className={styles.note}>
          A flat table has no axes to pivot; editing is limited to pivot views.
        </p>
        {onReset && <ResetButton onReset={onReset} enabled={canReset} />}
      </div>
    );
  }

  const name = (field: string) =>
    frame?.columnByName.get(field)?.meta.displayName ?? field;
  /** Same precedence the engine gives an axis level's header. */
  const axisName = (a: AxisField) => a.label ?? name(a.field);

  function drop(to: DragRef) {
    const from = dragged.current;
    dragged.current = null;
    setOver(null);
    if (from) {
      applyDrop(from, to, { view, display, onViewChange, onDisplayChange });
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

  const zone = (title: string, key: FieldZone) => {
    const fields = view[key] ?? [];
    return (
      <Section
        title={title}
        empty={fields.length === 0}
        {...appendTo(key, fields.length)}
      >
        {fields.map((axisField, i) => (
          <Row
            key={axisField.field}
            label={axisName(axisField)}
            drag={dragProps({ zone: key, index: i })}
            over={isOver({ zone: key, index: i })}
            onRemove={() => onViewChange(removeField(view, key, i))}
          />
        ))}
      </Section>
    );
  };

  const footer = display?.footer ?? [];

  return (
    <div
      className={`${styles.root} ${className ?? ''}`}
      data-theme={paletteFor}
    >
      {zone('Pivot rows', 'pivotRows')}
      {zone('Pivot columns', 'pivotColumns')}

      <Section
        title="Columns"
        empty={view.columns.length === 0}
        {...appendTo('columns', view.columns.length)}
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
          </Row>
        ))}
      </Section>

      {onDisplayChange && display && (
        <Section
          title="Totals"
          empty={footer.length === 0}
          {...appendTo('footer', footer.length)}
        >
          {footer.map((f, i) => (
            <Row
              key={`${f.agg}${i}`}
              label={f.label}
              drag={dragProps({ zone: 'footer', index: i })}
              over={isOver({ zone: 'footer', index: i })}
              onRemove={() => onDisplayChange(removeFooterRow(display, i))}
            />
          ))}
        </Section>
      )}
      {onReset && <ResetButton onReset={onReset} enabled={canReset} />}
    </div>
  );
}
