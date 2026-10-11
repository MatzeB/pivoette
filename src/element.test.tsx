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

/** Mount a table, then an editor pointed at it — open unless told not to. */
async function mountPair({ open = true } = {}) {
  const table = await mount(good);
  table.id = 'sales';
  const editor = document.createElement('pivoette-editor');
  editor.setAttribute('for', 'sales');
  editor.toggleAttribute('open', open);
  await act(async () => {
    document.body.appendChild(editor);
    await Promise.resolve();
  });
  return {
    table: table as PivoetteTableElement,
    editor: editor as PivoetteEditorElement,
  };
}

/** How many of its edit controls the table is showing. */
function editControls(table: HTMLElement) {
  return table.shadowRoot!.querySelectorAll('button[title^="Remove"]').length;
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
    // Gone from the lists; it is on offer in the add menus instead.
    const listed = [...editor.shadowRoot!.querySelectorAll('li')].map(
      (li) => li.textContent,
    );
    expect(listed.join()).not.toContain('quarter');
    await unmount(editor);
    await unmount(table);
  });

  it('waits for a table that is not in the page yet', async () => {
    const editor = document.createElement('pivoette-editor');
    editor.setAttribute('for', 'later');
    editor.setAttribute('open', '');
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

  it('resets to the bundle from the editor, and can hide the button', async () => {
    const { table, editor } = await mountPair();
    const reset = () =>
      [...editor.shadowRoot!.querySelectorAll('button')].find(
        (b) => b.textContent === 'Reset',
      );
    expect(reset()!.disabled).toBe(true);

    await act(async () => {
      table.view = { ...table.view!, pivotColumns: [] };
    });
    expect(table.edited).toBe(true);
    expect(reset()!.disabled).toBe(false);

    await act(async () => reset()!.click());
    expect(table.view).toEqual(good.view);
    expect(table.edited).toBe(false);
    expect(reset()!.disabled).toBe(true);

    await act(async () => editor.setAttribute('no-reset', ''));
    expect(reset()).toBeUndefined();
    await unmount(editor);
    await unmount(table);
  });

  it('stays closed, and leaves the table alone, until opened', async () => {
    const { table, editor } = await mountPair({ open: false });
    const summary = editor.shadowRoot!.querySelector('summary')!;
    expect(summary.textContent).toBe('Edit');
    // Closed, the panel's lists are not even mounted.
    expect(editor.shadowRoot!.textContent).not.toContain('quarter');
    expect(editControls(table)).toBe(0);

    await act(async () => {
      editor.open = true;
    });
    expect(editor.shadowRoot!.textContent).toContain('quarter');
    expect(editControls(table)).toBeGreaterThan(0);

    await act(async () => {
      editor.open = false;
    });
    expect(editControls(table)).toBe(0);
    await unmount(editor);
    await unmount(table);
  });

  it('keeps the table editable while any reason to remains', async () => {
    const { table, editor } = await mountPair();
    const second = document.createElement('pivoette-editor');
    second.setAttribute('for', 'sales');
    second.setAttribute('open', '');
    await act(async () => {
      document.body.appendChild(second);
      await Promise.resolve();
    });

    // Another editor is still open.
    await act(async () => {
      (editor as PivoetteEditorElement).open = false;
    });
    expect(editControls(table)).toBeGreaterThan(0);

    // Removing an open editor lets go too.
    await unmount(second);
    expect(editControls(table)).toBe(0);

    await unmount(editor);
    await unmount(table);
  });

  it('lets an attached editor overrule `editable`', async () => {
    // How pages were written before the editor could open and close.
    const { table, editor } = await mountPair({ open: false });
    await act(async () => table.setAttribute('editable', ''));
    expect(editControls(table)).toBe(0);

    await act(async () => {
      (editor as PivoetteEditorElement).open = true;
    });
    expect(editControls(table)).toBeGreaterThan(0);

    // With the editor gone, `editable` is back in charge.
    await act(async () => {
      (editor as PivoetteEditorElement).open = false;
    });
    await unmount(editor);
    expect(editControls(table)).toBeGreaterThan(0);
    await unmount(table);
  });
});

describe('the bundle property', () => {
  it('replaces the inline bundle and becomes what reset returns to', async () => {
    const el = (await mount(good)) as PivoetteTableElement;
    const flat = {
      ...good,
      data: { csv: 'region,revenue\nEU,1\n' },
      view: { columns: [{ id: 'region' }, { id: 'revenue' }] },
    };
    await act(async () => {
      el.bundle = flat;
      await Promise.resolve();
    });
    expect(el.view).toBe(flat.view);
    expect(el.shadowRoot!.textContent).not.toContain('Q1');
    expect(el.edited).toBe(false);
    await unmount(el);
  });

  it('takes effect at once over the same data, keeping the frame', async () => {
    const el = (await mount(good)) as PivoetteTableElement;
    const frame = el.frame;
    const edited = { ...el.view!, pivotColumns: [] };
    await act(async () => {
      el.view = edited;
    });
    const restyled = { ...el.bundle!, view: { ...good.view, locale: 'de-DE' } };
    await act(async () => {
      el.bundle = restyled;
    });
    // Synchronous, so a host can carry its edits over straight away.
    expect(el.view).toBe(restyled.view);
    expect(el.frame).toBe(frame);
    expect(el.edited).toBe(false);
    await unmount(el);
  });
});

describe('removal preview', () => {
  it("shows in the table what the editor's remove button would take", async () => {
    const { table, editor } = await mountPair();
    const tinted = () =>
      table.shadowRoot!.querySelectorAll('[class*="removeTint"]').length;
    const x = editor.shadowRoot!.querySelector<HTMLButtonElement>(
      'button[title="Remove"]',
    )!;
    expect(tinted()).toBe(0);
    await act(async () => {
      x.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(tinted()).toBeGreaterThan(0);

    // Closing the panel under the pointer clears it too.
    await act(async () => {
      editor.open = false;
    });
    expect(tinted()).toBe(0);
    await unmount(editor);
    await unmount(table);
  });
});
