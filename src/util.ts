/** Small cross-cutting helpers shared by the engine, formatters, and component. */
import type { ColumnType } from './data/types';

/** Coerce a value to a finite number, or null. */
export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Null-first ordering, then natural `<` / `>` comparison. */
export function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** True for the column types that hold numbers (and so right-align by default). */
export function isNumericType(type: ColumnType | undefined): boolean {
  return type === 'int' || type === 'float';
}
