import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ViewEditor } from './ViewEditor';
import type { ViewSpec } from '../pivot/spec';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const view: ViewSpec = {
  pivotRows: [{ field: 'team' }, { field: 'project' }],
  pivotColumns: [{ field: 'weekday' }],
  columns: [
    { id: 'a', source: 'x', agg: 'sum', label: 'A' },
    { id: 'b', source: 'y', agg: 'sum', label: 'B' },
  ],
};

let container: HTMLDivElement | null = null;
afterEach(() => {
  container?.remove();
  container = null;
});

async function mount(
  onChange: (next: ViewSpec) => void,
  theme?: 'auto' | 'light' | 'dark',
) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container!).render(
      <ViewEditor view={view} onViewChange={onChange} theme={theme} />,
    );
  });
  return [...container.querySelectorAll('li')] as HTMLElement[];
}

/** The panel's own root — it renders outside the table. */
const root = () => container!.firstElementChild!;

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

const fields = (axis: ViewSpec['pivotRows']) =>
  (axis ?? []).map((a) => a.field);

describe('<ViewEditor> reordering', () => {
  it('reorders within a list', async () => {
    let next: ViewSpec | undefined;
    const items = await mount((v) => (next = v as ViewSpec));
    await drag(items[1]!, items[0]!);
    expect(fields(next!.pivotRows)).toEqual(['project', 'team']);
  });

  it('pivots a field between the two axis lists', async () => {
    let next: ViewSpec | undefined;
    const items = await mount((v) => (next = v as ViewSpec));
    // items: team, project | weekday | A, B
    await drag(items[0]!, items[2]!);
    expect(fields(next!.pivotRows)).toEqual(['project']);
    expect(fields(next!.pivotColumns)).toEqual(['team', 'weekday']);
  });

  it('reorders columns among themselves', async () => {
    let next: ViewSpec | undefined;
    const items = await mount((v) => (next = v as ViewSpec));
    await drag(items[4]!, items[3]!);
    expect(next!.columns.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('refuses to drop a column onto an axis', async () => {
    // A measure is not a grouping field; the drop is ignored rather than
    // producing a spec that cannot mean anything.
    let next: ViewSpec | undefined;
    const items = await mount((v) => (next = v as ViewSpec));
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

  it('takes a palette, since it renders outside the table', async () => {
    // The panel sits below the table rather than inside its frame, so it
    // cannot inherit the frame's `--pv-*`; the attribute is how a host keeps
    // the two matching. `auto` is the absence of it — the media query decides.
    await mount(() => {}, 'dark');
    expect(root().getAttribute('data-theme')).toBe('dark');
    container!.remove();

    await mount(() => {}, 'auto');
    expect(root().hasAttribute('data-theme')).toBe(false);
  });

  it('does not mutate the spec it was given', async () => {
    const before = JSON.parse(JSON.stringify(view)) as ViewSpec;
    const items = await mount(() => {});
    await drag(items[1]!, items[0]!);
    expect(view).toEqual(before);
  });
});

describe('<ViewEditor> reaching every position in a list', () => {
  /** Mount an arbitrary spec, returning the panel root. */
  async function mountSpec(spec: ViewSpec, onChange: (n: ViewSpec) => void) {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container!).render(
        <ViewEditor view={spec} onViewChange={onChange} />,
      );
    });
    return container;
  }

  /** The <section> whose heading reads `title`. */
  function section(title: string): HTMLElement {
    const h = [...container!.querySelectorAll('h4')].find(
      (n) => n.textContent === title,
    )!;
    return h.parentElement as HTMLElement;
  }

  it('appends when the drop lands past the last entry', async () => {
    // A one-entry list offers a single row, and dropping *on* a row inserts
    // before it — so the end of the list was unreachable. ex3 is exactly this
    // shape: one pivot row, and no way to drop a pivot column after it.
    const spec: ViewSpec = {
      pivotRows: [{ field: 'app' }],
      pivotColumns: [{ field: 'platform' }, { field: 'revision' }],
      columns: [{ id: 'm', source: 't', agg: 'mean' }],
    };
    let next: ViewSpec | undefined;
    await mountSpec(spec, (v) => (next = v));
    const platform = [...container!.querySelectorAll('li')].find((l) =>
      l.textContent?.includes('platform'),
    )!;
    await drag(platform, section('Pivot rows'));
    expect(next!.pivotRows!.map((a) => a.field)).toEqual(['app', 'platform']);
    expect(next!.pivotColumns!.map((a) => a.field)).toEqual(['revision']);
  });

  it('still inserts at the front when the drop lands on the first row', async () => {
    const spec: ViewSpec = {
      pivotRows: [{ field: 'app' }],
      pivotColumns: [{ field: 'platform' }, { field: 'revision' }],
      columns: [{ id: 'm', source: 't', agg: 'mean' }],
    };
    let next: ViewSpec | undefined;
    await mountSpec(spec, (v) => (next = v));
    const items = [...container!.querySelectorAll('li')] as HTMLElement[];
    const platform = items.find((l) => l.textContent?.includes('platform'))!;
    const app = items.find((l) => l.textContent?.includes('app'))!;
    await drag(platform, app);
    expect(next!.pivotRows!.map((a) => a.field)).toEqual(['platform', 'app']);
  });

  it('accepts a drop into a list that has no entries at all', async () => {
    // ex4 declares no `pivotColumns`, so that section renders a placeholder
    // and had no drop target of any kind — nothing could be pivoted across.
    const spec: ViewSpec = {
      pivotRows: [{ field: 'team' }, { field: 'project' }],
      columns: [{ id: 'm', source: 't', agg: 'sum' }],
    };
    let next: ViewSpec | undefined;
    await mountSpec(spec, (v) => (next = v));
    const team = [...container!.querySelectorAll('li')].find((l) =>
      l.textContent?.includes('team'),
    )!;
    await drag(team, section('Pivot columns'));
    expect(next!.pivotColumns!.map((a) => a.field)).toEqual(['team']);
    expect(next!.pivotRows!.map((a) => a.field)).toEqual(['project']);
  });

  it('lets a row reach the end of its own list', async () => {
    let next: ViewSpec | undefined;
    const items = await mount((v) => (next = v as ViewSpec));
    // items: team, project | weekday | A, B
    await drag(items[0]!, section('Pivot rows'));
    expect(next!.pivotRows!.map((a) => a.field)).toEqual(['project', 'team']);
  });
});
