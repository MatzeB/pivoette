/**
 * Style-function registry. A built-in is a factory `(options) => StyleFn`
 * returning inline `CSSProperties` merged onto the default cell.
 */
import type { CSSProperties } from 'react';
import type { CellCtx, StyleFn } from './context';
import type { StyleSpec } from '../pivot/spec';
import { evalExpression } from './expression';
import { asNumber } from '../util';

type StyleFactory = (options: Record<string, unknown>) => StyleFn;

const registry = new Map<string, StyleFactory>();

/** Colour a cell by the sign of its numeric value. */
registry.set('signColors', (options) => {
  const positive = options.positive as string | undefined;
  const negative = options.negative as string | undefined;
  const zero = options.zero as string | undefined;
  return (ctx) => {
    const n = asNumber(ctx.value);
    if (n === null) return {};
    if (n > 0 && positive) return { color: positive };
    if (n < 0 && negative) return { color: negative };
    if (n === 0 && zero) return { color: zero };
    return {};
  };
});

/**
 * Apply the first matching rule. `rules: [{ when: <expr>, style: {...} }]`,
 * with an optional `base` style always applied first.
 */
registry.set('conditional', (options) => {
  const base = (options.base as CSSProperties) ?? {};
  const rules =
    (options.rules as { when: string; style: CSSProperties }[]) ?? [];
  return (ctx) => {
    for (const rule of rules) {
      const matched = evalExpression(rule.when, {
        value: ctx.value,
        inputs: ctx.inputs,
        row: ctx.rowPath,
        col: ctx.colPath,
        ctx,
      });
      if (matched) return { ...base, ...rule.style };
    }
    return base;
  };
});

/** Static style: the options object is used directly as CSSProperties. */
registry.set('static', (options) => {
  const style = options as CSSProperties;
  return () => style;
});

const NO_STYLE: StyleFn = () => ({});

export function resolveStyle(spec: StyleSpec | undefined): StyleFn {
  if (!spec) return NO_STYLE;
  if ('fn' in spec) return spec.fn;
  if ('expression' in spec) {
    const src = spec.expression;
    return (ctx: CellCtx) => {
      const result = evalExpression(src, {
        value: ctx.value,
        inputs: ctx.inputs,
        row: ctx.rowPath,
        col: ctx.colPath,
        ctx,
      });
      return (result as CSSProperties) ?? {};
    };
  }
  const factory = registry.get(spec.fnName);
  if (!factory) throw new Error(`Unknown style "${spec.fnName}"`);
  return factory(spec.options ?? {});
}

export function registerStyle(name: string, factory: StyleFactory): void {
  registry.set(name, factory);
}
