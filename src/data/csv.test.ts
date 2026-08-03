import { describe, expect, it } from 'vitest';
import { fromCsv, parseCsv, parseCsvRows } from './csv';

describe('parseCsvRows', () => {
  it('splits a plain table', () => {
    expect(parseCsvRows('a,b\n1,2\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('handles CRLF, a trailing newline, and a BOM', () => {
    expect(parseCsvRows('﻿a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps delimiters, quotes and newlines inside a quoted field', () => {
    const text = 'name,note\n"Smith, J.","said ""hi""\nthen left"\n';
    expect(parseCsvRows(text)).toEqual([
      ['name', 'note'],
      ['Smith, J.', 'said "hi"\nthen left'],
    ]);
  });

  it('keeps empty fields, including a trailing one', () => {
    expect(parseCsvRows('a,,c\n1,2,')).toEqual([
      ['a', '', 'c'],
      ['1', '2', ''],
    ]);
  });

  it('accepts another delimiter', () => {
    expect(parseCsvRows('a;b\n1;2', ';')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('is empty for empty input', () => {
    expect(parseCsvRows('')).toEqual([]);
  });
});

describe('parseCsv', () => {
  it('names columns from the header and types them by column', () => {
    const rows = parseCsv('app,timeNs\nx,10.5\ny,20\n');
    expect(rows).toEqual([
      { app: 'x', timeNs: 10.5 },
      { app: 'y', timeNs: 20 },
    ]);
  });

  it('leaves a column as text when any value is not numeric', () => {
    // Per column, not per cell: 12 next to "n/a" would be neither.
    expect(parseCsv('q\n12\nn/a\n')).toEqual([{ q: '12' }, { q: 'n/a' }]);
  });

  it('reads blanks as null without making the column text', () => {
    const rows = parseCsv('n\n1\n\n3\n');
    expect(rows).toEqual([{ n: 1 }, { n: null }, { n: 3 }]);
  });

  it('takes extra null spellings only when asked', () => {
    expect(parseCsv('n\n1\nNA\n')).toEqual([{ n: '1' }, { n: 'NA' }]);
    expect(parseCsv('n\n1\nNA\n', { nullValues: ['', 'NA'] })).toEqual([
      { n: 1 },
      { n: null },
    ]);
  });

  it('pads a short row and can skip the header', () => {
    expect(parseCsv('a,b,c\n1,2\n')).toEqual([{ a: 1, b: 2, c: null }]);
    expect(parseCsv('1,2\n', { noHeader: true })).toEqual([
      { column1: 1, column2: 2 },
    ]);
  });
});

describe('fromCsv', () => {
  it('builds a frame with inferred types', () => {
    const frame = fromCsv('app,n\nx,1\ny,2\n');
    expect(frame.length).toBe(2);
    expect(frame.columnByName.get('app')!.type).toBe('string');
    expect(frame.columnByName.get('n')!.type).toBe('int');
    expect(frame.columnByName.get('n')!.values).toEqual([1, 2]);
  });

  it('accepts metadata CSV cannot carry', () => {
    const frame = fromCsv('latency\n1.5\n', {
      meta: { latency: { displayName: 'Latency', unit: ['second'] } },
    });
    const meta = frame.columnByName.get('latency')!.meta;
    expect(meta.displayName).toBe('Latency');
    expect(meta.unitShort).toEqual(['s']);
  });
});
