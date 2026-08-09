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
 * It renders HTML rather than SVG text and portals itself beneath the plot, so
 * it can be written among the marks — `<Legend/>` next to `<LineSeries/>` — and
 * still land in normal flow where it belongs.
 */
import { createPortal } from 'react-dom';
import { useGraph, useLayers } from './context';
import styles from './Graph.module.css';

export interface LegendProps {
  /** Show it even for a single series. */
  always?: boolean;
}

export function Legend({ always = false }: LegendProps) {
  const { data, colorOf } = useGraph();
  const { below } = useLayers();

  if (!below) return null;
  if (data.series.length < 2 && !always) return null;

  return createPortal(
    <div className={styles.legend}>
      {data.series.map((series) => (
        <span key={series.key} className={styles.legendItem}>
          <span
            className={styles.swatch}
            style={{ background: colorOf(series.index) }}
          />
          {series.label}
        </span>
      ))}
    </div>,
    below,
  );
}
