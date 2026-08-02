/**
 * The `+` affordance and its menu, shared by all four edit sites.
 *
 * Kept deliberately small: a button, a popover list, and outside-click /
 * Escape dismissal. Which options appear is the caller's business — the menus
 * differ (index columns, data columns, aggregations) but the interaction does
 * not.
 */
import { useEffect, useRef, useState } from 'react';
import styles from './AddMenu.module.css';

export interface AddOption {
  id: string;
  label: string;
  /** Rendered muted and, for `Custom…`, doing nothing yet. */
  hint?: string;
}

export interface AddMenuProps {
  /** Tooltip and accessible name, e.g. "Add a row field". */
  title: string;
  options: AddOption[];
  /** Return `true` to keep the menu open for a second step. */
  onPick: (id: string) => boolean | void;
  /** Called when the menu closes, so a multi-step caller can reset. */
  onClose?: () => void;
  className?: string;
}

export function AddMenu({
  title,
  options,
  onPick,
  onClose,
  className,
}: AddMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
        onClose?.();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        onClose?.();
      }
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <span ref={root} className={`${styles.root} ${className ?? ''}`}>
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-expanded={open}
        className={styles.button}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (!next) onClose?.();
        }}
      >
        +
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          {options.length === 0 && (
            <div className={styles.empty}>Nothing to add</div>
          )}
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                if (onPick(o.id) !== true) {
                  setOpen(false);
                  onClose?.();
                }
              }}
            >
              <span>{o.label}</span>
              {o.hint && <span className={styles.hint}>{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
