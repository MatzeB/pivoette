/**
 * A panel showing a `ViewSpec`'s field lists directly: rows, columns, values,
 * and the footer aggregations.
 *
 * Adding happens in the table — every list has its own `+` on the grid — so
 * this is for seeing what is configured, reordering it, and removing it. All of
 * it is presentation over `ops.ts`, which is where the behaviour is tested.
 */
import { useRef, useState } from 'react';
import { aggregationIds } from '../pivot/aggregations';
import { isFlat } from '../pivot/spec';
import type { ViewSpec } from '../pivot/spec';
import type { DataTableDisplay } from '../components/DataTable';
import type { DataFrame } from '../data/types';
import {
  applyDrop,
  removeField,
  removeFooterRow,
  removeValue,
  setValueAgg,
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
  className?: string;
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
  children,
}: {
  title: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <h4 className={styles.heading}>{title}</h4>
      {empty ? (
        <p className={styles.empty}>none — use the + in the table</p>
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
  className,
}: ViewEditorProps) {
  const dragged = useRef<DragRef | null>(null);
  const [over, setOver] = useState<DragRef | null>(null);

  if (isFlat(view)) {
    return (
      <div className={`${styles.root} ${className ?? ''}`}>
        <Section title="Columns" empty={view.columns.length === 0}>
          {view.columns.map((def) => (
            <Row key={def.id} label={def.label ?? def.id} />
          ))}
        </Section>
        <p className={styles.note}>
          A flat table has no axes to pivot; editing is limited to pivot views.
        </p>
      </div>
    );
  }

  const name = (field: string) =>
    frame?.columnByName.get(field)?.meta.displayName ?? field;

  function drop(to: DragRef) {
    const from = dragged.current;
    dragged.current = null;
    setOver(null);
    if (from) {
      applyDrop(from, to, { view, display, onViewChange, onDisplayChange });
    }
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
      onDragOver: (e: React.DragEvent) => {
        if (!dragged.current) return;
        e.preventDefault();
        setOver(ref);
      },
      onDragLeave: () => setOver(null),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        drop(ref);
      },
      onDragEnd: () => {
        dragged.current = null;
        setOver(null);
      },
    };
  }

  const isOver = (ref: DragRef) =>
    over?.zone === ref.zone && over.index === ref.index;

  const zone = (title: string, key: FieldZone) => {
    const fields = view[key];
    return (
      <Section title={title} empty={fields.length === 0}>
        {fields.map((field, i) => (
          <Row
            key={field}
            label={name(field)}
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
    <div className={`${styles.root} ${className ?? ''}`}>
      {zone('Rows', 'rows')}
      {zone('Columns', 'columns')}

      <Section title="Values" empty={view.values.length === 0}>
        {view.values.map((value, i) => (
          <Row
            key={value.id}
            label={value.label ?? name(value.field)}
            drag={dragProps({ zone: 'values', index: i })}
            over={isOver({ zone: 'values', index: i })}
            // The last measure cannot go: there would be nothing to aggregate.
            onRemove={
              view.values.length > 1
                ? () => onViewChange(removeValue(view, i))
                : undefined
            }
          >
            <select
              className={styles.agg}
              value={value.agg}
              title="Aggregation"
              onChange={(e) =>
                onViewChange(setValueAgg(view, i, e.target.value))
              }
            >
              {aggregationIds().map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </Row>
        ))}
      </Section>

      {onDisplayChange && display && (
        <Section title="Totals" empty={footer.length === 0}>
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
    </div>
  );
}
