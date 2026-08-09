import { describe, expect, it } from 'vitest';
import { testMeta as meta } from '../test-meta';
import { datasetMeta, fromDataset, fromRows } from './import';
import { withMeta } from './frame';
import { kindId, normalizeMeta, unitLabels } from './meta';
import type { ColumnMetaInput } from './meta';

describe('deduction', () => {
  it('categorizes numeric columns as data and the rest as index', () => {
    const f = fromRows([{ n: 1, f: 1.5, s: 'a', j: { k: 1 }, empty: null }]);
    const cat = (name: string) => f.columnByName.get(name)!.meta.category;
    expect(cat('n')).toBe('data');
    expect(cat('f')).toBe('data');
    expect(cat('s')).toBe('index');
    expect(cat('j')).toBe('index');
    expect(cat('empty')).toBe('index');
  });

  it('defaults displayName to the data name and lets callers override', () => {
    const f = fromRows([{ app: 'a', timeNs: 1 }], {
      app: { displayName: 'Application' },
    });
    expect(f.columnByName.get('app')!.meta.displayName).toBe('Application');
    expect(f.columnByName.get('app')!.meta.dataName).toBe('app');
    expect(f.columnByName.get('timeNs')!.meta.displayName).toBe('timeNs');
  });

  it('lets a caller override deduced category and type', () => {
    const f = fromRows([{ year: 2026 }], {
      year: { category: 'index', type: 'string' },
    });
    const col = f.columnByName.get('year')!;
    expect(col.meta.category).toBe('index');
    expect(col.type).toBe('string');
  });

  it('deduces shortnames, including inverted factors', () => {
    const m = meta({ unit: ['token', '1/second'], scale: ['kilo', null] });
    expect(m.unitShort).toEqual(['tok', '1/s']);
    expect(m.scaleShort).toEqual(['k', null]);
    expect(meta({ scale: 'percent' }).scaleShort).toEqual(['%']);
    expect(meta({ unit: 'second', scale: 'milli' }).unitShort).toEqual(['s']);
  });

  it('deduces IEC binary prefixes alongside the SI ones', () => {
    expect(unitLabels(meta({ unit: 'byte', scale: 'mebi' })).full).toBe('MiB');
    expect(unitLabels(meta({ unit: 'byte', scale: 'gibi' })).full).toBe('GiB');
    // The SI prefix stays distinct from its binary neighbour.
    expect(unitLabels(meta({ unit: 'byte', scale: 'mega' })).full).toBe('MB');
  });

  it('keeps an explicit shortname over the deduced one', () => {
    expect(meta({ unit: 'byte', unitShort: 'Byte' }).unitShort).toEqual([
      'Byte',
    ]);
  });

  it('passes an unknown unit through unchanged', () => {
    expect(meta({ unit: 'widget' }).unitShort).toEqual(['widget']);
  });
});

describe('normalization', () => {
  it('coerces a scalar to a one-factor array', () => {
    expect(meta({ unit: 'byte' }).unit).toEqual(['byte']);
  });

  it('pads ragged arrays to the common factor count', () => {
    const m = meta({ unit: ['byte', '1/second'], scale: ['mega'] });
    expect(m.unit).toEqual(['byte', '1/second']);
    expect(m.scale).toEqual(['mega', null]);
    expect(m.scaleShort).toEqual(['M', null]);
  });

  it('omits unit arrays entirely for a unitless column', () => {
    const m = meta({});
    expect(m.unit).toBeUndefined();
    expect(m.unitShort).toBeUndefined();
    expect(m.kind).toBeUndefined();
  });

  it('is idempotent and survives a JSON round-trip', () => {
    const m = meta({
      displayName: 'Throughput',
      kind: ['count', '1/duration'],
      unit: ['token', '1/second'],
      scale: ['kilo', null],
    });
    const again = normalizeMeta(
      { dataName: 'x', type: 'float', category: 'data' },
      JSON.parse(JSON.stringify(m)) as ColumnMetaInput,
    );
    expect(again).toEqual(m);
  });
});

describe('unitLabels', () => {
  const full = (input: ColumnMetaInput) => unitLabels(meta(input)).full;

  it('composes repeated factors as an exponent', () => {
    expect(full({ unit: ['meter', 'meter'] })).toBe('m²');
  });

  it('composes inverted factors as a denominator', () => {
    expect(full({ unit: ['token', '1/second'], scale: ['kilo', null] })).toBe(
      'ktok/s',
    );
    expect(full({ unit: ['byte', '1/second'], scale: ['mega', null] })).toBe(
      'MB/s',
    );
  });

  it('composes a mixed numerator and a squared denominator', () => {
    expect(full({ unit: ['kilogram', 'meter', '1/second', '1/second'] })).toBe(
      'kg·m/s²',
    );
  });

  it('renders a bare inverse with a 1 numerator', () => {
    expect(full({ unit: ['1/second'] })).toBe('1/s');
  });

  it('handles a scale with no unit', () => {
    expect(full({ scale: 'percent' })).toBe('%');
  });

  it('is empty for a unitless column', () => {
    expect(full({})).toBe('');
    expect(unitLabels(undefined).full).toBe('');
  });

  it('splits scale and unit only for a single un-inverted factor', () => {
    const simple = unitLabels(meta({ unit: 'second', scale: 'milli' }));
    expect(simple).toEqual({
      full: 'ms',
      simple: true,
      scalePart: 'm',
      unitPart: 's',
      prefix: false,
      tight: false,
    });

    const compound = unitLabels(meta({ unit: ['byte', '1/second'] }));
    expect(compound.simple).toBe(false);
    expect(compound.scalePart).toBe('');
    expect(compound.unitPart).toBe('');

    // A single *inverted* factor is not simple either.
    expect(unitLabels(meta({ unit: ['1/second'] })).simple).toBe(false);
  });
});

describe('kindId', () => {
  it('composes a canonical key for a compound dimension', () => {
    expect(kindId(meta({ kind: ['length', 'length'] }))).toBe('length²');
    expect(kindId(meta({ kind: ['memory', '1/duration'] }))).toBe(
      'memory/duration',
    );
    expect(kindId(meta({ kind: 'price' }))).toBe('price');
  });

  it('falls back to none', () => {
    expect(kindId(meta({}))).toBe('none');
    expect(kindId(undefined)).toBe('none');
  });
});

describe('dataset JSON', () => {
  const rows = [
    { host: 'a', latency: 1.5 },
    { host: 'b', latency: 2.5 },
  ];

  it('accepts a bare row array and a { meta, rows } wrapper alike', () => {
    const bare = fromDataset(rows);
    const wrapped = fromDataset({ rows });
    expect(wrapped.columns.map((c) => c.name)).toEqual(
      bare.columns.map((c) => c.name),
    );
    expect(wrapped.length).toBe(bare.length);
  });

  it('applies wrapper metadata and round-trips it back out', () => {
    const dataset = {
      meta: {
        latency: {
          displayName: 'Latency',
          unit: ['second'],
          unitShort: ['s'],
          scale: ['milli'],
          scaleShort: ['m'],
        },
      },
      rows,
    };
    const frame = fromDataset(dataset);
    expect(unitLabels(frame.columnByName.get('latency')!.meta).full).toBe('ms');

    const out = datasetMeta(frame);
    expect(out.latency).toMatchObject(dataset.meta.latency);
    // Plain JSON in, plain JSON out — no custom codec needed.
    expect(JSON.parse(JSON.stringify(out.latency))).toEqual(out.latency);
  });
});

describe('currency units', () => {
  it('deduces the symbol and marks it as a prefix', () => {
    const m = meta({ kind: 'price', unit: 'dollar' });
    const labels = unitLabels(m);
    expect(labels.full).toBe('$');
    expect(labels.prefix).toBe(true);
    expect(unitLabels(meta({ kind: 'price', unit: 'euro' })).full).toBe('€');
  });

  it('does not prefix a compound rate', () => {
    // `$/h` reads better trailing the number than leading it.
    const m = meta({
      kind: ['price', '1/duration'],
      unit: ['dollar', '1/hour'],
    });
    expect(unitLabels(m).full).toBe('$/h');
    expect(unitLabels(m).prefix).toBe(false);
  });

  it('does not prefix a non-currency kind', () => {
    expect(unitLabels(meta({ unit: 'second' })).prefix).toBe(false);
  });

  it('reads placement from the locale, not from the currency alone', () => {
    const usd = meta({ kind: 'price', unit: 'dollar' });
    expect(unitLabels(usd, 'en-US').prefix).toBe(true);
    // German trails the symbol, whichever currency it is.
    expect(unitLabels(usd, 'de-DE').prefix).toBe(false);
    const eur = meta({ kind: 'price', unit: 'euro' });
    expect(unitLabels(eur, 'en-US').prefix).toBe(true);
    expect(unitLabels(eur, 'fr-FR').prefix).toBe(false);
  });

  it('asks Intl for a symbol the shortname table does not carry', () => {
    // `UNIT_SHORT` lists only the currencies written the same way everywhere.
    // The rest used to fall through to their long name — `franc1234.50`.
    expect(
      unitLabels(meta({ kind: 'price', unit: 'franc' }), 'de-CH').full,
    ).toBe('CHF');
    expect(
      unitLabels(meta({ kind: 'price', unit: 'rupee' }), 'en-IN').full,
    ).toBe('₹');
    expect(
      unitLabels(meta({ kind: 'price', unit: 'real' }), 'pt-BR').full,
    ).toBe('R$');
  });

  it('lets an explicit shortname win over the locale’s symbol', () => {
    const m = meta({ kind: 'price', unit: 'dollar', unitShort: 'USD' });
    expect(unitLabels(m, 'en-US').full).toBe('USD');
  });

  it('orders a scaled currency so the header matches the values', () => {
    // `$300k`, so `($k)` — see `attachUnit`.
    const m = meta({ kind: 'price', unit: 'dollar', scale: 'kilo' });
    expect(unitLabels(m, 'en-US').full).toBe('$k');
    // Trailing locales re-merge the two halves into one token, like `km`.
    expect(unitLabels(m, 'de-DE').full).toBe('k$');
  });
});

describe('mergeMeta', () => {
  it('re-derives a shortname when its source field is overridden', () => {
    const base = fromRows([{ v: 1 }], { v: { unit: 'byte', scale: 'mega' } });
    const over = withMeta(base, { v: { unit: 'second' } });
    const m = over.columnByName.get('v')!.meta;
    // Not the stale ['B'] from the byte it used to be.
    expect(m.unitShort).toEqual(['s']);
    expect(unitLabels(m).full).toBe('Ms');
  });

  it('keeps an explicitly supplied shortname', () => {
    const over = withMeta(fromRows([{ v: 1 }], { v: { unit: 'byte' } }), {
      v: { unit: 'second', unitShort: 'sec' },
    });
    expect(over.columnByName.get('v')!.meta.unitShort).toEqual(['sec']);
  });

  it('leaves untouched columns identical', () => {
    const base = fromRows([{ a: 1, b: 2 }], { a: { unit: 'byte' } });
    const over = withMeta(base, { a: { displayName: 'A' } });
    // `b` keeps its object identity, so its memoized labels survive.
    expect(over.columnByName.get('b')!.meta).toBe(
      base.columnByName.get('b')!.meta,
    );
  });
});
