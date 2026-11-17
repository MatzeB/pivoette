import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { installTestDom } from '../test-dom';
import { fromRows } from '../data/import';
import { resolveRender } from './render';
import type { CellCtx } from './context';

installTestDom();

const frame = fromRows([{ x: 1 }]);
const ctx = (
  value: unknown,
  inputs: Record<string, unknown> = {},
  text?: string,
): CellCtx => ({
  value,
  inputs,
  rowPath: [],
  colPath: [],
  column: { id: 'c', label: 'c', align: 'right' },
  frame,
  text,
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
async function draw(node: ReactNode): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<>{node}</>));
  return host;
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('bar', () => {
  const bar = resolveRender({
    fnName: 'bar',
    options: { center: 1, span: 0.25, threshold: 0.02 },
  })!;
  const fill = (el: HTMLElement) => el.querySelector('i')!;

  it('grows right from the centre for a value above it', async () => {
    const el = await draw(bar(ctx(1.125, {}, '1.125')));
    expect(el.textContent).toBe('1.125');
    const i = fill(el);
    expect(i.style.left).toBe('50%');
    expect(i.style.width).toBe('25%');
    expect(i.className).toMatch(/better/);
  });

  it('grows left, in the other colour, for a value below it', async () => {
    const i = fill(await draw(bar(ctx(0.875, {}, '0.875'))));
    expect(i.style.left).toBe('25%');
    expect(i.style.width).toBe('25%');
    expect(i.className).toMatch(/worse/);
  });

  it('clamps past the span, and marks the bar as clamped', async () => {
    const i = fill(await draw(bar(ctx(2, {}, '2'))));
    expect(i.style.width).toBe('50%');
    expect(i.className).toMatch(/clamped/);
  });

  it('keeps the number quiet inside the threshold', async () => {
    const el = await draw(bar(ctx(1.01, {}, '1.01')));
    expect(el.querySelector('span span')!.className).not.toMatch(/better/);
    expect(fill(el).className).toMatch(/better/);
  });

  it('can count lower as better', async () => {
    const lower = resolveRender({
      fnName: 'bar',
      options: { center: 0, span: 10, better: 'lower' },
    })!;
    expect(fill(await draw(lower(ctx(-5, {}, '-5')))).className).toMatch(
      /better/,
    );
  });

  it('measures as its text plus the track', () => {
    expect(bar.measure!(ctx(1, {}, 'abc'), (t) => t.length * 10)).toBe(
      30 + 8 + 70,
    );
  });
});

describe('flags', () => {
  const flags = resolveRender({
    fnName: 'flags',
    options: {
      flags: [
        {
          label: 'slower',
          when: 'cycles < 0.98',
          tone: 'bad',
          title: 'Slower',
          detail: "'by ' + (1 - cycles).toFixed(2)",
        },
        { label: 'provisional', when: 'runs < 5', tone: 'warn' },
        { label: 'broken', when: 'nosuchfield.x > 1' },
      ],
    },
  })!;

  it('raises a chip per condition the row meets, with its tone and reason', async () => {
    const el = await draw(flags(ctx(null, { cycles: 0.9, runs: 3 })));
    const chips = [...el.querySelectorAll('[data-tone]')];
    expect(chips.map((c) => c.textContent)).toEqual(['slower', 'provisional']);
    expect(chips[0]!.getAttribute('data-tone')).toBe('bad');
    expect(chips[0]!.getAttribute('title')).toBe('Slower: by 0.10');
  });

  it('draws nothing for a row that meets none, and skips a broken condition', async () => {
    const el = await draw(flags(ctx(null, { cycles: 1.1, runs: 5 })));
    expect(el.textContent).toBe('');
  });

  it('measures only the chips it raises', () => {
    const w = (t: string) => t.length * 10;
    expect(flags.measure!(ctx(null, { cycles: 1.1, runs: 5 }), w)).toBe(0);
    expect(
      flags.measure!(ctx(null, { cycles: 0.9, runs: 5 }), w),
    ).toBeGreaterThan(0);
  });
});
