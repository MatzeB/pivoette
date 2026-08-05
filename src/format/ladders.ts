/**
 * Scale ladders: the missing third job.
 *
 * Presenting a measured number takes three decisions — *which* magnitude to
 * show it in, *converting* it, and *labelling* it. The last two already have
 * homes: `ColumnDef.factor` converts, and `unit`/`scale` metadata labels, which
 * is what the unit-placement toggles move around. Choosing the magnitude had no
 * home at all, so formatters that needed one did all three privately and their
 * unit became characters inside a string that nothing else could see or move.
 *
 * A ladder does only the choosing. It reports a step; the caller converts with
 * the step's factor and labels from the step's `scale`/`unit` through the same
 * metadata path every other column uses.
 */
import {
  normalizeMeta,
  scaleFactor,
  storedMagnitude,
  unitFactor,
} from '../data/meta';
import type { ColumnMeta } from '../data/meta';
import { asNumber } from '../util';
import type { CellValue } from '../data/types';

/** One rung: a unit to display in, and how big it is. */
export interface ScaleStep {
  /**
   * Size of one displayed unit, in the column's base unit. For a duration
   * whose base is the second, `milli` is `1e-3` and `minute` is `60`.
   */
  magnitude: number;
  /** Scale name for the label, e.g. `'micro'`. Absent means unscaled. */
  scale?: string;
  /** Unit name, when the step changes the unit itself (`minute`, `hour`). */
  unit?: string;
}

export interface Ladder {
  /** Rungs in ascending magnitude. */
  steps: ScaleStep[];
}

const registry = new Map<string, Ladder>();

/**
 * Register a ladder, or replace one. Ladders are a public extension point in
 * the same way formats and aggregations are: the built-ins cover the common
 * cases and anything else is a few lines of data.
 */
export function registerLadder(id: string, ladder: Ladder): void {
  const steps = [...ladder.steps].sort((a, b) => a.magnitude - b.magnitude);
  registry.set(id, { steps });
}

export function getLadder(id: string): Ladder {
  const ladder = registry.get(id);
  if (!ladder) throw new Error(`Unknown scale ladder "${id}"`);
  return ladder;
}

export function hasLadder(id: string): boolean {
  return registry.has(id);
}

export function ladderIds(): string[] {
  return [...registry.keys()];
}

/** SI prefixes, from a named scale to its step. */
function siStep(scale: string): ScaleStep {
  return { magnitude: scaleFactor(scale)!, scale };
}

/**
 * Decimal SI prefixes around the base unit. The default for anything measured:
 * tokens, watts, hertz, requests, metres.
 */
registerLadder('si', {
  steps: [
    siStep('femto'),
    siStep('pico'),
    siStep('nano'),
    siStep('micro'),
    siStep('milli'),
    { magnitude: 1 },
    siStep('kilo'),
    siStep('mega'),
    siStep('giga'),
    siStep('tera'),
    siStep('peta'),
  ],
});

/**
 * Time. Sub-second rungs are SI prefixes, but minutes and hours are not — 60×
 * and 3600× are no prefix at all, which is exactly why a ladder is data rather
 * than a formula over `SCALE_FACTOR`.
 */
registerLadder('duration', {
  steps: [
    siStep('nano'),
    siStep('micro'),
    siStep('milli'),
    { magnitude: 1 },
    { magnitude: unitFactor('minute')!, unit: 'minute' },
    { magnitude: unitFactor('hour')!, unit: 'hour' },
    { magnitude: unitFactor('day')!, unit: 'day' },
  ],
});

/**
 * IEC binary prefixes, for sizes conventionally counted in powers of 1024.
 * Kept separate from `si` because a column is one or the other — mixing `kB`
 * and `KiB` in one ladder would make the choice arbitrary.
 */
registerLadder('bytes', {
  steps: [
    { magnitude: 1 },
    siStep('kibi'),
    siStep('mebi'),
    siStep('gibi'),
    siStep('tebi'),
    siStep('pebi'),
  ],
});

/** The ladder a column gets when it asks for one without naming it. */
export function defaultLadder(meta: ColumnMeta | undefined): string {
  const kind = meta?.kind?.[0];
  if (kind === 'duration') return 'duration';
  if (kind === 'memory') return 'bytes';
  return 'si';
}

/**
 * How far down the column the scale is chosen from.
 *
 * Falling off the two ends of `[1, 1000)` is not symmetrical: `0.011` hides its
 * precision behind leading zeros and has to be read digit by digit, while
 * `11,000` is merely longer and every digit still counts. So the scale protects
 * the small values and lets the large ones grow — a low quantile rather than
 * the middle.
 *
 * Not the minimum, which a single tiny outlier would drag the whole column
 * down to. The quartile is what keeps this robust at both ends.
 */
const PICK_QUANTILE = 0.25;

/**
 * The value a column's scale is chosen for. Zeroes carry no magnitude and are
 * skipped; a column of nothing but zeroes has no basis to choose on.
 */
export function representative(values: CellValue[]): number | undefined {
  const magnitudes: number[] = [];
  for (const v of values) {
    const n = asNumber(v);
    if (n !== null && n !== 0 && Number.isFinite(n)) {
      magnitudes.push(Math.abs(n));
    }
  }
  if (magnitudes.length === 0) return undefined;
  magnitudes.sort((a, b) => a - b);
  const at = Math.floor(magnitudes.length * PICK_QUANTILE);
  return magnitudes[Math.min(at, magnitudes.length - 1)];
}

/**
 * Pick the rung that puts the representative value in `[1, 1000)` — the
 * conventional reading range, and the same rule as "the largest step the value
 * still exceeds". Falls off either end onto the outermost rung rather than
 * inventing one.
 *
 * `values` are in stored units; `meta` says what those are worth. Returns
 * `undefined` when the column is not measurable at all, which is the caller's
 * signal to leave it alone.
 */
export function chooseStep(
  values: CellValue[],
  meta: ColumnMeta | undefined,
  ladderId: string,
): { step: ScaleStep; factor: number } | undefined {
  const stored = storedMagnitude(meta);
  if (stored === undefined) return undefined;
  const rep = representative(values);
  if (rep === undefined) return undefined;

  const { steps } = getLadder(ladderId);
  if (steps.length === 0) return undefined;

  const base = rep * stored; // the representative value, in base units
  let chosen = steps[0]!;
  for (const step of steps) {
    if (base >= step.magnitude) chosen = step;
  }
  return { step: chosen, factor: stored / chosen.magnitude };
}

/**
 * The metadata a column presents once a step is chosen: its own, with the
 * step's scale and unit swapped in.
 *
 * A *new* object every time — `unitLabels` memoizes against meta identity, so
 * mutating in place would keep returning the label the column had before.
 */
export function metaForStep(meta: ColumnMeta, step: ScaleStep): ColumnMeta {
  const changesUnit = step.unit !== undefined;
  return normalizeMeta(meta, {
    ...meta,
    scale: [step.scale ?? null],
    unit: changesUnit ? [step.unit!] : meta.unit,
    // Dropped so `normalizeMeta` re-derives them from the new long names —
    // the shorts carried over from the old scale would otherwise win.
    scaleShort: undefined,
    unitShort: changesUnit ? undefined : meta.unitShort,
  });
}
