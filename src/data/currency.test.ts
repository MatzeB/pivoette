import { describe, expect, it } from 'vitest';
import { testMeta as meta } from '../test-meta';
import { currencyFacts } from './currency';
import { columnCurrency, unitLabels } from './meta';
import { deduceFormat } from '../format/deduce';

describe('currencyFacts', () => {
  it('resolves a long unit name to its ISO code', () => {
    expect(currencyFacts('dollar', 'en-US')?.code).toBe('USD');
    expect(currencyFacts('euro', 'en-US')?.code).toBe('EUR');
    expect(currencyFacts('yen', 'en-US')?.code).toBe('JPY');
  });

  it('accepts an ISO code directly', () => {
    expect(currencyFacts('CHF', 'en-US')?.code).toBe('CHF');
  });

  it('takes the fraction digits from the currency, not the locale', () => {
    // USD has 2, JPY has none — in either locale.
    expect(currencyFacts('dollar', 'en-US')?.decimals).toBe(2);
    expect(currencyFacts('dollar', 'ja-JP')?.decimals).toBe(2);
    expect(currencyFacts('yen', 'en-US')?.decimals).toBe(0);
    expect(currencyFacts('yen', 'ja-JP')?.decimals).toBe(0);
  });

  it('takes the symbol placement from the locale', () => {
    expect(currencyFacts('dollar', 'en-US')?.prefix).toBe(true);
    // German puts it after the amount: 1.808,01 $
    expect(currencyFacts('dollar', 'de-DE')?.prefix).toBe(false);
    expect(currencyFacts('euro', 'de-DE')?.prefix).toBe(false);
  });

  it('is not a currency', () => {
    expect(currencyFacts('second', 'en-US')).toBeUndefined();
    expect(currencyFacts('byte', 'en-US')).toBeUndefined();
    expect(currencyFacts(null)).toBeUndefined();
    expect(currencyFacts('')).toBeUndefined();
  });
});

describe('currency-aware metadata', () => {
  const money = meta({ kind: 'price', unit: 'dollar' });

  it('flips the label placement with the locale', () => {
    expect(unitLabels(money, 'en-US').prefix).toBe(true);
    expect(unitLabels(money, 'de-DE').prefix).toBe(false);
  });

  it('trails a price whose unit names no known currency', () => {
    // How a label attaches is a property of the symbol, not of the kind: an
    // unrecognised one trails with a space rather than running into the digits.
    const credits = meta({ kind: 'price', unit: 'credit' });
    expect(columnCurrency(credits, 'de-DE')).toBeUndefined();
    const labels = unitLabels(credits, 'de-DE');
    expect(labels.prefix).toBe(false);
    expect(labels.tight).toBe(false);
  });

  it('reads placement off a bare symbol with no resolvable unit name', () => {
    const bare = meta({ unitShort: '$' });
    expect(unitLabels(bare, 'en-US')).toMatchObject({
      prefix: true,
      tight: true,
    });
    // Percent hugs without leading.
    expect(unitLabels(meta({ scale: 'percent' }), 'en-US')).toMatchObject({
      prefix: false,
      tight: true,
    });
  });

  it('ignores a compound unit — a rate is not a currency amount', () => {
    const rate = meta({
      kind: ['price', '1/duration'],
      unit: ['dollar', '1/hour'],
    });
    expect(columnCurrency(rate)).toBeUndefined();
    expect(unitLabels(rate, 'en-US').prefix).toBe(false);
  });

  it('deduces the currency’s own decimals over the flat price rule', () => {
    expect(deduceFormat(meta({ kind: 'price', unit: 'yen' }), 'en-US')).toEqual(
      {
        fnName: 'number',
        options: { decimals: 0 },
      },
    );
    expect(deduceFormat(money, 'en-US')).toEqual({
      fnName: 'number',
      options: { decimals: 2 },
    });
    // A price with no currency unit keeps the flat 2 decimals.
    expect(deduceFormat(meta({ kind: 'price' }), 'en-US')).toEqual({
      fnName: 'number',
      options: { decimals: 2 },
    });
  });
});
