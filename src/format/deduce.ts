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
 * is why `price` maps to a plain 2-decimal number (there is no `currency`
 * built-in — the symbol is metadata), and `percentage` to a plain number rather
 * than `percent`, whose `Intl` style would multiply a stored `45.6` by 100.
 */
import { columnCurrency, kindId, unitLabels } from '../data/meta';
import type { ColumnMeta } from '../data/meta';
import type { FormatSpec } from '../pivot/spec';
import { Format } from './builtins';

const ONE_DECIMAL: FormatSpec = {
  fnName: Format.Number,
  options: { decimals: 1 },
};
const TWO_DECIMALS: FormatSpec = {
  fnName: Format.Number,
  options: { decimals: 2 },
};

/** Keyed by `kindId` — what the column *is*. */
const KIND_RULES: Record<string, FormatSpec> = {
  price: TWO_DECIMALS,
  percentage: ONE_DECIMAL,
  count: { fnName: Format.Integer },
};

/**
 * Keyed by the composed unit label — what the column is *measured in*. A
 * fallback for data that carries a unit but no kind, so `scale: ['percent']`
 * alone still gets sensible decimals. Currency symbols deliberately have no
 * entries here: a column whose unit names a currency is answered by `Intl`
 * above, and duplicating "these symbols mean two decimals" would be a second
 * source of truth that disagrees for the likes of JPY.
 */
const UNIT_RULES: Record<string, FormatSpec> = { '%': ONE_DECIMAL };

/**
 * The format implied by a column's kind, else by its unit. A recognised
 * currency overrides both with its own fraction digits — 2 for USD, 0 for JPY —
 * rather than the flat 2 the `price` kind assumes.
 */
export function deduceFormat(
  meta: ColumnMeta | undefined,
  locale?: string,
): FormatSpec | undefined {
  if (!meta) return undefined;
  const currency = columnCurrency(meta, locale);
  if (currency) {
    return { fnName: Format.Number, options: { decimals: currency.decimals } };
  }
  return KIND_RULES[kindId(meta)] ?? UNIT_RULES[unitLabels(meta, locale).full];
}

/**
 * Combine a view's explicit format with the deduced one. Naming the *same*
 * built-in merges their options, so a column can override one setting and
 * inherit the rest — `{ fnName: 'number', options: { signDisplay: 'exceptZero' } }`
 * on a percentage keeps the deduced 1 decimal. Naming a different built-in (or
 * supplying an inline fn/expression) replaces the deduction outright.
 *
 * `inherit: false` opts out of deduction altogether: the explicit format is
 * used exactly as written, and a column with no format falls back to the
 * default formatter rather than to its metadata's.
 */
export function resolveFormatSpec(
  explicit: FormatSpec | undefined,
  deduced: FormatSpec | undefined,
  inherit = true,
): FormatSpec | undefined {
  const base = inherit ? deduced : undefined;
  if (!explicit) return base;
  // Inline functions and expressions are self-contained.
  if ('fn' in explicit || 'expression' in explicit) return explicit;

  const named = base && 'fnName' in base ? base : undefined;
  // An options-only spec adopts the deduced built-in, falling back to `number`
  // (every mergeable option — decimals, signDisplay, compact — is numeric).
  const fnName =
    'fnName' in explicit ? explicit.fnName : (named?.fnName ?? Format.Number);
  // Options are inherited only from the same built-in; a different one has its
  // own defaults and its options may not even mean the same thing.
  const inherited = named?.fnName === fnName ? named.options : undefined;
  const options = { ...inherited, ...explicit.options };
  return Object.keys(options).length > 0 ? { fnName, options } : { fnName };
}

/**
 * The whole format pipeline for one column: deduce from metadata, merge the
 * view's explicit spec over it, then stamp on the view locale so separators
 * match the locale the currency facts came from. The engine builds every leaf
 * — flat, measure, and derived — through here.
 */
export function columnFormat(
  src: { format?: FormatSpec; inheritUnitFormat?: boolean },
  meta: ColumnMeta | undefined,
  locale: string | undefined,
): FormatSpec | undefined {
  const format = resolveFormatSpec(
    src.format,
    deduceFormat(meta, locale),
    src.inheritUnitFormat,
  );
  if (!format || !locale || !('fnName' in format)) return format;
  if (format.options?.locale !== undefined) return format;
  return { ...format, options: { ...format.options, locale } };
}
