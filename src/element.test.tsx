import { describe, expect, it } from 'vitest';
import { act } from 'react';
import './element';

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** Remove an element and let its deferred unmount run inside the test. */
async function unmount(el: HTMLElement) {
  await act(async () => {
    el.remove();
    await Promise.resolve();
  });
}

/** Mount `<pivoette-table>` with an inline bundle and let it settle. */
async function mount(bundle: unknown) {
  const el = document.createElement('pivoette-table');
  const script = document.createElement('script');
  script.type = 'application/json';
  script.textContent = JSON.stringify(bundle);
  el.appendChild(script);
  await act(async () => {
    document.body.appendChild(el);
    // The load is async even for an inline bundle.
    await Promise.resolve();
  });
  return el;
}

const good = {
  data: { csv: 'region,quarter,revenue\nEU,Q1,120\nUS,Q1,340\n' },
  meta: { revenue: { kind: ['price'], unit: ['dollar'] } },
  view: {
    rows: ['region'],
    columns: ['quarter'],
    values: [{ id: 'rev', field: 'revenue', agg: 'sum', label: 'Revenue' }],
  },
};

describe('<pivoette-table>', () => {
  it('registers itself on import', () => {
    expect(customElements.get('pivoette-table')).toBeTruthy();
  });

  it('renders a bundle into a shadow root', async () => {
    const el = await mount(good);
    const text = el.shadowRoot!.textContent ?? '';
    // A single measure under a column axis gets no header of its own, so the
    // headers here are the row field and the column members.
    expect(text).toContain('region');
    expect(text).toContain('Q1');
    // Inside a shadow root, so the host page's CSS cannot reach it.
    expect(el.shadowRoot!.querySelector('table')).toBeTruthy();
    await unmount(el);
  });

  it('reports a bad spec instead of rendering nothing', async () => {
    const el = await mount({
      data: { csv: 'a\n1\n' },
      view: {
        rows: ['nope'],
        columns: [],
        values: [{ id: 'x', field: 'ghost', agg: 'bogus' }],
      },
    });
    const text = el.shadowRoot!.textContent ?? '';
    expect(text).toContain('problems');
    expect(text).toContain('no column named "nope"');
    expect(text).toContain('unknown agg "bogus"');
    await unmount(el);
  });

  it('reports a missing bundle', async () => {
    const el = document.createElement('pivoette-table');
    await act(async () => {
      document.body.appendChild(el);
      await Promise.resolve();
    });
    expect(el.shadowRoot!.textContent).toContain('src');
    await unmount(el);
  });
});
