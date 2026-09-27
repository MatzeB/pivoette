import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { CHANGE_EVENT } from './element';
import type { PivoetteEditorElement, PivoetteTableElement } from './element';

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
    pivotRows: [{ field: 'region' }],
    pivotColumns: [{ field: 'quarter' }],
    columns: [{ id: 'rev', source: 'revenue', agg: 'sum', label: 'Revenue' }],
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
        pivotRows: [{ field: 'nope' }],
        columns: [{ id: 'x', source: 'ghost', agg: 'bogus' }],
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

/** Mount a table, then an editor pointed at it. */
async function mountPair() {
  const table = await mount(good);
  table.id = 'sales';
  const editor = document.createElement('pivoette-editor');
  editor.setAttribute('for', 'sales');
  await act(async () => {
    document.body.appendChild(editor);
    await Promise.resolve();
  });
  return {
    table: table as PivoetteTableElement,
    editor: editor as PivoetteEditorElement,
  };
}

describe('editing', () => {
  it('announces each change and folds it into the bundle', async () => {
    const el = (await mount(good)) as PivoetteTableElement;
    const seen: unknown[] = [];
    el.addEventListener(CHANGE_EVENT, (e) =>
      seen.push((e as CustomEvent).detail.view),
    );
    const next = { ...el.view!, pivotColumns: [] };
    await act(async () => {
      el.view = next;
    });
    expect(seen).toEqual([next]);
    expect(el.bundle!.view).toBe(next);
    // The source and data are untouched.
    expect(el.bundle!.data).toEqual(good.data);
    await unmount(el);
  });

  it('shows the edit controls only when editable', async () => {
    const el = await mount(good);
    const removable = () =>
      el.shadowRoot!.querySelectorAll('button[title^="Remove"]').length;
    expect(removable()).toBe(0);
    await act(async () => el.setAttribute('editable', ''));
    expect(removable()).toBeGreaterThan(0);
    await unmount(el);
  });

  it("lists the table's fields in an editor that names it", async () => {
    const { table, editor } = await mountPair();
    expect(editor.table).toBe(table);
    const text = editor.shadowRoot!.textContent ?? '';
    expect(text).toContain('region');
    expect(text).toContain('quarter');
    await unmount(editor);
    await unmount(table);
  });

  it('writes editor edits to the table, and table edits to the editor', async () => {
    const { table, editor } = await mountPair();
    // Remove the first pivot field from the editor panel.
    const remove = editor.shadowRoot!.querySelector<HTMLButtonElement>(
      'button[title="Remove"]',
    )!;
    await act(async () => remove.click());
    expect(table.view!.pivotRows).toEqual([]);

    await act(async () => {
      table.view = { ...table.view!, pivotColumns: [] };
    });
    expect(editor.shadowRoot!.textContent).not.toContain('quarter');
    await unmount(editor);
    await unmount(table);
  });

  it('waits for a table that is not in the page yet', async () => {
    const editor = document.createElement('pivoette-editor');
    editor.setAttribute('for', 'later');
    await act(async () => {
      document.body.appendChild(editor);
      await Promise.resolve();
    });
    expect(editor.shadowRoot!.textContent).toContain('Waiting');

    const table = await mount(good);
    await act(async () => {
      table.id = 'later';
      // MutationObserver callbacks run as microtasks.
      await Promise.resolve();
    });
    expect((editor as PivoetteEditorElement).table).toBe(table);
    expect(editor.shadowRoot!.textContent).toContain('region');
    await unmount(editor);
    await unmount(table);
  });

  it('survives being moved within the page, edits included', async () => {
    const el = (await mount(good)) as PivoetteTableElement;
    const next = { ...el.view!, pivotColumns: [] };
    await act(async () => {
      el.view = next;
    });
    const box = document.createElement('div');
    document.body.appendChild(box);
    await act(async () => {
      box.appendChild(el);
      await Promise.resolve();
    });
    expect(el.shadowRoot!.querySelector('table')).toBeTruthy();
    expect(el.view).toBe(next);
    await unmount(el);
    box.remove();
  });
});
