/**
 * Deduce a column's number format from its metadata, so a view that has already
 * declared what a column *is* need not also restate how to print it.
 *
 * Deliberately small: a handful of rules keyed by `kindId`, each an ordinary
 * `FormatSpec`. An explicit `format` in the view always wins, and a kind with no
 * rule falls back to the default formatter — so adding metadata to a column can
 * never silently break its rendering.
 *
 * Note what these rules *don't* do: none of them print a unit. The symbol comes
 * from the metadata via the table's unit placement (`$12.50`, `45.6%`), which
 * is why `price` maps to a plain 2-decimal number rather than `currency`, and
 * `percentage` to a plain number rather than `percent` (a stored `45.6` means
 * 45.6%, and `Intl`'s percent style would multiply it by 100).
 */
import { kindId } from '../data/meta';
import type { ColumnMeta } from '../data/meta';
import type { FormatSpec } from '../pivot/spec';

const RULES: Record<string, FormatSpec> = {
  price: { name: 'number', options: { decimals: 2 } },
  percentage: { name: 'number', options: { decimals: 1 } },
  count: { name: 'integer' },
};

/** The format implied by a column's kind, if any. */
export function deduceFormat(
  meta: ColumnMeta | undefined,
): FormatSpec | undefined {
  return meta ? RULES[kindId(meta)] : undefined;
}
