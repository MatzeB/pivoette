/**
 * Shades of one colour, for series that form an ordered progression.
 *
 * Mixed towards the page background rather than towards white, so one rule
 * serves both themes: in light mode the early steps are pale, in dark mode
 * they are dim, and in both the last step is the colour itself. `oklch` keeps
 * the steps even to the eye, where mixing in sRGB bunches them at one end.
 */

/** More steps than this stop being told apart in a thin bar. */
export const MAX_SHADES = 4;

/**
 * How much of the colour the palest step keeps. Not lower: the palest bar
 * still has to read as a bar against the background, and its hue as the
 * group's.
 */
const PALEST = 0.4;

/** Step `index` of `count`, palest first, as a CSS colour. */
export function shade(base: string, index: number, count: number): string {
  if (count <= 1 || index >= count - 1) return base;
  const amount = PALEST + ((1 - PALEST) * index) / (count - 1);
  const pct = Math.round(amount * 100);
  return `color-mix(in oklch, ${base} ${pct}%, var(--pv-bg))`;
}
