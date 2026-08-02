import { describe, expect, it } from 'vitest';
import { datasetMeta, fromDataset, fromRows } from './import';
import { kindId, normalizeMeta, unitLabels } from './meta';
import type { ColumnMeta, ColumnMetaInput } from './meta';

/** Normalize a standalone metadata input for label assertions. */
function meta(input: ColumnMetaInput): ColumnMeta {
  return normalizeMeta(
    { dataName: 'x', type: 'float', category: 'data' },
    input,
  );
}

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
    const m = meta({ siUnit: ['token', '1/second'], siScale: ['kilo', null] });
    expect(m.siUnitShort).toEqual(['tok', '1/s']);
    expect(m.siScaleShort).toEqual(['k', null]);
    expect(meta({ siScale: 'percent' }).siScaleShort).toEqual(['%']);
    expect(meta({ siUnit: 'second', siScale: 'milli' }).siUnitShort).toEqual([
      's',
    ]);
  });

  it('deduces IEC binary prefixes alongside the SI ones', () => {
    expect(unitLabels(meta({ siUnit: 'byte', siScale: 'mebi' })).full).toBe(
      'MiB',
    );
    expect(unitLabels(meta({ siUnit: 'byte', siScale: 'gibi' })).full).toBe(
      'GiB',
    );
    // The SI prefix stays distinct from its binary neighbour.
    expect(unitLabels(meta({ siUnit: 'byte', siScale: 'mega' })).full).toBe(
      'MB',
    );
  });

  it('keeps an explicit shortname over the deduced one', () => {
    expect(meta({ siUnit: 'byte', siUnitShort: 'Byte' }).siUnitShort).toEqual([
      'Byte',
    ]);
  });

  it('passes an unknown unit through unchanged', () => {
    expect(meta({ siUnit: 'widget' }).siUnitShort).toEqual(['widget']);
  });
});

describe('normalization', () => {
  it('coerces a scalar to a one-factor array', () => {
    expect(meta({ siUnit: 'byte' }).siUnit).toEqual(['byte']);
  });

  it('pads ragged arrays to the common factor count', () => {
    const m = meta({ siUnit: ['byte', '1/second'], siScale: ['mega'] });
    expect(m.siUnit).toEqual(['byte', '1/second']);
    expect(m.siScale).toEqual(['mega', null]);
    expect(m.siScaleShort).toEqual(['M', null]);
  });

  it('omits unit arrays entirely for a unitless column', () => {
    const m = meta({});
    expect(m.siUnit).toBeUndefined();
    expect(m.siUnitShort).toBeUndefined();
    expect(m.kind).toBeUndefined();
  });

  it('is idempotent and survives a JSON round-trip', () => {
    const m = meta({
      displayName: 'Throughput',
      kind: ['count', '1/duration'],
      siUnit: ['token', '1/second'],
      siScale: ['kilo', null],
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
    expect(full({ siUnit: ['meter', 'meter'] })).toBe('m²');
  });

  it('composes inverted factors as a denominator', () => {
    expect(
      full({ siUnit: ['token', '1/second'], siScale: ['kilo', null] }),
    ).toBe('ktok/s');
    expect(
      full({ siUnit: ['byte', '1/second'], siScale: ['mega', null] }),
    ).toBe('MB/s');
  });

  it('composes a mixed numerator and a squared denominator', () => {
    expect(
      full({ siUnit: ['kilogram', 'meter', '1/second', '1/second'] }),
    ).toBe('kg·m/s²');
  });

  it('renders a bare inverse with a 1 numerator', () => {
    expect(full({ siUnit: ['1/second'] })).toBe('1/s');
  });

  it('handles a scale with no unit', () => {
    expect(full({ siScale: 'percent' })).toBe('%');
  });

  it('is empty for a unitless column', () => {
    expect(full({})).toBe('');
    expect(unitLabels(undefined).full).toBe('');
  });

  it('splits scale and unit only for a single un-inverted factor', () => {
    const simple = unitLabels(meta({ siUnit: 'second', siScale: 'milli' }));
    expect(simple).toEqual({
      full: 'ms',
      simple: true,
      scalePart: 'm',
      unitPart: 's',
    });

    const compound = unitLabels(meta({ siUnit: ['byte', '1/second'] }));
    expect(compound.simple).toBe(false);
    expect(compound.scalePart).toBe('');
    expect(compound.unitPart).toBe('');

    // A single *inverted* factor is not simple either.
    expect(unitLabels(meta({ siUnit: ['1/second'] })).simple).toBe(false);
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
          siUnit: ['second'],
          siUnitShort: ['s'],
          siScale: ['milli'],
          siScaleShort: ['m'],
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
