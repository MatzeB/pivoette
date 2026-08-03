/**
 * CSV import.
 *
 * CSV carries no types, so the two jobs here are separable and both are
 * exported: `parseCsv` turns text into rows, and `fromCsv` builds a
 * `DataFrame` from them (metadata and all, via `fromRows`).
 *
 * Types are decided **per column, not per cell**: a column becomes numeric only
 * if every non-empty value in it parses as a finite number. Coercing cell by
 * cell would leave a `quantity` column holding `12` next to `"n/a"`, which is
 * neither a number column nor a clean string one.
 */
import { fromRows } from './import';
import type { ColumnMetaInput } from './meta';
import type { DataFrame } from './types';

export interface CsvOptions {
  /** Field separator. Defaults to a comma. */
  delimiter?: string;
  /**
   * Treat the first row as data rather than as the header, naming the columns
   * `column1`, `column2`, … Defaults to false.
   */
  noHeader?: boolean;
  /**
   * Values to read as null, compared after trimming. Defaults to the empty
   * string alone — `NA`, `-`, and friends mean different things per source, so
   * they are opt-in rather than guessed.
   */
  nullValues?: string[];
}

/** A quoted field ends at a lone `"`; a doubled `""` is a literal quote. */
const QUOTE = '"';

/**
 * Split CSV text into rows of raw strings, following RFC 4180: fields may be
 * quoted, and a quoted field may contain the delimiter, quotes (doubled), and
 * newlines. Handles CRLF, a trailing newline, and a leading BOM.
 */
export function parseCsvRows(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let started = false; // distinguishes a trailing newline from an empty last row

  // A BOM would otherwise become part of the first column's name.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    started = false;
  };

  for (; i < text.length; i++) {
    const ch = text[i]!;
    started = true;

    if (quoted) {
      if (ch !== QUOTE) {
        field += ch;
      } else if (text[i + 1] === QUOTE) {
        field += QUOTE;
        i++;
      } else {
        quoted = false;
      }
      continue;
    }

    if (ch === QUOTE && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === '\n') {
      endRow();
    } else if (ch === '\r') {
      // CRLF: the newline does the work; a lone CR also ends the row.
      if (text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += ch;
    }
  }
  if (started || field !== '') endRow();
  return rows;
}

/** Every non-null value in the column parses as a finite number. */
function numericColumn(values: (string | null)[]): boolean {
  let saw = false;
  for (const v of values) {
    if (v === null) continue;
    saw = true;
    // `Number('')` is 0 and `Number(' ')` is 0, but empties are already null.
    if (!Number.isFinite(Number(v))) return false;
  }
  return saw;
}

/**
 * Parse CSV text into row objects, with numeric columns converted to numbers
 * and blanks to null. The result is what `fromRows` expects.
 */
export function parseCsv(
  text: string,
  options: CsvOptions = {},
): Record<string, unknown>[] {
  const raw = parseCsvRows(text, options.delimiter ?? ',');
  if (raw.length === 0) return [];

  const nulls = new Set(options.nullValues ?? ['']);
  const header = options.noHeader
    ? raw[0]!.map((_, i) => `column${i + 1}`)
    : raw[0]!.map((name) => name.trim());
  const body = options.noHeader ? raw : raw.slice(1);

  // Column-major first, so each column's type is decided as a whole.
  const columns: (string | null)[][] = header.map(() => []);
  for (const line of body) {
    // A short row leaves the remaining fields null; a long one is ignored.
    for (let c = 0; c < header.length; c++) {
      const cell = line[c];
      const value = cell === undefined ? null : cell.trim();
      columns[c]!.push(value === null || nulls.has(value) ? null : value);
    }
  }

  const numeric = columns.map(numericColumn);
  return body.map((_, r) => {
    const row: Record<string, unknown> = {};
    header.forEach((name, c) => {
      const value = columns[c]![r]!;
      row[name] = value === null ? null : numeric[c] ? Number(value) : value;
    });
    return row;
  });
}

/**
 * Build a `DataFrame` straight from CSV text. `meta` supplies per-column
 * metadata exactly as `fromRows` does — CSV cannot carry it, so a caller that
 * wants units or display names states them here.
 */
export function fromCsv(
  text: string,
  options: CsvOptions & { meta?: Record<string, ColumnMetaInput> } = {},
): DataFrame {
  return fromRows(parseCsv(text, options), options.meta);
}
