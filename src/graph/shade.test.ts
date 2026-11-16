import { describe, expect, it } from 'vitest';
import { shade } from './shade';

describe('shade', () => {
  it('runs from a pale mix to the colour itself', () => {
    expect(shade('red', 0, 3)).toBe(
      'color-mix(in oklch, red 40%, var(--pv-bg))',
    );
    expect(shade('red', 1, 3)).toBe(
      'color-mix(in oklch, red 70%, var(--pv-bg))',
    );
    expect(shade('red', 2, 3)).toBe('red');
  });

  it('is the colour itself when there is only one step', () => {
    expect(shade('red', 0, 1)).toBe('red');
  });
});
