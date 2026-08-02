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
 * column's kind: `$` leads and hugs, `%` trails and hugs, `MB` trails with a
 * space. Currencies `Intl` recognises get their placement from the locale
 * instead (see `columnCurrency`); these sets cover metadata that supplies a
 * bare symbol with no resolvable unit name.
 */
const SYMBOL_PREFIX = new Set(['$', '€', '£', '¥', '₹', '₩', '¤']);
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

  const fields: [UnitField, (string | null)[] | undefined][] = [
    ['kind', orUndefined(kind)],
    ['unit', orUndefined(unit)],
    ['unitShort', orUndefined(unitShort)],
    ['scale', orUndefined(scale)],
    ['scaleShort', orUndefined(scaleShort)],
  ];
  for (const [name, value] of fields) if (value) meta[name] = value;
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
}

interface Factor {
  scale: string;
  unit: string;
  inverted: boolean;
  exponent: number;
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
    };
    byKey.set(key, factor);
    out.push(factor);
  }
  return out;
}

/** Render merged factors as `num/den`, with superscripts for powers. */
function compose(factors: Factor[]): string {
  const term = (f: Factor) =>
    f.scale + f.unit + (f.exponent > 1 ? superscript(f.exponent) : '');
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

  const factors = factorsOf(meta.unitShort, meta.scaleShort);
  const only = factors.length === 1 ? factors[0]! : undefined;
  const simple = !!only && !only.inverted && only.exponent === 1;
  const full = compose(factors);
  // A currency's placement comes from the locale; otherwise the symbol itself
  // decides. Compound units always trail with a space.
  const prefix =
    simple &&
    (columnCurrency(meta, locale)?.prefix ?? SYMBOL_PREFIX.has(only.unit));
  const labels: UnitLabels = {
    full,
    simple,
    scalePart: simple ? only.scale : '',
    unitPart: simple ? only.unit : '',
    prefix,
    tight: prefix || (simple && SYMBOL_TIGHT.has(full)),
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
  if (!meta || meta.unit?.length !== 1) return undefined;
  return currencyFacts(meta.unit[0], locale);
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
