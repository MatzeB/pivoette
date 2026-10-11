import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ViewEditor } from './ViewEditor';
import type { ViewSpec } from '../pivot/spec';
import type { DataTableDisplay } from '../components/DataTable';
import type { RemovalRef } from './ops';
import { fromRows } from '../data/import';

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

describe('reset', () => {
  async function mountWith(props: {
    onReset?: () => void;
    canReset?: boolean;
  }) {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container!).render(
        <ViewEditor view={view} onViewChange={() => {}} {...props} />,
      );
    });
    return [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Reset',
    );
  }

  it('offers no reset unless the host can do one', async () => {
    expect(await mountWith({})).toBeUndefined();
  });

  it('calls the host, and is disabled with nothing to reset', async () => {
    let resets = 0;
    const button = (await mountWith({ onReset: () => resets++ }))!;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(resets).toBe(1);

    container!.remove();
    const idle = (await mountWith({ onReset: () => {}, canReset: false }))!;
    expect(idle.disabled).toBe(true);
  });
});

describe('<ViewEditor> removal preview', () => {
  it('reports what a remove button would take while it is pointed at', async () => {
    const seen: (RemovalRef | null)[] = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container!).render(
        <ViewEditor
          view={{ ...view, showSummary: true }}
          display={{ footer: [{ label: 'med', agg: 'median' }] }}
          onViewChange={() => {}}
          onDisplayChange={() => {}}
          onRemovePreview={(ref) => seen.push(ref)}
        />,
      );
    });
    const buttons = [
      ...container.querySelectorAll<HTMLButtonElement>(
        'button[title="Remove"]',
      ),
    ];
    // team, project | weekday | A, B | med, Total
    const hover = async (b: HTMLButtonElement) => {
      await act(async () => {
        b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      });
      await act(async () => {
        b.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      });
    };
    await hover(buttons[1]!);
    await hover(buttons[2]!);
    await hover(buttons[4]!);
    await hover(buttons[5]!);
    await hover(buttons[6]!);
    expect(seen).toEqual([
      { zone: 'pivotRows', index: 1 },
      null,
      { zone: 'pivotColumns', index: 0 },
      null,
      { zone: 'columns', index: 1 },
      null,
      { zone: 'footer', index: 0 },
      null,
      { zone: 'summary' },
      null,
    ]);

    // Clicking clears it: the row goes, and with it the mouseleave.
    seen.length = 0;
    await act(async () => {
      buttons[5]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await act(async () => buttons[5]!.click());
    expect(seen.at(-1)).toBeNull();
  });
});

describe('<ViewEditor> totals', () => {
  /** Mount with a display, and report each view or display it emits. */
  async function mountTotals(
    spec: ViewSpec,
    display: DataTableDisplay | undefined,
  ) {
    const seen: { view?: ViewSpec; display?: DataTableDisplay } = {};
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container!).render(
        <ViewEditor
          view={spec}
          display={display}
          onViewChange={(v) => (seen.view = v)}
          onDisplayChange={(d) => (seen.display = d)}
        />,
      );
    });
    const section = [...container.querySelectorAll('section')].find(
      (s) => s.querySelector('h4')?.textContent === 'Totals',
    );
    return { seen, section };
  }

  const labels = (section: Element | undefined) =>
    [...(section?.querySelectorAll('li') ?? [])].map((li) => li.textContent);

  async function pick(section: Element | undefined, value: string) {
    const select = section!.querySelector<HTMLSelectElement>(
      'select[title="Add a total row"]',
    )!;
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  it('lists the grand total, which can be removed and added back', async () => {
    const { seen, section } = await mountTotals(
      { ...view, showSummary: true },
      {},
    );
    expect(labels(section)).toEqual(['Total×']);
    const remove = section!.querySelector<HTMLButtonElement>(
      'button[title="Remove"]',
    )!;
    await act(async () => remove.click());
    expect(seen.view!.showSummary).toBe(false);

    container!.remove();
    const off = await mountTotals({ ...view, showSummary: false }, {});
    await pick(off.section, '(total)');
    expect(off.seen.view!.showSummary).toBe(true);
  });

  it('adds a footer row, even with no display to start from', async () => {
    const { seen, section } = await mountTotals(view, undefined);
    expect(section).toBeTruthy();
    await pick(section, 'median');
    expect(seen.display!.footer).toEqual([{ label: 'median', agg: 'median' }]);
  });

  it('offers the usual totals first, and the rest after', async () => {
    const { section } = await mountTotals(view, {});
    const values = [...section!.querySelectorAll('select > option')]
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v !== '');
    expect(values).toEqual(['(total)', 'sum', 'mean', 'median', 'min', 'max']);
    const more = [...section!.querySelectorAll('optgroup option')].map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(more).toContain('count');
    expect(more).not.toContain('sum');
  });

  it('edits the totals of a flat table too', async () => {
    const flat: ViewSpec = { columns: [{ id: 'x' }, { id: 'y' }] };
    const { seen, section } = await mountTotals(flat, {
      footer: [{ label: 'median', agg: 'median' }],
    });
    expect(labels(section)).toEqual(['median×']);
    // A flat view has no grand total to offer.
    const options = [...section!.querySelectorAll('option')].map(
      (o) => o.value,
    );
    expect(options).not.toContain('(total)');
    await pick(section, 'sum');
    expect(seen.display!.footer!.map((f) => f.agg)).toEqual(['median', 'sum']);
  });
});

describe('<ViewEditor> add menus', () => {
  const frame = fromRows(
    [
      {
        team: 'a',
        project: 'p',
        weekday: 'Mon',
        x: 1,
        y: 2,
        at: '2026-01-01T00:00:00Z',
      },
      {
        team: 'b',
        project: 'q',
        weekday: 'Tue',
        x: 3,
        y: 4,
        at: '2026-01-02T00:00:00Z',
      },
    ],
    {
      x: { displayName: 'Lines added' },
      at: { kind: ['timestamp'], encoding: 'rfc3339' },
    },
  );

  async function mountMenus(spec: ViewSpec, withFrame = true) {
    let next: ViewSpec | undefined;
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container!).render(
        <ViewEditor
          view={spec}
          frame={withFrame ? frame : undefined}
          onViewChange={(v) => (next = v)}
        />,
      );
    });
    const menu = (title: string) =>
      container!.querySelector<HTMLSelectElement>(`select[title="${title}"]`);
    const values = (title: string, group = false) =>
      [
        ...(menu(title)?.querySelectorAll(
          group ? 'optgroup option' : ':scope > option',
        ) ?? []),
      ]
        .map((o) => (o as HTMLOptionElement).value)
        .filter((v) => v !== '');
    const pick = async (title: string, value: string) => {
      const select = menu(title)!;
      await act(async () => {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      return next!;
    };
    return { menu, values, pick };
  }

  it('offers the groupable fields not already on an axis', async () => {
    const { values, pick } = await mountMenus({
      pivotRows: [{ field: 'team' }],
      columns: [{ id: 'a', source: 'x', agg: 'sum' }],
    });
    expect(values('Add a field to pivot rows')).toEqual(['project', 'weekday']);
    expect(values('Add a field to pivot columns')).toEqual([
      'project',
      'weekday',
    ]);
    const next = await pick('Add a field to pivot columns', 'weekday');
    expect(fields(next.pivotColumns)).toEqual(['weekday']);
  });

  it('offers derived fields, even without a frame', async () => {
    const { values } = await mountMenus(
      {
        derive: { day: { compute: 'weekday(at)' } },
        pivotRows: [{ field: 'team' }],
        columns: [{ id: 'a', source: 'x', agg: 'sum' }],
      },
      false,
    );
    expect(values('Add a field to pivot rows')).toEqual(['day']);
    // Nothing is known about the data, so there is no column to offer.
    expect(values('Add a column')).toEqual([]);
  });

  it('adds a column with an aggregation that fits its field', async () => {
    const spec: ViewSpec = {
      pivotRows: [{ field: 'team' }],
      columns: [{ id: 'a', source: 'x', agg: 'sum' }],
    };
    const { values, pick } = await mountMenus(spec);
    // Measures first; identifiers can still be counted.
    expect(values('Add a column')).toEqual(['x', 'y', 'at']);
    expect(values('Add a column', true)).toContain('team');

    const added = (next: ViewSpec) => next.columns.at(-1)!;
    expect(added(await pick('Add a column', 'x'))).toMatchObject({
      source: 'x',
      agg: 'sum',
      label: 'Lines added',
    });
    expect(added(await pick('Add a column', 'at'))).toMatchObject({
      agg: 'max',
      format: { fnName: 'relativeTime' },
    });
    expect(added(await pick('Add a column', 'team')).agg).toBe('count');
  });
});

describe('<ViewEditor> filters', () => {
  const frame = fromRows([
    { app: 'a', platform: 'Intel', region: 'eu', t: 1 },
    { app: 'a', platform: 'AMD', region: 'us', t: 2 },
    { app: 'b', platform: 'GPU', region: 'eu', t: 3 },
  ]);
  const base: ViewSpec = {
    pivotRows: [{ field: 'app', label: 'Application' }],
    pivotColumns: [{ field: 'platform' }],
    columns: [{ id: 't', agg: 'sum' }],
  };

  async function mountFilters(spec: ViewSpec) {
    const seen: ViewSpec[] = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const draw = (v: ViewSpec) =>
      root.render(
        <ViewEditor
          view={v}
          frame={frame}
          onViewChange={(next) => {
            seen.push(next);
            draw(next);
          }}
        />,
      );
    await act(async () => draw(spec));
    const section = () =>
      [...container!.querySelectorAll('section')].find(
        (s) => s.querySelector('h4')?.textContent === 'Filter',
      )!;
    const entry = (label: string) =>
      [...section().querySelectorAll('details')].find((d) =>
        d.querySelector('summary')!.textContent!.startsWith(label),
      )!;
    const open = async (label: string) => {
      const details = entry(label);
      await act(async () => {
        details.open = true;
        details.dispatchEvent(new Event('toggle'));
      });
      return details;
    };
    const boxes = (details: HTMLElement) => [
      ...details.querySelectorAll<HTMLInputElement>('input[type=checkbox]'),
    ];
    return { seen, section, entry, open, boxes };
  }

  it('lists a filter for each axis field, showing all by default', async () => {
    const { section } = await mountFilters(base);
    const summaries = [...section().querySelectorAll('summary')].map(
      (s) => s.textContent,
    );
    expect(summaries).toEqual(['Applicationall', 'platformall']);
  });

  it('unchecks members to exclude them, all of them if asked', async () => {
    const { seen, open, boxes, entry } = await mountFilters(base);
    const details = await open('platform');
    expect(
      [...details.querySelectorAll('label')].map((l) => l.textContent),
    ).toEqual(['Intel', 'AMD', 'GPU']);

    await act(async () => boxes(details)[2]!.click());
    expect(seen.at(-1)!.filter).toEqual({ platform: { exclude: ['GPU'] } });
    expect(entry('platform').querySelector('summary')!.textContent).toBe(
      'platform1 hidden',
    );

    await act(async () => boxes(details)[1]!.click());
    await act(async () => boxes(details)[0]!.click());
    expect(boxes(details).map((b) => b.checked)).toEqual([false, false, false]);
    expect(entry('platform').querySelector('summary')!.textContent).toBe(
      'platformnone',
    );

    // Showing everything again leaves no filter behind on an axis field.
    const showAll = [...details.querySelectorAll('button')].find(
      (b) => b.textContent === 'show all',
    )!;
    await act(async () => showAll.click());
    expect(seen.at(-1)!.filter).toBeUndefined();
  });

  it('filters on a field on neither axis, from the add menu', async () => {
    const { seen, section } = await mountFilters(base);
    const menu = section().querySelector<HTMLSelectElement>(
      'select[title="Add a filter"]',
    )!;
    expect(
      [...menu.querySelectorAll('option')].map((o) => o.value).slice(1),
    ).toEqual(['region']);
    await act(async () => {
      menu.value = 'region';
      menu.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(seen.at(-1)!.filter).toEqual({ region: { exclude: [] } });
    expect(section().textContent).toContain('region');
  });
});
