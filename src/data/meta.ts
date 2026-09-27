/**
 * Per-column metadata: display name, index/data category, and a compound unit.
 *
 * A unit is a *product of factors*, described by index-aligned parallel arrays —
 * factor `i` is `kind[i]` / `unit[i]` / `unitShort[i]` / `scale[i]` /
 * `scaleShort[i]`. Repeating a factor squares it (`['meter','meter']` → `m²`)
 * and a `1/` prefix inverts it (`['token','1/second']` → `tok/s`).
 *
 * `ColumnMeta` holds nothing but JSON primitives and arrays, so it travels
 * alongside the rows with `JSON.stringify` as its whole serializer, and
 * normalization is idempotent. Composed labels are derived, never stored: see
 * `unitLabels` / `kindId`, both memoized per meta object so the parallel arrays
 * are parsed once per column rather than once per cell.
 *
 * Units are a *display* concern only — nothing here transforms a number. A
 * `kilo` scale appends `k`; it does not divide by 1000.
 */
import { currencyFacts } from './currency';
import type { CurrencyFacts } from './currency';
import type { ColumnType } from './types';
import { isNumericType } from '../util';

export type ColumnCategory = 'index' | 'data';

export interface ColumnMeta {
  /** Key in the source row dicts. */
  dataName: string;
  /** Header text; defaults to `dataName`. */
  displayName: string;
  type: ColumnType;
  category: ColumnCategory;
  /** Semantic dimension per factor, e.g. `['length','length']`. */
  kind?: (string | null)[];
  /** Unit per factor, e.g. `['byte','1/second']`. */
  unit?: (string | null)[];
  /** Short unit per factor, e.g. `['B','1/s']`; deduced when missing. */
  unitShort?: (string | null)[];
  /** Scale per factor, e.g. `['mega',null]`. */
  scale?: (string | null)[];
  /** Short scale per factor, e.g. `['M',null]`; deduced when missing. */
  scaleShort?: (string | null)[];
  /**
   * How the raw value encodes what it represents, independent of the column's
   * type — `'rfc3339'` is the only one understood today, but a numeric epoch
   * encoding is the same kind of statement. Scalar, not a per-factor array: a
   * column has one encoding however many unit factors it has.
   *
   * Deliberately not a `unit` entry: `unit` feeds label composition, so an
   * encoding there would be rendered as the column's unit on every cell.
   */
  encoding?: string;
}

/** Array-valued metadata fields; each accepts a bare string for one factor. */
type UnitField = 'kind' | 'unit' | 'unitShort' | 'scale' | 'scaleShort';

/**
 * What a caller may supply. Scalars stand in for a one-factor array and ragged
 * arrays are padded, so `{ unit: 'second', scale: 'milli' }` is valid — as
 * is any previously normalized `ColumnMeta`.
 */
export type ColumnMetaInput = Partial<Omit<ColumnMeta, UnitField>> & {
  [K in UnitField]?: string | (string | null)[];
};

/**
 * Predefined `kind` values — hints for discoverability only. `kind` entries stay
 * plain strings, so any custom value is equally valid.
 */
export const ColumnKind = {
  None: 'none',
  Name: 'name',
  Uid: 'uid',
  Url: 'url',
  Timestamp: 'timestamp',
  Date: 'date',
  Year: 'year',
  Month: 'month',
  Weekday: 'weekday',
  CalendarWeek: 'calendarWeek',
  Duration: 'duration',
  Price: 'price',
  Count: 'count',
  Percentage: 'percentage',
  Memory: 'memory',
  Length: 'length',
  Area: 'area',
  Volume: 'volume',
  Speed: 'speed',
  Mass: 'mass',
  Temperature: 'temperature',
  Intensity: 'intensity',
  Power: 'power',
  Energy: 'energy',
  Frequency: 'frequency',
  Longitude: 'longitude',
  Latitude: 'latitude',
} as const;

export const UNIT_SHORT: Record<string, string> = {
  second: 's',
  minute: 'min',
  hour: 'h',
  day: 'd',
  meter: 'm',
  metre: 'm',
  gram: 'g',
  kilogram: 'kg',
  byte: 'B',
  bit: 'b',
  token: 'tok',
  request: 'req',
  operation: 'op',
  cycle: 'cyc',
  watt: 'W',
  joule: 'J',
  hertz: 'Hz',
  kelvin: 'K',
  celsius: '°C',
  ampere: 'A',
  volt: 'V',
  candela: 'cd',
  mole: 'mol',
  pixel: 'px',
  dollar: '$',
  euro: '€',
  pound: '£',
  yen: '¥',
};

/**
 * How a symbol attaches to a number is a property of the *symbol*, not of the
 * column's kind. Currencies get their placement from the locale — including
 * ones written as a bare symbol, which `currencyFacts` now resolves — so all
 * that is left here is `%`, which hugs without leading.
 */
const SYMBOL_TIGHT = new Set(['%']);

export const SCALE_SHORT: Record<string, string> = {
  femto: 'f',
  pico: 'p',
  nano: 'n',
  micro: 'µ',
  milli: 'm',
  centi: 'c',
  deci: 'd',
  kilo: 'k',
  mega: 'M',
  giga: 'G',
  tera: 'T',
  peta: 'P',
  // IEC binary prefixes — powers of 1024, conventional for memory sizes.
  kibi: 'Ki',
  mebi: 'Mi',
  gibi: 'Gi',
  tebi: 'Ti',
  pebi: 'Pi',
  percent: '%',
};

/**
 * What each scale is worth numerically.
 *
 * This is data *about* scales, not a licence to transform: nothing in this file
 * multiplies anything, and the invariant at the top of the file stands. The
 * table exists so the format layer can answer "how far is `nano` from `micro`"
 * when a column asks to choose its own scale — see `format/ladders.ts`.
 *
 * Deliberately narrower than `SCALE_SHORT`: a scale may be labelled without
 * being measurable. An unregistered scale still composes into a header, it just
 * cannot auto-scale. Note `centi` and `percent` share a magnitude and differ
 * only in symbol, which is why scales are named rather than written as numbers.
 */
const SCALE_FACTOR: Record<string, number> = {
  femto: 1e-15,
  pico: 1e-12,
  nano: 1e-9,
  micro: 1e-6,
  milli: 1e-3,
  centi: 1e-2,
  deci: 1e-1,
  kilo: 1e3,
  mega: 1e6,
  giga: 1e9,
  tera: 1e12,
  peta: 1e15,
  kibi: 2 ** 10,
  mebi: 2 ** 20,
  gibi: 2 ** 30,
  tebi: 2 ** 40,
  pebi: 2 ** 50,
  percent: 1e-2,
};

/**
 * Units that are a multiple of a base unit rather than a scaled one. Time is
 * the reason this exists: `minute` is 60 seconds, which no SI prefix expresses.
 */
const UNIT_FACTOR: Record<string, number> = {
  minute: 60,
  hour: 3600,
  day: 86400,
  week: 604800,
};

export function scaleFactor(scale: string): number | undefined {
  return SCALE_FACTOR[scale];
}

export function unitFactor(unit: string): number | undefined {
  return UNIT_FACTOR[unit];
}

/**
 * What one stored value is worth in the column's base unit, from its declared
 * `unit` and `scale` — so a column of nanoseconds reports `1e-9`. This is the
 * point a ladder scales *from*; the declared scale is the starting position,
 * never something the ladder overrides.
 *
 * `undefined` means "not measurable", and the caller must then decline to
 * auto-scale rather than guess: a compound or multi-factor unit (`tok/s`, `m²`)
 * has no single magnitude, and an unregistered scale name has no magnitude at
 * all — both remain perfectly good *labels*.
 */
export function storedMagnitude(
  meta: ColumnMeta | undefined,
): number | undefined {
  if (!meta) return undefined;
  const factors = Math.max(meta.unit?.length ?? 0, meta.scale?.length ?? 0);
  if (factors > 1) return undefined;

  const unit = meta.unit?.[0] ?? null;
  const scale = meta.scale?.[0] ?? null;
  if (unit === null && scale === null) return undefined;
  // An inverted factor (`1/second`) is a rate, not a magnitude to scale along.
  if (unit?.startsWith('1/')) return undefined;

  const scalePart = scale === null ? 1 : SCALE_FACTOR[scale];
  if (scalePart === undefined) return undefined;
  const unitPart = unit === null ? 1 : (UNIT_FACTOR[unit] ?? 1);
  return scalePart * unitPart;
}

// --- normalization ----------------------------------------------------------

/**
 * Default category: numeric columns are data, everything else (strings, JSON,
 * all-null) indexes the table. Falls straight out of the existing type inference.
 */
export function deduceCategory(type: ColumnType): ColumnCategory {
  return isNumericType(type) ? 'data' : 'index';
}

const INVERSE = '1/';
const UNIT_FIELDS: UnitField[] = [
  'kind',
  'unit',
  'unitShort',
  'scale',
  'scaleShort',
];

/** Coerce a scalar/array/absent field into an array (or undefined). */
function toArray(v: string | (string | null)[] | undefined) {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

/** Split a `1/x` entry into its inversion flag and base name. */
function splitInverse(entry: string): { inverted: boolean; base: string } {
  return entry.startsWith(INVERSE)
    ? { inverted: true, base: entry.slice(INVERSE.length) }
    : { inverted: false, base: entry };
}

/** Look a name up in a shortname table, preserving any `1/` prefix. */
function shortOf(entry: string | null, table: Record<string, string>) {
  if (!entry) return null;
  const { inverted, base } = splitInverse(entry);
  const short = table[base] ?? base;
  return inverted ? INVERSE + short : short;
}

/** Pad (or trim) an array to `n` entries, normalizing blanks to null. */
function pad(
  arr: (string | null)[] | undefined,
  n: number,
): (string | null)[] | undefined {
  if (!arr) return undefined;
  const out: (string | null)[] = [];
  for (let i = 0; i < n; i++) out.push(arr[i] || null);
  return out;
}

/** Drop an array field entirely when it carries no information. */
function orUndefined(arr: (string | null)[] | undefined) {
  return arr && arr.some((v) => v !== null) ? arr : undefined;
}

/**
 * Merge caller-provided metadata over the deduced base and normalize the result:
 * scalars become arrays, ragged arrays are padded to the common factor count,
 * and missing shortnames are filled from `UNIT_SHORT` / `SCALE_SHORT`.
 *
 * Idempotent — a normalized `ColumnMeta` is itself valid input.
 */
export function normalizeMeta(
  base: Pick<ColumnMeta, 'dataName' | 'type' | 'category'>,
  input: ColumnMetaInput = {},
): ColumnMeta {
  const arrays = {} as Record<UnitField, (string | null)[] | undefined>;
  let factors = 0;
  for (const field of UNIT_FIELDS) {
    const arr = toArray(input[field]);
    arrays[field] = arr;
    if (arr) factors = Math.max(factors, arr.length);
  }

  const kind = pad(arrays.kind, factors);
  const unit = pad(arrays.unit, factors);
  const scale = pad(arrays.scale, factors);

  // Each missing shortname is filled from its long name, per factor.
  const unitShort: (string | null)[] = [];
  const scaleShort: (string | null)[] = [];
  for (let i = 0; i < factors; i++) {
    unitShort.push(
      arrays.unitShort?.[i] || shortOf(unit?.[i] ?? null, UNIT_SHORT),
    );
    scaleShort.push(
      arrays.scaleShort?.[i] || shortOf(scale?.[i] ?? null, SCALE_SHORT),
    );
  }

  const meta: ColumnMeta = {
    dataName: base.dataName,
    displayName: input.displayName ?? base.dataName,
    type: input.type ?? base.type,
    category: input.category ?? base.category,
  };
  if (input.encoding) meta.encoding = input.encoding;

  const fields: [UnitField, (string | null)[] | undefined][] = [
    ['kind', orUndefined(kind)],
    ['unit', orUndefined(unit)],
    ['unitShort', orUndefined(unitShort)],
    ['scale', orUndefined(scale)],
    ['scaleShort', orUndefined(scaleShort)],
  ];
  for (const [name, value] of fields) if (value) meta[name] = value;
  // A declared encoding says the column holds instants, so the kind follows
  // unless the caller named one.
  if (meta.encoding && !meta.kind) meta.kind = [ColumnKind.Timestamp];
  return meta;
}

// --- derived labels ---------------------------------------------------------

export interface UnitLabels {
  /** The composed label, e.g. `ktok/s`, `m²`, `MB`, `%`. Empty when unitless. */
  full: string;
  /** True for exactly one factor, un-inverted, at exponent 1. */
  simple: boolean;
  /** Scale half of a `simple` label (`m` of `ms`); empty otherwise. */
  scalePart: string;
  /** Unit half of a `simple` label (`s` of `ms`); empty otherwise. */
  unitPart: string;
  /** True when the label leads the number instead of trailing it ($12.50).
   * Locale-derived for currencies: `$1.00`, but `1,00 €` in de-DE. */
  prefix: boolean;
  /** True when the label hugs the number ($12.50, 45.6%) rather than standing
   * off it (15467 MB). */
  tight: boolean;
  /**
   * True when the scale and unit halves are written apart: `M download`. A
   * symbol takes its scale directly (`MB`, `ktok`), but a unit with no short
   * form is shown as its name, and `Mdownload` reads as one misspelt word.
   */
  spaced: boolean;
}

interface Factor {
  scale: string;
  unit: string;
  inverted: boolean;
  exponent: number;
  /** Scale and unit are written apart: see `UnitLabels.spaced`. */
  spaced: boolean;
}

const SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

function superscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUPERSCRIPTS[Number(d)] ?? d)
    .join('');
}

/**
 * Read the parallel arrays into merged factors: identical factors collapse into
 * an exponent, preserving first-seen order.
 */
function factorsOf(
  units: (string | null)[] | undefined,
  scales: (string | null)[] | undefined,
  longUnits?: (string | null)[],
): Factor[] {
  const count = Math.max(units?.length ?? 0, scales?.length ?? 0);
  const byKey = new Map<string, Factor>();
  const out: Factor[] = [];
  for (let i = 0; i < count; i++) {
    const u = splitInverse(units?.[i] ?? '');
    const s = splitInverse(scales?.[i] ?? '');
    if (!u.base && !s.base) continue;
    const inverted = u.inverted || s.inverted;
    const key = `${inverted ? '/' : ''}${s.base}|${u.base}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.exponent++;
      continue;
    }
    const factor: Factor = {
      scale: s.base,
      unit: u.base,
      inverted,
      exponent: 1,
      // A unit shown under its own long name is a word, not a symbol.
      spaced:
        !!s.base &&
        !!u.base &&
        splitInverse(longUnits?.[i] ?? '').base === u.base,
    };
    byKey.set(key, factor);
    out.push(factor);
  }
  return out;
}

/** Render merged factors as `num/den`, with superscripts for powers. */
function compose(factors: Factor[]): string {
  const term = (f: Factor) =>
    f.scale +
    (f.spaced ? ' ' : '') +
    f.unit +
    (f.exponent > 1 ? superscript(f.exponent) : '');
  const num = factors
    .filter((f) => !f.inverted)
    .map(term)
    .join('·');
  const den = factors
    .filter((f) => f.inverted)
    .map(term)
    .join('·');
  if (!den) return num;
  return `${num || '1'}/${den}`;
}

const EMPTY_LABELS: UnitLabels = {
  full: '',
  simple: false,
  scalePart: '',
  unitPart: '',
  prefix: false,
  tight: false,
  spaced: false,
};

const labelCache = new Map<string, WeakMap<ColumnMeta, UnitLabels>>();

/**
 * The composed unit label for a column, memoized per meta object so the render
 * path never re-parses the parallel arrays.
 */
export function unitLabels(
  meta: ColumnMeta | undefined,
  locale?: string,
): UnitLabels {
  if (!meta) return EMPTY_LABELS;
  const key = locale ?? '';
  let perLocale = labelCache.get(key);
  if (!perLocale) labelCache.set(key, (perLocale = new WeakMap()));
  const cached = perLocale.get(meta);
  if (cached) return cached;

  const factors = factorsOf(meta.unitShort, meta.scaleShort, meta.unit);
  const only = factors.length === 1 ? factors[0]! : undefined;
  const simple = !!only && !only.inverted && only.exponent === 1;
  // A currency's placement comes from the locale; otherwise the symbol itself
  // decides. Compound units always trail with a space.
  const currency = simple ? columnCurrency(meta, locale) : undefined;
  const prefix = currency?.prefix ?? false;

  // `UNIT_SHORT` carries symbols for the handful of currencies that are always
  // written the same way, and `shortOf` leaves the rest as their long name —
  // `franc1234.50`. But the symbol is a *locale* fact, which is why it cannot
  // live in that table at all (`$` in en-US, `US$` in en-CA), and `Intl` has
  // already told us this one. Only fills the gap: an explicit `unitShort`, or
  // one the table answered, still wins.
  const declared = simple ? (meta.unit?.[0] ?? null) : null;
  const unitPart = simple
    ? currency && only.unit === declared
      ? currency.symbol
      : only.unit
    : '';
  const scalePart = simple ? only.scale : '';
  // A currency is written by its symbol, which takes the scale directly.
  const spaced = simple && only.spaced && !currency;

  // A leading symbol keeps the scale on the far side of the digits — `$300k`,
  // not `k$300` — so the composed label has to agree: `$k`, so that a header
  // reading `Net worth ($k)` describes the values under it.
  const full = !simple
    ? compose(factors)
    : prefix
      ? unitPart + scalePart
      : scalePart + (spaced ? ' ' : '') + unitPart;

  const labels: UnitLabels = {
    full,
    simple,
    scalePart,
    unitPart,
    prefix,
    tight: prefix || (simple && SYMBOL_TIGHT.has(full)),
    spaced,
  };
  perLocale.set(meta, labels);
  return labels;
}

/**
 * Layer raw metadata over existing metadata. Overriding a source field drops
 * the shortname derived from it, so re-declaring a `mega`/`byte` column as
 * `{ unit: 'second' }` re-derives `s` instead of keeping a stale `B`. An
 * explicitly supplied shortname always survives.
 */
export function mergeMeta(
  base: ColumnMeta | undefined,
  override: ColumnMetaInput | undefined,
): ColumnMetaInput | undefined {
  if (!base || !override) return override ?? base;
  const merged: ColumnMetaInput = { ...base, ...override };
  if (override.unit !== undefined && override.unitShort === undefined) {
    delete merged.unitShort;
  }
  if (override.scale !== undefined && override.scaleShort === undefined) {
    delete merged.scaleShort;
  }
  return merged;
}

/**
 * The currency this column is denominated in, if any — the locale facts behind
 * its symbol placement and decimal count. Only single-factor units qualify: a
 * rate like `$/h` is not itself a currency amount.
 */
export function columnCurrency(
  meta: ColumnMeta | undefined,
  locale?: string,
): CurrencyFacts | undefined {
  if (!meta) return undefined;
  // A single factor only: `$/h` is a rate, not a currency amount. The
  // shortname is tried too, so `{ unitShort: '$' }` is answered by the same
  // Intl-backed path as `{ unit: 'dollar' }` rather than a parallel table.
  const long = meta.unit?.length === 1 ? meta.unit[0] : undefined;
  const short = meta.unitShort?.length === 1 ? meta.unitShort[0] : undefined;
  return currencyFacts(long, locale) ?? currencyFacts(short, locale);
}

const kindCache = new WeakMap<ColumnMeta, string>();

/**
 * A canonical key for the column's compound dimension — `length²`,
 * `memory/duration`, `price` — suitable for switching on in custom formatters.
 */
export function kindId(meta: ColumnMeta | undefined): string {
  if (!meta) return ColumnKind.None;
  const cached = kindCache.get(meta);
  if (cached !== undefined) return cached;
  const id = compose(factorsOf(meta.kind, undefined)) || ColumnKind.None;
  kindCache.set(meta, id);
  return id;
}
