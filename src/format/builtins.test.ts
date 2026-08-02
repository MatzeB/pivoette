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
    for (const name of Object.values(Format)) {
      expect(() => resolveFormat({ name }), name).not.toThrow();
    }
  });

  it('every Style value resolves', () => {
    for (const name of Object.values(Style)) {
      expect(() => resolveStyle({ name }), name).not.toThrow();
    }
  });

  it('every Render value resolves', () => {
    for (const name of Object.values(Render)) {
      expect(() => resolveRender({ name }), name).not.toThrow();
    }
  });

  it('fails loudly on an unregistered name', () => {
    expect(() => resolveFormat({ name: 'nope' })).toThrow(/Unknown format/);
  });
});
