/**
 * Locale facts about a currency, read out of `Intl` rather than hardcoded.
 *
 * A currency's symbol placement and decimal count are properties of the
 * currency and the reader's locale, not of the data: `$1.00` but `1,00 €`,
 * two decimals for USD but none for JPY. `Intl` already knows all of it, so we
 * ask it — formatting a zero and inspecting the parts — instead of keeping a
 * table that would inevitably be wrong somewhere.
 *
 * This is what lets money render without a currency *formatter*: the number is
 * a plain number and the symbol stays a unit label the table places.
 */

/** Long unit names that denote a currency, mapped to their ISO 4217 code. An
 * ISO code may also be used directly as the unit (`unit: ['CHF']`). */
const CURRENCY_CODE: Record<string, string> = {
  dollar: 'USD',
  euro: 'EUR',
  pound: 'GBP',
  sterling: 'GBP',
  yen: 'JPY',
  yuan: 'CNY',
  renminbi: 'CNY',
  franc: 'CHF',
  rupee: 'INR',
  won: 'KRW',
  real: 'BRL',
  peso: 'MXN',
  ruble: 'RUB',
  lira: 'TRY',
  krona: 'SEK',
  zloty: 'PLN',
};

export interface CurrencyFacts {
  /** ISO 4217 code, e.g. `USD`. */
  code: string;
  /** True when the symbol leads the number in this locale. */
  prefix: boolean;
  /** The currency's own fraction digits — 2 for USD, 0 for JPY, 3 for BHD. */
  decimals: number;
  /** The symbol as this locale writes it, e.g. `$`, `€`, `CA$`. */
  symbol: string;
}

/** ISO 4217 codes are three uppercase letters. */
const ISO_CODE = /^[A-Z]{3}$/;

function codeOf(unit: string): string | undefined {
  const named = CURRENCY_CODE[unit.toLowerCase()];
  if (named) return named;
  return ISO_CODE.test(unit) ? unit : undefined;
}

const cache = new Map<string, CurrencyFacts | undefined>();

/**
 * Resolve a unit name to its currency facts, or `undefined` if it names no
 * currency. Memoized per locale + code; each miss costs one `Intl` construction.
 */
export function currencyFacts(
  unit: string | null | undefined,
  locale?: string,
): CurrencyFacts | undefined {
  if (!unit) return undefined;
  const code = codeOf(unit);
  if (!code) return undefined;

  const key = `${locale ?? ''}|${code}`;
  const hit = cache.get(key);
  if (hit !== undefined || cache.has(key)) return hit;

  let facts: CurrencyFacts | undefined;
  try {
    const nf = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
    });
    const parts = nf.formatToParts(0);
    const symbolAt = parts.findIndex((p) => p.type === 'currency');
    const numberAt = parts.findIndex((p) => p.type === 'integer');
    facts = {
      code,
      // Leading unless the locale clearly puts the symbol after the digits.
      prefix: symbolAt < 0 || numberAt < 0 || symbolAt < numberAt,
      decimals: nf.resolvedOptions().maximumFractionDigits ?? 2,
      symbol: parts[symbolAt]?.value ?? code,
    };
  } catch {
    // An unknown code throws; treat it as "not a currency" rather than failing
    // a render.
    facts = undefined;
  }
  cache.set(key, facts);
  return facts;
}
