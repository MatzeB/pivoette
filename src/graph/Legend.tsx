/**
 * The series key.
 *
 * Not optional chrome. Three of the light-mode series colours sit below 3:1
 * against the surface, so asking a reader to match a faint line to a remembered
 * hue is asking for something the contrast does not support — and that is
 * before colour-vision deficiency is considered at all. The swatch beside the
 * name is the channel that always works.
 *
 * A single series needs none: there is one colour, and the chart's own heading
 * already says what it is. A box with one row in it restates the title.
 *
 * Shaded series — a hue per group, a shade per step within it — get a key in
 * two parts instead: each group once, with its shades side by side, and then
 * the steps named once against a neutral ramp. Six entries reading `FooCC ·
 * base`, `FooCC · LTO+PGO`, … would say the same thing twice over.
 *
 * It renders HTML rather than SVG text and portals itself beneath the plot, so
 * it can be written among the marks — `<Legend/>` next to `<LineSeries/>` — and
 * still land in normal flow where it belongs.
 */
import { createPortal } from 'react-dom';
import { useGraph, useLayers } from './context';
import type { Series } from './series';
import { shade } from './shade';
import styles from './Graph.module.css';

export interface LegendProps {
  /** Show it even for a single series. */
  always?: boolean;
}

export function Legend({ always = false }: LegendProps) {
  const { data, seriesColor } = useGraph();
  const { below } = useLayers();

  if (!below) return null;
  if (data.series.length < 2 && !always) return null;

  const grouped = data.series.every((s) => s.group);
  if (grouped) {
    const groups = new Map<string, Series[]>();
    const steps: string[] = [];
    for (const series of data.series) {
      const { label, shade: step } = series.group!;
      groups.set(label, [...(groups.get(label) ?? []), series]);
      if (!steps.includes(step)) steps.push(step);
    }
    return createPortal(
      <div className={styles.legend}>
        {[...groups].map(([label, members]) => (
          <span key={label} className={styles.legendItem}>
            {label}
            <span className={styles.ramp}>
              {members.map((s) => (
                <span
                  key={s.key}
                  className={styles.block}
                  title={s.label}
                  style={{ background: seriesColor(s) }}
                />
              ))}
            </span>
          </span>
        ))}
        {/* The steps, named once, against a ramp in ink: whichever group a
            reader is looking at, the step is the shade's position. */}
        <span className={styles.legendSteps}>
          {steps.map((step, i) => (
            <span key={step} className={styles.legendItem}>
              <span
                className={styles.block}
                style={{
                  background: shade('var(--pv-muted)', i, steps.length),
                }}
              />
              {step}
            </span>
          ))}
        </span>
      </div>,
      below,
    );
  }

  return createPortal(
    <div className={styles.legend}>
      {data.series.map((series) => (
        <span key={series.key} className={styles.legendItem}>
          <span
            className={styles.swatch}
            style={{ background: seriesColor(series) }}
          />
          {series.label}
        </span>
      ))}
    </div>,
    below,
  );
}
