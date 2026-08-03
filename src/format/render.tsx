/**
 * Render-function registry (Tier 3). A built-in is a factory
 * `(options) => CellRender` returning arbitrary React for the whole cell.
 */
import type { ReactNode } from 'react';
import type { CellCtx, CellRender } from './context';
import type { RenderSpec } from '../pivot/spec';
import { evalCell } from './expression';

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
