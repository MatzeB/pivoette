/**
 * Compile a user-supplied JS expression into a function. The expression is
 * evaluated with the given argument names in scope and its value returned.
 *
 * Trust boundary: this uses `new Function`, so expressions run with full
 * privileges. Pivoette is a client-side tool over local, trusted data — do NOT
 * feed untrusted expression strings into a config.
 */
const cache = new Map<string, (...args: unknown[]) => unknown>();

export function compileExpression(
  src: string,
  argNames: string[],
): (...args: unknown[]) => unknown {
  const key = `${argNames.join(',')}|${src}`;
  let fn = cache.get(key);
  if (!fn) {
    try {
      fn = new Function(...argNames, `"use strict"; return (${src});`) as (
        ...args: unknown[]
      ) => unknown;
    } catch (err) {
      throw new Error(`Failed to compile expression: ${src}\n${String(err)}`);
    }
    cache.set(key, fn);
  }
  return fn;
}

/** Evaluate an expression, swallowing runtime errors into `undefined`. */
export function evalExpression(
  src: string,
  args: Record<string, unknown>,
): unknown {
  const names = Object.keys(args);
  const fn = compileExpression(src, names);
  try {
    return fn(...names.map((n) => args[n]));
  } catch {
    return undefined;
  }
}
