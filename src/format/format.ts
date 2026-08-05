/**
 * Format-function registry. A built-in is a factory `(options) => FormatFn`.
 * Built-ins wrap `Intl.NumberFormat` where possible; `duration` is a dedicated
 * SI-time formatter (the `m`/`h` steps are 60-based, so not pure Intl).
 */
import type { CellCtx, FormatFn } from './context';
import type { FormatSpec } from '../pivot/spec';
import { Format } from './builtins';
import { ordinalToIsoDay } from '../data/temporal';
import { evalCell } from './expression';
import { asNumber } from '../util';

type FormatFactory = (options: Record<string, unknown>) => FormatFn;

const registry = new Map<string, FormatFactory>();

function opt<T>(options: Record<string, unknown>, key: string): T | undefined {
  return options[key] as T | undefined;
}

const intlCache = new Map<string, Intl.NumberFormat>();

function numberFormat(options: Record<string, unknown>): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let nf = intlCache.get(key);
  if (!nf) {
    const nfOpts: Intl.NumberFormatOptions = {};
    const decimals = opt<number>(options, 'decimals');
    if (decimals != null) {
      nfOpts.minimumFractionDigits = decimals;
      nfOpts.maximumFractionDigits = decimals;
    }
    // Significant digits rather than fraction digits: what an auto-scaled
    // column wants, since it does not know in advance which side of the
    // decimal point its numbers will land on.
    const sig = opt<number>(options, 'significantDigits');
    if (sig != null) {
      nfOpts.minimumSignificantDigits = sig;
      nfOpts.maximumSignificantDigits = sig;
    }
    if (opt<boolean>(options, 'compact')) nfOpts.notation = 'compact';
    const signDisplay = opt<Intl.NumberFormatOptions['signDisplay']>(
      options,
      'signDisplay',
    );
    if (signDisplay) nfOpts.signDisplay = signDisplay;
    nf = new Intl.NumberFormat(opt<string>(options, 'locale'), nfOpts);
    intlCache.set(key, nf);
  }
  return nf;
}

/**
 * Resolve the affixes once per column. The overwhelmingly common case is
 * neither, and this runs for every cell — plus 200 times per column while
 * widths are measured — so the no-affix path returns the body untouched.
 */
function affixer(options: Record<string, unknown>): (body: string) => string {
  const prefix = opt<string>(options, 'prefix') ?? '';
  const suffix = opt<string>(options, 'suffix') ?? '';
  if (!prefix && !suffix) return (body) => body;
  return (body) => `${prefix}${body}${suffix}`;
}

/** Numeric built-in shared by number/integer. */
function intlBuiltin(base: Record<string, unknown>): FormatFactory {
  return (options) => {
    const merged = { ...base, ...options };
    const nf = numberFormat(merged);
    const affix = affixer(merged);
    return (ctx) => {
      const n = asNumber(ctx.value);
      if (n === null) return ctx.value == null ? '' : String(ctx.value);
      return affix(nf.format(n));
    };
  };
}

registry.set('number', intlBuiltin({}));
registry.set('integer', intlBuiltin({ decimals: 0 }));

// --- calendar names ---------------------------------------------------------

/** 2024-01-01 was a Monday, so `Date.UTC(2024, 0, isoDay)` is that ISO day. */
const REF_WEEK = (isoDay: number) => Date.UTC(2024, 0, isoDay);
const REF_MONTH = (month: number) => Date.UTC(2024, month - 1, 1);

type NameWidth = 'short' | 'long' | 'narrow';

const nameCache = new Map<string, Intl.DateTimeFormat>();

function nameFormat(
  locale: string | undefined,
  field: 'weekday' | 'month',
  width: NameWidth,
): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${field}|${width}`;
  let fmt = nameCache.get(key);
  if (!fmt) {
    // UTC so the reference date cannot drift a day under a negative offset.
    fmt = new Intl.DateTimeFormat(locale, { [field]: width, timeZone: 'UTC' });
    nameCache.set(key, fmt);
  }
  return fmt;
}

/**
 * Weekday name from a *locale ordinal* (0 = the locale's first day), the shape
 * `temporalHelpers().weekday` produces. Reads the same `firstDayOfWeek` the
 * helper did, so the two cannot disagree.
 */
registry.set('weekday', (options) => {
  const locale = opt<string>(options, 'locale');
  const width = opt<NameWidth>(options, 'width') ?? 'short';
  const fmt = nameFormat(locale, 'weekday', width);
  return (ctx) => {
    const n = asNumber(ctx.value);
    if (n === null) return String(ctx.value);
    return fmt.format(REF_WEEK(ordinalToIsoDay(n, locale)));
  };
});

/** Month name from a 1..12 number. */
registry.set('month', (options) => {
  const locale = opt<string>(options, 'locale');
  const width = opt<NameWidth>(options, 'width') ?? 'short';
  const fmt = nameFormat(locale, 'month', width);
  return (ctx) => {
    const n = asNumber(ctx.value);
    if (n === null || n < 1 || n > 12) return String(ctx.value);
    return fmt.format(REF_MONTH(n));
  };
});

// --- resolution -------------------------------------------------------------

/** The default formatter: nulls → emptyDisplay, everything else → String. */
export function defaultFormat(emptyDisplay = ''): FormatFn {
  return (ctx) => (ctx.value == null ? emptyDisplay : String(ctx.value));
}

export function resolveFormat(
  spec: FormatSpec | undefined,
  emptyDisplay = '',
): FormatFn {
  if (!spec) return defaultFormat(emptyDisplay);
  if ('fn' in spec) return spec.fn;
  if ('expression' in spec) {
    const src = spec.expression;
    return (ctx: CellCtx) => {
      const result = evalCell(src, ctx);
      return result == null ? emptyDisplay : String(result);
    };
  }
  // An options-only spec has no built-in to name; it defaults to `number`.
  // (The engine normally resolves this against the column's deduced format
  // first — see `resolveFormatSpec`.)
  const fnName = 'fnName' in spec ? spec.fnName : Format.Number;
  const factory = registry.get(fnName);
  if (!factory) {
    throw new Error(`Unknown format "${fnName}"`);
  }
  const fn = factory(spec.options ?? {});
  // Centralize null handling so every built-in honors emptyDisplay.
  return (ctx: CellCtx) => (ctx.value == null ? emptyDisplay : fn(ctx));
}

export function registerFormat(name: string, factory: FormatFactory): void {
  registry.set(name, factory);
}
