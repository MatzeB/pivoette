/**
 * Render-function registry (Tier 3). A built-in is a factory
 * `(options) => CellRender` returning arbitrary React for the whole cell.
 */
import type { ReactNode } from 'react';
import type { CellCtx, CellRender } from './context';
import type { RenderSpec } from '../pivot/spec';
import { evalCell, evalExpression } from './expression';
import { asNumber } from '../util';
import styles from './render.module.css';

type RenderFactory = (options: Record<string, unknown>) => CellRender;

const registry = new Map<string, RenderFactory>();

/**
 * `imageText`: a small preview image plus a text label in one cell. Reads the
 * `image` and `text` compute-inputs (aliases configurable via options).
 */
registry.set('imageText', (options) => {
  const imageKey = (options.imageKey as string) ?? 'image';
  const textKey = (options.textKey as string) ?? 'text';
  return (ctx: CellCtx): ReactNode => {
    const src = ctx.inputs[imageKey];
    const text = ctx.inputs[textKey];
    return (
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5em' }}
      >
        {src ? (
          <img
            src={String(src)}
            alt=""
            width={20}
            height={20}
            style={{ borderRadius: 3, objectFit: 'cover', flex: '0 0 auto' }}
          />
        ) : null}
        <span>{text == null ? '' : String(text)}</span>
      </span>
    );
  };
});

/**
 * `bar`: the cell's number with a mini-bar beside it, growing from a tick at
 * `center` towards the side the value is on — a ratio's distance from 1.0, or
 * a delta's from 0, readable down a long column at a glance.
 *
 * Options:
 * - `center` (default 0): the value the tick stands for.
 * - `span` (default a quarter of `center`, or 1 at 0): how far from `center`
 *   fills half the track. Beyond it the bar is clamped, with a square end to
 *   say so.
 * - `better` (default `'higher'`): which side is good news, coloured green;
 *   the other is orange. `'lower'` for times and costs.
 * - `threshold` (default 0): a band around `center` within which the number
 *   keeps the ink colour. The bar is still drawn: a small change is still a
 *   change, it is only not one the number should shout about.
 * - `width` (default 70): the track, in pixels.
 */
registry.set('bar', (options) => {
  const center = (options.center as number) ?? 0;
  const span =
    (options.span as number) ?? (center === 0 ? 1 : Math.abs(center) / 4);
  const higher = (options.better ?? 'higher') !== 'lower';
  const threshold = (options.threshold as number) ?? 0;
  const width = (options.width as number) ?? 70;
  const render: CellRender = (ctx: CellCtx): ReactNode => {
    const text = ctx.text ?? (ctx.value == null ? '' : String(ctx.value));
    const n = asNumber(ctx.value);
    if (n === null) return text;
    const delta = n - center;
    const good = higher ? delta > 0 : delta < 0;
    const tone = delta === 0 ? '' : good ? styles.better : styles.worse;
    const loud = Math.abs(delta) > threshold;
    const reach = Math.min(Math.abs(delta) / span, 1);
    const half = 50 * reach;
    return (
      <span className={styles.barCell}>
        <span className={`${styles.barText} ${loud ? tone : ''}`}>{text}</span>
        <span className={styles.track} style={{ width }} aria-hidden="true">
          {delta !== 0 && (
            <i
              className={`${styles.fill} ${tone} ${reach === 1 ? styles.clamped : ''}`}
              style={{
                left: `${delta < 0 ? 50 - half : 50}%`,
                width: `${half}%`,
              }}
            />
          )}
        </span>
      </span>
    );
  };
  render.measure = (ctx, widthOf) => widthOf(ctx.text ?? '') + 8 + width;
  return render;
});

/** One flag a `flags` cell can raise. */
export interface FlagSpec {
  /** The chip's text. */
  label: string;
  /**
   * When to raise it: an expression over the row. Each input is in scope by
   * name — in a flat view, every field of the row — so `cycles < 0.98`.
   */
  when: string;
  /**
   * How it reads: `good`, `bad` and `warn` are tinted; `accent`, `info` and
   * `strong` are outlined; anything else is a quiet grey outline.
   */
  tone?: 'good' | 'bad' | 'warn' | 'accent' | 'info' | 'strong' | 'neutral';
  /** The tooltip: why the flag is there. */
  title?: string;
  /** An expression appended to the tooltip with the row's own numbers. */
  detail?: string;
}

/**
 * `flags`: a row of small labelled chips, one per condition the row meets —
 * the column a results table keeps for "this one is noisy", "these two
 * measures disagree". Each flag is data: a label, a condition over the row,
 * a tone, and a tooltip saying why, so a reader can hover a chip and learn
 * what triggered it without reading the spec.
 *
 * The cell's own value is not used; it reads its inputs. Give the column no
 * source and it sees the whole row.
 */
registry.set('flags', (options) => {
  const flags = (options.flags as FlagSpec[]) ?? [];
  const scope = (ctx: CellCtx) => ({
    ...ctx.inputs,
    value: ctx.value,
    inputs: ctx.inputs,
    row: ctx.rowPath,
    col: ctx.colPath,
  });
  /** The flags a row raises; a condition that throws raises nothing. */
  const raised = (ctx: CellCtx) => {
    const s = scope(ctx);
    return flags.filter((f) => {
      try {
        return !!evalExpression(f.when, s);
      } catch {
        return false;
      }
    });
  };
  const titleOf = (f: FlagSpec, ctx: CellCtx) => {
    if (!f.detail) return f.title;
    let detail = '';
    try {
      detail = String(evalExpression(f.detail, scope(ctx)) ?? '');
    } catch {
      // A detail that cannot be computed for this row is left off.
    }
    return [f.title, detail].filter(Boolean).join(': ');
  };
  const render: CellRender = (ctx: CellCtx): ReactNode => {
    const on = raised(ctx);
    if (on.length === 0) return null;
    return (
      <span className={styles.flags}>
        {on.map((f) => (
          <span
            key={f.label}
            className={styles.flag}
            data-tone={f.tone ?? 'neutral'}
            title={titleOf(f, ctx)}
          >
            {f.label}
          </span>
        ))}
      </span>
    );
  };
  // Chip text runs smaller than the cell's, plus its padding and the gaps.
  render.measure = (ctx, widthOf) =>
    raised(ctx).reduce((w, f) => w + widthOf(f.label) * 0.85 + 16, 0);
  return render;
});

export function resolveRender(
  spec: RenderSpec | undefined,
): CellRender | undefined {
  if (!spec) return undefined;
  if ('fn' in spec) return spec.fn;
  if ('expression' in spec) {
    const src = spec.expression;
    return (ctx: CellCtx) => evalCell(src, ctx) as ReactNode;
  }
  const factory = registry.get(spec.fnName);
  if (!factory) throw new Error(`Unknown renderer "${spec.fnName}"`);
  return factory(spec.options ?? {});
}

export function registerRender(name: string, factory: RenderFactory): void {
  registry.set(name, factory);
}
