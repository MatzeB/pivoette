/**
 * Attaching a unit label to an already-formatted number.
 *
 * Trivial, and it has three callers that must not disagree: the table wraps a
 * column's formatter once (`wrapFormat`), the engine wraps per-cell text where
 * a per-value scale gives each cell its own label (`wrapLabel`), and a chart
 * wraps a tick or a readout. The same value has to read the same way in all
 * three, so the rule lives here rather than being written out a third time.
 *
 * Both facts it needs come from `unitLabels`: whether the label leads the
 * digits (locale-derived for a currency) and whether it hugs them.
 */
import type { UnitLabels } from '../data/meta';

/**
 * A label split into the two halves that behave differently.
 *
 * The split matters only when the unit *leads* the digits, which in practice
 * means a currency. `kilo` + `meter` trails as one token — `300 km` — but
 * `kilo` + `dollar` cannot: nobody writes `k$300`. The magnitude has to stay
 * with the number it multiplies, so the symbol goes in front and the scale
 * stays behind: **`$300k`**. Same reason the header form reads `($k)`.
 */
export interface UnitAffix {
  /** Rides the digits: the `k` of `$300k`, and of `300 km`. */
  scale: string;
  /** Leads or trails per `prefix`: the `$` of `$300k`, the `m` of `300 km`. */
  unit: string;
  /** The unit symbol leads the number. Locale-derived, for currencies. */
  prefix: boolean;
  /** The label hugs the digits rather than standing off with a space. */
  tight: boolean;
}

/** The affix a set of composed labels implies. */
export function affixOf(labels: UnitLabels): UnitAffix {
  // A compound label (`ktok/s`, `m²`) has no separable halves and always
  // trails, so it travels whole in the `unit` slot.
  return labels.simple
    ? {
        scale: labels.scalePart,
        unit: labels.unitPart,
        prefix: labels.prefix,
        tight: labels.tight,
      }
    : { scale: '', unit: labels.full, prefix: false, tight: labels.tight };
}

/**
 * `$300k`, `-$12.50`, `45.6%`, `15467 MB`, `300 km`.
 *
 * A leading symbol sits *inside* the sign — `-$12.50`, never `$-12.50` — and
 * leaves the scale on the far side of the digits. A trailing one takes the
 * scale with it as a single token. A `tight` label hugs the digits; the rest
 * stand off with a space. Empty text stays empty: a blank cell should not
 * become a lone unit.
 */
export function attachUnit(text: string, affix: UnitAffix): string {
  return attacherFor(affix)(text);
}

/**
 * The same rule, specialised once for an affix that will not change.
 *
 * Every caller has a natural "once" moment — a column, a ladder rung, an axis —
 * and then runs the result over every cell, tick, or label. Deciding the branch
 * and building the gap there rather than per value matters more than it looks:
 * the table's formatters run once per rendered cell *and* around two hundred
 * times per column while measuring its width.
 */
export function attacherFor(affix: UnitAffix): (text: string) => string {
  const { scale, unit, prefix, tight } = affix;
  if (!scale && !unit) return (text) => text;
  const gap = tight ? '' : ' ';
  if (!prefix) {
    const suffix = gap + scale + unit;
    return (text) => (text ? text + suffix : text);
  }
  const lead = unit + gap;
  return (text) => {
    if (!text) return text;
    const signed = text[0] === '-' || text[0] === '+';
    return signed
      ? text[0] + lead + text.slice(1) + scale
      : lead + text + scale;
  };
}
