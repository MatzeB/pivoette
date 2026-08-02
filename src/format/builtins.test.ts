import { describe, expect, it } from 'vitest';
import { Format, Render, Style } from './builtins';
import { resolveFormat } from './format';
import { resolveStyle } from './style';
import { resolveRender } from './render';

/**
 * The constants are hand-written lists of registry keys, so they can drift from
 * the registries. Resolving each one proves it is really registered.
 */
describe('built-in name constants', () => {
  it('every Format value resolves', () => {
    for (const fnName of Object.values(Format)) {
      expect(() => resolveFormat({ fnName }), fnName).not.toThrow();
    }
  });

  it('every Style value resolves', () => {
    for (const fnName of Object.values(Style)) {
      expect(() => resolveStyle({ fnName }), fnName).not.toThrow();
    }
  });

  it('every Render value resolves', () => {
    for (const fnName of Object.values(Render)) {
      expect(() => resolveRender({ fnName }), fnName).not.toThrow();
    }
  });

  it('fails loudly on an unregistered name', () => {
    expect(() => resolveFormat({ fnName: 'nope' })).toThrow(/Unknown format/);
  });
});
