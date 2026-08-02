import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ViewEditor } from './ViewEditor';
import type { PivotSpec, ViewSpec } from '../pivot/spec';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const view: PivotSpec = {
  rows: ['team', 'project'],
  columns: ['weekday'],
  values: [
    { id: 'a', field: 'x', agg: 'sum', label: 'A' },
    { id: 'b', field: 'y', agg: 'sum', label: 'B' },
  ],
};

let container: HTMLDivElement | null = null;
afterEach(() => {
  container?.remove();
  container = null;
});

async function mount(onChange: (next: ViewSpec) => void) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container!).render(
      <ViewEditor view={view} onViewChange={onChange} />,
    );
  });
  return [...container.querySelectorAll('li')] as HTMLElement[];
}

/**
 * Drive an HTML5 drag by hand: jsdom has no pointer-driven drag, so the three
 * events the component listens for are dispatched directly.
 */
async function drag(from: HTMLElement, to: HTMLElement) {
  const dataTransfer = {
    effectAllowed: '',
    setData: () => {},
    getData: () => '',
  };
  const fire = (el: HTMLElement, type: string) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', { value: dataTransfer });
    el.dispatchEvent(e);
  };
  await act(async () => {
    fire(from, 'dragstart');
    fire(to, 'dragover');
    fire(to, 'drop');
  });
}

describe('<ViewEditor> reordering', () => {
  it('reorders within a list', async () => {
    let next: PivotSpec | undefined;
    const items = await mount((v) => (next = v as PivotSpec));
    await drag(items[1]!, items[0]!);
    expect(next!.rows).toEqual(['project', 'team']);
  });

  it('pivots a field between the rows and columns lists', async () => {
    let next: PivotSpec | undefined;
    const items = await mount((v) => (next = v as PivotSpec));
    // items: team, project | weekday | A, B
    await drag(items[0]!, items[2]!);
    expect(next!.rows).toEqual(['project']);
    expect(next!.columns).toEqual(['team', 'weekday']);
  });

  it('reorders measures among themselves', async () => {
    let next: PivotSpec | undefined;
    const items = await mount((v) => (next = v as PivotSpec));
    await drag(items[4]!, items[3]!);
    expect(next!.values.map((v) => v.id)).toEqual(['b', 'a']);
  });

  it('refuses to drop a measure onto an axis', async () => {
    // A measure is not a grouping field; the drop is ignored rather than
    // producing a spec that cannot mean anything.
    let next: PivotSpec | undefined;
    const items = await mount((v) => (next = v as PivotSpec));
    await drag(items[3]!, items[0]!);
    expect(next).toBeUndefined();
  });

  it('offers removal as the only button', async () => {
    const items = await mount(() => {});
    expect(items.length).toBeGreaterThan(0);
    const titles = [...container!.querySelectorAll('button')].map(
      (b) => b.title,
    );
    expect(new Set(titles)).toEqual(new Set(['Remove']));
  });

  it('does not mutate the spec it was given', async () => {
    const before = JSON.parse(JSON.stringify(view)) as PivotSpec;
    const items = await mount(() => {});
    await drag(items[1]!, items[0]!);
    expect(view).toEqual(before);
  });
});
