import { describe, expect, it } from 'vitest';
import { affixOf, attachUnit } from './label';
import { unitLabels } from '../data/meta';
import { testMeta } from '../test-meta';

/** The affix a column's metadata implies, the way every caller gets it. */
const affix = (
  input: Parameters<typeof testMeta>[0],
  locale = 'en-US',
): ReturnType<typeof affixOf> => affixOf(unitLabels(testMeta(input), locale));

describe('attachUnit', () => {
  const metre = { scale: 'k', unit: 'm', prefix: false, tight: false };
  const dollar = { scale: '', unit: '$', prefix: true, tight: true };

  it('trails a standing-off label as one token', () => {
    expect(attachUnit('300', metre)).toBe('300 km');
    expect(attachUnit('15467', { ...metre, scale: '', unit: 'MB' })).toBe(
      '15467 MB',
    );
  });

  it('hugs a tight one', () => {
    expect(
      attachUnit('45.6', { scale: '', unit: '%', prefix: false, tight: true }),
    ).toBe('45.6%');
  });

  it('leads where the locale puts the symbol first', () => {
    expect(attachUnit('12.50', dollar)).toBe('$12.50');
  });

  it('leaves the scale behind the digits when the symbol leads', () => {
    // `k$300` is not how anyone writes three hundred thousand dollars. The
    // magnitude belongs to the number, so only the symbol moves in front.
    expect(attachUnit('300', { ...dollar, scale: 'k' })).toBe('$300k');
  });

  it('keeps a leading symbol inside the sign', () => {
    expect(attachUnit('-199.75', { ...dollar, scale: 'k' })).toBe('-$199.75k');
    expect(attachUnit('+12.50', dollar)).toBe('+$12.50');
  });

  it('leaves a sign alone when the label trails', () => {
    expect(attachUnit('-40', { ...metre, scale: '', unit: 'MB' })).toBe(
      '-40 MB',
    );
  });

  it('does not turn empty text into a lone unit', () => {
    expect(attachUnit('', metre)).toBe('');
    expect(attachUnit('', dollar)).toBe('');
  });

  it('passes the text through when there is no unit', () => {
    expect(
      attachUnit('42', { scale: '', unit: '', prefix: false, tight: false }),
    ).toBe('42');
  });
});

describe('affixOf', () => {
  it('splits a simple label into its two halves', () => {
    expect(affix({ kind: 'length', unit: 'meter', scale: 'kilo' })).toEqual({
      scale: 'k',
      unit: 'm',
      prefix: false,
      tight: false,
    });
  });

  it('keeps a compound label whole, since it has no separable halves', () => {
    // `ktok/s` cannot be split around the digits, and it always trails.
    const compound = affix({
      kind: ['count', '1/duration'],
      unit: ['token', '1/second'],
      scale: ['kilo', null],
    });
    expect(compound).toMatchObject({
      scale: '',
      unit: 'ktok/s',
      prefix: false,
    });
    expect(attachUnit('4.2', compound)).toBe('4.2 ktok/s');
  });

  it('marks a currency as leading, per the locale', () => {
    expect(affix({ kind: 'price', unit: 'dollar' })).toMatchObject({
      unit: '$',
      prefix: true,
      tight: true,
    });
    // de-DE trails the euro, so the same machinery puts it after the digits.
    const euro = affix({ kind: 'price', unit: 'euro' }, 'de-DE');
    expect(euro.prefix).toBe(false);
    expect(attachUnit('12,50', euro)).toBe('12,50 €');
  });
});

describe('the composed label agrees with the values under it', () => {
  it('reads unit-then-scale for a leading symbol', () => {
    // So a header of `($k)` describes a column of `$300k`.
    const labels = unitLabels(
      testMeta({ kind: 'price', unit: 'dollar', scale: 'kilo' }),
      'en-US',
    );
    expect(labels.full).toBe('$k');
    expect(attachUnit('300', affixOf(labels))).toBe('$300k');
  });

  it('reads scale-then-unit for a trailing one', () => {
    const labels = unitLabels(
      testMeta({ kind: 'length', unit: 'meter', scale: 'kilo' }),
      'en-US',
    );
    expect(labels.full).toBe('km');
    expect(attachUnit('300', affixOf(labels))).toBe('300 km');
  });
});
