/**
 * Deduce a column's number format from its metadata, so a view that has already
 * declared what a column *is* need not also restate how to print it.
 *
 * Deliberately small: a handful of rules keyed by `kindId` (what the column is)
 * with a fallback keyed by its unit label (what it is measured in), each an
 * ordinary `FormatSpec`. An explicit `format` in the view always wins, and an
 * unmatched column falls back to the default formatter — so adding metadata can
 * never silently break a column's rendering.
 *
 * Note what these rules *don't* do: none of them print a unit. The symbol comes
 * from the metadata via the table's unit placement (`$12.50`, `45.6%`), which
 * is why `price` maps to a plain 2-decimal number rather than `currency`, and
 * `percentage` to a plain number rather than `percent` (a stored `45.6` means
 * 45.6%, and `Intl`'s percent style would multiply it by 100).
 */
import { kindId, unitLabels } from '../data/meta';
import type { ColumnMeta } from '../data/meta';
import type { FormatSpec } from '../pivot/spec';

const ONE_DECIMAL: FormatSpec = { name: 'number', options: { decimals: 1 } };
const TWO_DECIMALS: FormatSpec = { name: 'number', options: { decimals: 2 } };

/** Keyed by `kindId` — what the column *is*. */
const KIND_RULES: Record<string, FormatSpec> = {
  price: TWO_DECIMALS,
  percentage: ONE_DECIMAL,
  count: { name: 'integer' },
};

/**
 * Keyed by the composed unit label — what the column is *measured in*. A
 * fallback for data that carries a unit but no kind, so `scale: ['percent']`
 * alone still gets sensible decimals.
 */
const UNIT_RULES: Record<string, FormatSpec> = {
  '%': ONE_DECIMAL,
  $: TWO_DECIMALS,
  '€': TWO_DECIMALS,
  '£': TWO_DECIMALS,
};

/** The format implied by a column's kind, else by its unit. */
export function deduceFormat(
  meta: ColumnMeta | undefined,
): FormatSpec | undefined {
  if (!meta) return undefined;
  return KIND_RULES[kindId(meta)] ?? UNIT_RULES[unitLabels(meta).full];
}
