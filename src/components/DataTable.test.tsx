import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DataTable } from './DataTable';
import type { DataTableDisplay } from './DataTable';
import type { PivotSpec, TableSpec, ViewSpec } from '../pivot/spec';

// react-dom needs this flag; @tanstack/react-virtual needs ResizeObserver.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

let container: HTMLDivElement | null = null;

afterEach(() => {
  container?.remove();
  container = null;
});

async function render(node: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return container;
}

describe('<DataTable> smoke', () => {
  it('renders multi-level pivot headers incl. derived columns', async () => {
    const data = [
      { app: 'P1', platform: 'Intel', revision: 'before', t: 100 },
      { app: 'P1', platform: 'Intel', revision: 'after', t: 80 },
      { app: 'P1', platform: 'AMD', revision: 'before', t: 200 },
      { app: 'P1', platform: 'AMD', revision: 'after', t: 220 },
    ];
    const view: PivotSpec = {
      rows: ['app'],
      columns: ['platform', 'revision'],
      labels: { app: 'Application' },
      values: [{ id: 'mean', field: 't', agg: 'mean', label: 'mean' }],
      computed: [
        {
          id: 'delta',
          label: 'Δ%',
          repeatPer: ['platform'],
          inputs: {
            before: { colPath: ['before'], value: 'mean' },
            after: { colPath: ['after'], value: 'mean' },
          },
          compute: 'before ? (after - before) / before : null',
          place: { after: 'after' },
        },
      ],
    };
    const el = await render(<DataTable data={data} view={view} />);
    const headerText = el.querySelector('thead')!.textContent ?? '';
    expect(headerText).toContain('Application');
    expect(headerText).toContain('Intel');
    expect(headerText).toContain('AMD');
    expect(headerText).toContain('Δ%');
  });

  it('renders frameless + group spacing + multi-row footer + sort', async () => {
    const data = [
      { b: 'k1', size: 'tiny', arch: 'x86', t: 10 },
      { b: 'k1', size: 'tiny', arch: 'x86', t: 30 },
      { b: 'k1', size: 'big', arch: 'AArch64', t: 100 },
      { b: 'k2', size: 'tiny', arch: 'x86', t: 5 },
    ];
    const view: PivotSpec = {
      rows: ['b'],
      columns: ['size', 'arch'],
      values: [
        { id: 'mean', field: 't', agg: 'mean', label: 'mean' },
        { id: 'max', field: 't', agg: 'max', label: 'max' },
      ],
    };
    const el = await render(
      <DataTable
        data={data}
        view={view}
        display={{
          frameless: true,
          groupSpacing: 12,
          footer: [
            { label: 'avg', agg: 'mean' },
            { label: 'sum', agg: 'sum' },
          ],
        }}
      />,
    );
    expect(el.querySelector('tfoot')!.textContent).toContain('avg');
    expect(el.querySelector('tfoot')!.textContent).toContain('sum');
    // colgroup drives fixed widths
    expect(el.querySelectorAll('colgroup col').length).toBeGreaterThan(0);
  });

  it('renders a flat table with a summary-free header', async () => {
    const data = [{ name: 'a', v: 1 }];
    const view: TableSpec = {
      mode: 'flat',
      columns: [
        { id: 'name', label: 'Name', source: 'name' },
        { id: 'v', label: 'Value', source: 'v' },
      ],
    };
    const el = await render(<DataTable data={data} view={view} />);
    expect(el.querySelector('thead')!.textContent).toContain('Name');
    expect(el.querySelector('table')).toBeTruthy();
  });
});

describe('<DataTable> unit decoration', () => {
  const rows = [{ host: 'a', latency: 1.5, bandwidth: 12, cpu: 5 }];
  const meta = {
    latency: { displayName: 'Latency', unit: 'second', scale: 'milli' },
    bandwidth: {
      displayName: 'Bandwidth',
      unit: ['byte', '1/second'],
      scale: ['mega', null],
    },
    cpu: { displayName: 'CPU', scale: 'percent' },
  };
  const view: TableSpec = {
    mode: 'flat',
    columns: [
      { id: 'host', source: 'host' },
      {
        id: 'latency',
        source: 'latency',
        format: { fnName: 'number', options: { decimals: 2 } },
      },
      {
        id: 'bandwidth',
        source: 'bandwidth',
        format: { fnName: 'number', options: { decimals: 1 } },
      },
      { id: 'cpu', source: 'cpu' },
    ],
  };

  // Body rows are virtualized away under jsdom, so value decoration is read off
  // the footer — it runs through the same per-leaf formatter.
  async function renderWith(display: DataTableDisplay) {
    const el = await render(
      <DataTable
        data={{ meta, rows }}
        view={view}
        display={{ footer: [{ label: 'sum', agg: 'sum' }], ...display }}
      />,
    );
    return {
      head: el.querySelector('thead')!.textContent ?? '',
      values: el.querySelector('tfoot')!.textContent ?? '',
    };
  }

  it('leaves everything undecorated by default', async () => {
    const { head, values } = await renderWith({});
    expect(values).toContain('1.50');
    expect(values).not.toContain('1.50 ms');
    expect(head).not.toContain('(');
  });

  it('puts the whole label on the value', async () => {
    const { values } = await renderWith({
      unitPlacement: 'value',
      scalePlacement: 'value',
    });
    expect(values).toContain('1.50 ms');
    // A bare percent hugs its number; the 1 decimal is deduced from the unit.
    expect(values).toContain('5.0%');
  });

  it('puts the whole label in the header', async () => {
    const { head, values } = await renderWith({
      unitPlacement: 'header',
      scalePlacement: 'header',
    });
    expect(head).toContain('Latency (ms)');
    expect(head).toContain('CPU (%)');
    expect(values).toContain('1.50');
    expect(values).not.toContain('1.50 ms');
  });

  it('splits scale onto the value and unit into the header', async () => {
    const { head, values } = await renderWith({
      unitPlacement: 'header',
      scalePlacement: 'value',
    });
    expect(head).toContain('Latency (s)');
    expect(values).toContain('1.50 m');
    expect(values).not.toContain('1.50 ms');
  });

  it('moves a compound label atomically, ignoring scalePlacement', async () => {
    const header = await renderWith({
      unitPlacement: 'header',
      scalePlacement: 'value',
    });
    expect(header.head).toContain('Bandwidth (MB/s)');
    // The scale did not leak onto the value alongside the header label.
    expect(header.values).toContain('12.0');
    expect(header.values).not.toContain('12.0 M');

    const value = await renderWith({
      unitPlacement: 'value',
      scalePlacement: 'header',
    });
    expect(value.values).toContain('12.0 MB/s');
    expect(value.head).not.toContain('Bandwidth (M)');
  });

  it('leaves unitless columns alone', async () => {
    const { head } = await renderWith({
      unitPlacement: 'header',
      scalePlacement: 'header',
    });
    expect(head).toContain('host');
    expect(head).not.toContain('host (');
  });
});

describe('<DataTable> currency prefix', () => {
  const rows = [{ sym: 'A', price: 12.5, delta: -3.25, gain: 4 }];
  const view: TableSpec = {
    mode: 'flat',
    meta: {
      price: { displayName: 'Price', kind: ['price'], unit: ['dollar'] },
    },
    columns: [
      { id: 'sym' },
      { id: 'price' },
      {
        id: 'delta',
        meta: { kind: ['price'], unit: ['dollar'] },
        format: {
          fnName: 'number',
          options: { decimals: 2, signDisplay: 'exceptZero' },
        },
      },
      {
        id: 'gain',
        meta: { kind: ['price'], unit: ['dollar'] },
        format: {
          fnName: 'number',
          options: { decimals: 2, signDisplay: 'exceptZero' },
        },
      },
    ],
  };

  async function renderWith(display: DataTableDisplay) {
    const el = await render(
      <DataTable
        data={rows}
        view={view}
        display={{ footer: [{ label: 'sum', agg: 'sum' }], ...display }}
      />,
    );
    return {
      head: el.querySelector('thead')!.textContent ?? '',
      values: el.querySelector('tfoot')!.textContent ?? '',
    };
  }

  it('leads the number with the symbol, inside the sign', async () => {
    const { values } = await renderWith({ unitPlacement: 'value' });
    expect(values).toContain('$12.50');
    expect(values).toContain('-$3.25');
    expect(values).toContain('+$4.00');
  });

  it('can move the symbol into the header instead', async () => {
    const { head, values } = await renderWith({ unitPlacement: 'header' });
    expect(head).toContain('Price ($)');
    expect(values).toContain('12.50');
    expect(values).not.toContain('$12.50');
  });

  it('deduces the money format from the kind alone', async () => {
    // `price` sets no `format`; the 2 decimals come from kind: price.
    const { values } = await renderWith({ unitPlacement: 'off' });
    expect(values).toContain('12.50');
  });
});

describe('<DataTable> editing', () => {
  const data = [
    { author: 'a', weekday: 1, n: 5 },
    { author: 'b', weekday: 2, n: 7 },
  ];
  const view: PivotSpec = {
    rows: ['author'],
    columns: ['weekday'],
    values: [{ id: 's', field: 'n', agg: 'sum', label: 'n' }],
  };

  async function cellCounts(el: HTMLElement) {
    const head = el.querySelectorAll('thead tr:first-child > *').length;
    const foot = el.querySelectorAll('tfoot tr:last-child > *').length;
    return { head, foot };
  }

  it('renders no chrome without the editing prop', async () => {
    const el = await render(
      <DataTable
        data={data}
        view={view}
        display={{ footer: [{ label: 'sum', agg: 'sum' }] }}
      />,
    );
    expect(el.querySelectorAll('button[aria-label^="Add"]')).toHaveLength(0);
  });

  it('renders no chrome when editing without a change handler', async () => {
    // Chrome that cannot report anywhere would be a dead control.
    const el = await render(<DataTable data={data} view={view} editing />);
    expect(el.querySelectorAll('button[aria-label^="Add"]')).toHaveLength(0);
  });

  /**
   * Reveal the pending column by moving the pointer to an index header's edge.
   * jsdom reports a zero-size box, so the rect is stubbed to make the geometry
   * explicit rather than relying on 0 <= 0.
   */
  async function hoverEdge(
    el: HTMLElement,
    level: number,
    side: 'left' | 'right',
  ) {
    const th = [...el.querySelectorAll('thead th')][level] as HTMLElement;
    th.getBoundingClientRect = () =>
      ({ left: 0, width: 120, top: 0, height: 20 }) as DOMRect;
    const e = new MouseEvent('mousemove', { bubbles: true });
    Object.defineProperty(e, 'clientX', { value: side === 'left' ? 2 : 118 });
    await act(async () => {
      th.dispatchEvent(e);
    });
  }

  it('shows no + until the pointer nears an index header edge', async () => {
    const el = await render(
      <DataTable data={data} view={view} editing onViewChange={() => {}} />,
    );
    expect(el.querySelectorAll('button[aria-label^="Add"]')).toHaveLength(0);

    await hoverEdge(el, 0, 'left');
    expect(
      [...el.querySelectorAll('button[aria-label^="Add"]')].map((b) =>
        b.getAttribute('aria-label'),
      ),
    ).toEqual(['Add a row field here']);
  });

  it('costs no layout while nothing is hovered', async () => {
    const plain = await render(
      <DataTable
        data={data}
        view={view}
        display={{ footer: [{ label: 'sum', agg: 'sum' }] }}
      />,
    );
    const before = await cellCounts(plain);
    const edit = await render(
      <DataTable
        data={data}
        view={view}
        editing
        onViewChange={() => {}}
        onDisplayChange={() => {}}
        display={{ footer: [{ label: 'sum', agg: 'sum' }] }}
      />,
    );
    // Editing alone must not change the table's shape any more.
    expect(await cellCounts(edit)).toEqual(before);

    await hoverEdge(edit, 0, 'left');
    const after = await cellCounts(edit);
    expect(after.head).toBe(before.head + 1);
  });

  it('expands the pending column when + is pressed', async () => {
    const el = await render(
      <DataTable data={data} view={view} editing onViewChange={() => {}} />,
    );
    await hoverEdge(el, 0, 'left');
    const add = el.querySelector<HTMLButtonElement>(
      'button[aria-label="Add a row field here"]',
    )!;
    const pendingCol = () =>
      [...el.querySelectorAll('colgroup col')][0] as HTMLElement;
    const narrow = pendingCol().style.width;

    await act(async () => add.click());
    expect(pendingCol().style.width).not.toBe(narrow);

    const abort = el.querySelector<HTMLButtonElement>(
      'button[aria-label="Stop adding a row field"]',
    )!;
    await act(async () => abort.click());
    expect(el.querySelectorAll('button[aria-label^="Add"]')).toHaveLength(0);
  });

  it('leaves the given spec untouched', async () => {
    // Committing a choice goes through `addField`, which never mutates. The
    // choices themselves render in body rows, which the virtualizer does not
    // render under jsdom, so what is exercised here is revealing and opening.
    const before = JSON.parse(JSON.stringify(view)) as PivotSpec;
    const el = await render(
      <DataTable data={data} view={view} editing onViewChange={() => {}} />,
    );
    await hoverEdge(el, 0, 'left');
    await act(async () =>
      el
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Add a row field here"]',
        )!
        .click(),
    );
    expect(view).toEqual(before);
  });
});

describe('<DataTable> field removal', () => {
  const data = [{ team: 'A', project: 'p', n: 1 }];
  const view: PivotSpec = {
    rows: ['team', 'project'],
    columns: [],
    values: [{ id: 's', field: 'n', agg: 'sum', label: 'n' }],
  };

  it('shows a remove control per row field only when editable', async () => {
    const plain = await render(<DataTable data={data} view={view} />);
    expect(plain.querySelectorAll('button[aria-label^="Remove"]')).toHaveLength(
      0,
    );

    const el = await render(
      <DataTable data={data} view={view} editing onViewChange={() => {}} />,
    );
    expect(
      [...el.querySelectorAll('button[aria-label^="Remove"]')].map((b) =>
        b.getAttribute('aria-label'),
      ),
    ).toEqual(['Remove the team row field', 'Remove the project row field']);
  });

  it('removes the field it names, without sorting', async () => {
    let next: PivotSpec | undefined;
    const el = await render(
      <DataTable
        data={data}
        view={view}
        editing
        onViewChange={(v) => (next = v as PivotSpec)}
      />,
    );
    const remove = el.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove the team row field"]',
    )!;
    await act(async () => remove.click());
    expect(next!.rows).toEqual(['project']);
    // The click must not also reach the header's sort handler.
    expect(el.querySelector('thead')!.textContent).not.toContain('▼');
    expect(el.querySelector('thead')!.textContent).not.toContain('▲');
  });
});

describe('<DataTable> remove controls', () => {
  const data = [
    { team: 'A', wd: 1, n: 2 },
    { team: 'B', wd: 2, n: 3 },
  ];
  const view: PivotSpec = {
    rows: ['team'],
    columns: ['wd'],
    showSummary: true,
    values: [
      { id: 'a', field: 'n', agg: 'sum', label: 'sum' },
      { id: 'b', field: 'n', agg: 'mean', label: 'avg' },
    ],
  };

  async function mount(
    spec: PivotSpec,
    onView: (v: ViewSpec) => void = () => {},
    onDisplay: (d: DataTableDisplay) => void = () => {},
  ) {
    return render(
      <DataTable
        data={data}
        view={spec}
        editing
        onViewChange={onView}
        onDisplayChange={onDisplay}
        display={{ footer: [{ label: 'med', agg: 'median' }] }}
      />,
    );
  }

  const labels = (el: HTMLElement) =>
    [...el.querySelectorAll('button[aria-label^="Remove"]')].map((b) =>
      b.getAttribute('aria-label'),
    );

  it('offers one for every removable thing', async () => {
    const el = await mount(view);
    const kinds = new Set(labels(el));
    expect(kinds).toEqual(
      new Set([
        'Remove the team row field',
        'Remove the wd column field',
        'Remove the sum measure',
        'Remove the avg measure',
        'Remove the med row',
        'Remove the Total row',
      ]),
    );
  });

  it('omits the measure control while only one measure remains', async () => {
    // Removing it would be a no-op, and a dead control is worse than none.
    const el = await mount({ ...view, values: [view.values[0]!] });
    expect(labels(el).some((l) => l?.includes('measure'))).toBe(false);
  });

  it('removes the measure, a footer row, and the grand total', async () => {
    let v: PivotSpec | undefined;
    let d: DataTableDisplay | undefined;
    const el = await mount(
      view,
      (x) => (v = x as PivotSpec),
      (x) => (d = x),
    );
    const click = async (label: string) => {
      const b = el.querySelector<HTMLButtonElement>(
        `button[aria-label="${label}"]`,
      )!;
      await act(async () => b.click());
    };

    await click('Remove the avg measure');
    expect(v!.values.map((x) => x.id)).toEqual(['a']);

    await click('Remove the med row');
    expect(d!.footer).toEqual([]);

    // The grand total lives on the spec, not in display.footer.
    await click('Remove the Total row');
    expect(v!.showSummary).toBe(false);
  });
});

describe('<DataTable> linked measure controls', () => {
  const data = [
    { b: 'k1', size: 'tiny', n: 1 },
    { b: 'k1', size: 'big', n: 2 },
  ];
  const view: PivotSpec = {
    rows: ['b'],
    columns: ['size'],
    values: [
      { id: 'mean', field: 'n', agg: 'mean', label: 'mean' },
      { id: 'max', field: 'n', agg: 'max', label: 'max' },
    ],
  };

  it('lights every copy of a measure when one is hovered', async () => {
    const el = await render(
      <DataTable data={data} view={view} editing onViewChange={() => {}} />,
    );
    const of = (name: string) =>
      [
        ...el.querySelectorAll<HTMLElement>('button[aria-label$="measure"]'),
      ].filter((b) => b.getAttribute('aria-label')!.includes(name));
    const lit = (els: HTMLElement[]) =>
      els.filter((b) => b.dataset.linked === 'true').length;

    // One header per column group, so each measure's control repeats.
    expect(of('max')).toHaveLength(2);
    expect(lit(of('max'))).toBe(0);

    await act(async () => {
      of('max')[0]!.dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true }),
      );
    });

    expect(lit(of('max'))).toBe(2);
    // ...and only that measure.
    expect(lit(of('mean'))).toBe(0);
  });
});

describe('<DataTable> remove tint', () => {
  const data = [
    { t: 'A', s: 'x', n: 1 },
    { t: 'B', s: 'y', n: 2 },
  ];
  const view: PivotSpec = {
    rows: ['t'],
    columns: ['s'],
    showSummary: true,
    values: [
      { id: 'a', field: 'n', agg: 'sum', label: 'sum' },
      { id: 'b', field: 'n', agg: 'max', label: 'max' },
    ],
  };

  async function mounted() {
    return render(
      <DataTable
        data={data}
        view={view}
        editing
        onViewChange={() => {}}
        display={{ footer: [{ label: 'sum', agg: 'sum' }] }}
      />,
    );
  }

  const tinted = (el: HTMLElement) =>
    el.querySelectorAll('[class*="removeTint"]').length;

  async function hover(el: HTMLElement, label: string, on: boolean) {
    const b = el.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!;
    await act(async () => {
      b.dispatchEvent(
        new MouseEvent(on ? 'mouseover' : 'mouseout', { bubbles: true }),
      );
    });
  }

  it('tints nothing until a remove control is hovered', async () => {
    const el = await mounted();
    expect(tinted(el)).toBe(0);
  });

  it('tints only the hovered measure, in every column group', async () => {
    const el = await mounted();
    await hover(el, 'Remove the max measure', true);
    // Two column groups: two leaf headers plus that measure's cell in each of
    // the two footer lines. (Body rows are virtualized away under jsdom.)
    expect(tinted(el)).toBe(6);

    const cells = [...el.querySelectorAll('tfoot td')];
    const isTinted = cells.map((c) => c.className.includes('removeTint'));
    // Alternating, because the measures alternate across the groups.
    expect(isTinted.filter(Boolean)).toHaveLength(4);
    expect(isTinted).not.toEqual(isTinted.map(() => true));
  });

  it('clears when the pointer leaves', async () => {
    const el = await mounted();
    await hover(el, 'Remove the max measure', true);
    expect(tinted(el)).toBeGreaterThan(0);
    await hover(el, 'Remove the max measure', false);
    expect(tinted(el)).toBe(0);
  });

  it('tints the index column for a row field', async () => {
    const el = await mounted();
    await hover(el, 'Remove the t row field', true);
    const corner = el.querySelector('thead th')!;
    expect(corner.className).toContain('removeTint');
  });
});

describe('<DataTable> footer row tint', () => {
  const data = [
    { t: 'A', s: 'x', n: 1 },
    { t: 'B', s: 'y', n: 2 },
  ];
  const view: PivotSpec = {
    rows: ['t'],
    columns: ['s'],
    showSummary: true,
    values: [{ id: 'a', field: 'n', agg: 'sum', label: 'sum' }],
  };

  /** Tint map per footer row, including the aria-hidden rule row. */
  const map = (el: HTMLElement) =>
    [...el.querySelectorAll('tfoot tr')].map((r) =>
      [...r.children]
        .map((c) => (c.className.includes('removeTint') ? 'T' : '.'))
        .join(''),
    );

  it('tints only the row whose control is hovered', async () => {
    const el = await render(
      <DataTable
        data={data}
        view={view}
        editing
        onViewChange={() => {}}
        onDisplayChange={() => {}}
        display={{ footer: [{ label: 'med', agg: 'median' }] }}
      />,
    );
    expect(map(el)).toEqual(['.', '...', '...']);

    const x = el.querySelector<HTMLElement>(
      'button[aria-label="Remove the med row"]',
    )!;
    await act(async () => {
      x.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    // Label and both value cells; the Total row below is untouched.
    expect(map(el)).toEqual(['.', 'TTT', '...']);

    await act(async () => {
      x.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(map(el)).toEqual(['.', '...', '...']);
  });
});

describe('<DataTable> measure drag', () => {
  const data = [
    { t: 'A', s: 'x', n: 1 },
    { t: 'B', s: 'y', n: 2 },
  ];
  const view: PivotSpec = {
    rows: ['t'],
    columns: ['s'],
    values: [
      { id: 'a', field: 'n', agg: 'sum', label: 'sum' },
      { id: 'b', field: 'n', agg: 'max', label: 'max' },
      { id: 'c', field: 'n', agg: 'min', label: 'min' },
    ],
  };

  function drag(from: HTMLElement, to: HTMLElement) {
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
    fire(from, 'dragstart');
    fire(to, 'dragover');
    fire(to, 'drop');
  }

  async function mount(onChange: (v: ViewSpec) => void) {
    const el = await render(
      <DataTable data={data} view={view} editing onViewChange={onChange} />,
    );
    return [...el.querySelectorAll<HTMLElement>('thead th[draggable="true"]')];
  }

  it('reorders measures regardless of which column group was grabbed', async () => {
    let next: PivotSpec | undefined;
    const handles = await mount((v) => (next = v as PivotSpec));
    // The cell's text now includes its remove control, so match the prefix.
    const named = (n: string) =>
      handles.filter((h) => h.textContent?.startsWith(n));
    // Two column groups, so each measure has two handles.
    expect(named('min')).toHaveLength(2);

    // `min` from the second group, dropped on `sum` in the first.
    await act(async () => drag(named('min')[1]!, named('sum')[0]!));
    expect(next!.values.map((v) => v.id)).toEqual(['c', 'a', 'b']);
  });

  it('ignores a measure dropped on an axis field', async () => {
    // A measure is not a grouping field; the drop means nothing.
    let next: PivotSpec | undefined;
    const handles = await mount((v) => (next = v as PivotSpec));
    const measure = handles.find((h) => h.textContent?.startsWith('max'))!;
    const rowField = handles.find((h) => h.textContent?.startsWith('t'))!;
    await act(async () => drag(measure, rowField));
    expect(next).toBeUndefined();
  });
});

describe('<DataTable> column-field controls', () => {
  const data = [
    { t: 'A', size: 'tiny', arch: 'x86', n: 1 },
    { t: 'B', size: 'big', arch: 'arm', n: 2 },
  ];
  const view: PivotSpec = {
    rows: ['t'],
    columns: ['size', 'arch'],
    values: [{ id: 'a', field: 'n', agg: 'sum', label: 'sum' }],
  };

  async function mount(onChange: (v: ViewSpec) => void = () => {}) {
    const el = await render(
      <DataTable data={data} view={view} editing onViewChange={onChange} />,
    );
    return {
      el,
      controls: [
        ...el.querySelectorAll<HTMLElement>(
          'button[aria-label$="column field"]',
        ),
      ],
    };
  }

  /** Tinted cells per header row. */
  const perRow = (el: HTMLElement) =>
    [...el.querySelectorAll('thead tr')].map(
      (r) =>
        [...r.children].filter((c) => c.className.includes('removeTint'))
          .length,
    );

  it('offers one per column field', async () => {
    const { controls } = await mount();
    expect(controls.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Remove the size column field',
      'Remove the arch column field',
    ]);
  });

  it('tints the header row each one would drop', async () => {
    const { el, controls } = await mount();
    expect(perRow(el).every((n) => n === 0)).toBe(true);

    await act(async () => {
      controls[0]!.dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true }),
      );
    });
    // The outer level's own row, and nothing else.
    expect(perRow(el)[0]).toBeGreaterThan(0);
    expect(perRow(el)[1]).toBe(0);

    await act(async () => {
      controls[0]!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      controls[1]!.dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true }),
      );
    });
    expect(perRow(el)[0]).toBe(0);
    expect(perRow(el)[1]).toBeGreaterThan(0);
  });

  it('removes the field it names', async () => {
    let next: PivotSpec | undefined;
    const { controls } = await mount((v) => (next = v as PivotSpec));
    await act(async () => controls[0]!.click());
    expect(next!.columns).toEqual(['arch']);
  });
});

describe('<DataTable> column level drag', () => {
  const data = [
    { t: 'A', size: 'tiny', arch: 'x86', n: 1 },
    { t: 'B', size: 'big', arch: 'arm', n: 2 },
  ];
  const view: PivotSpec = {
    rows: ['t'],
    columns: ['size', 'arch'],
    values: [{ id: 'a', field: 'n', agg: 'sum', label: 'sum' }],
  };

  function drag(from: HTMLElement, to: HTMLElement) {
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
    fire(from, 'dragstart');
    fire(to, 'dragover');
    fire(to, 'drop');
  }

  async function mount(onChange: (v: ViewSpec) => void) {
    const el = await render(
      <DataTable data={data} view={view} editing onViewChange={onChange} />,
    );
    const rows = [...el.querySelectorAll('thead tr')];
    /** Draggable handles in header row `r`; row 0 leads with the row field. */
    return (r: number) => [
      ...rows[r]!.querySelectorAll<HTMLElement>('th[draggable="true"]'),
    ];
  }

  it('reorders the axis when a level is dropped on another', async () => {
    let next: PivotSpec | undefined;
    const handles = await mount((v) => (next = v as PivotSpec));
    // Any member of a level is a handle for it, as with measures.
    await act(async () => drag(handles(1)[0]!, handles(0)[1]!));
    expect(next!.columns).toEqual(['arch', 'size']);
  });

  it('accepts a drop anywhere in the cell, not just on the label', async () => {
    // The label is a fraction of the cell's box; requiring the pointer to be
    // exactly on the text is what made this silently do nothing in a browser.
    let next: PivotSpec | undefined;
    const el = await render(
      <DataTable
        data={data}
        view={view}
        editing
        onViewChange={(v) => (next = v as PivotSpec)}
      />,
    );
    const rows = [...el.querySelectorAll('thead tr')];
    const source = rows[1]!.querySelector<HTMLElement>('th[draggable="true"]')!;
    // Drop on the <th> itself, with no label under the pointer.
    const targetCell = [...rows[0]!.querySelectorAll<HTMLElement>('th')][1]!;
    await act(async () => drag(source, targetCell));
    expect(next!.columns).toEqual(['arch', 'size']);
  });

  it('pivots a column field dropped on a row field', async () => {
    let next: PivotSpec | undefined;
    const handles = await mount((v) => (next = v as PivotSpec));
    // handles(0)[0] is the row field's own header.
    await act(async () => drag(handles(1)[0]!, handles(0)[0]!));
    expect(next!.rows).toEqual(['arch', 't']);
    expect(next!.columns).toEqual(['size']);
  });
});

describe('<DataTable> computed columns and footer order', () => {
  const data = [{ a: 'x', n: 2 }];
  const view: PivotSpec = {
    rows: ['a'],
    columns: [],
    showSummary: true,
    values: [{ id: 'm', field: 'n', agg: 'sum', label: 'm' }],
    computed: [{ id: 'twice', label: 'Twice', compute: 'm * 2' }],
  };
  const display: DataTableDisplay = {
    footer: [
      { label: 'avg', agg: 'mean' },
      { label: 'sum', agg: 'sum' },
    ],
  };

  function fire(el: HTMLElement, type: string) {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', {
      value: { effectAllowed: '', setData: () => {}, getData: () => '' },
    });
    el.dispatchEvent(e);
  }

  async function mount(
    onView: (v: ViewSpec) => void = () => {},
    onDisplay: (d: DataTableDisplay) => void = () => {},
  ) {
    return render(
      <DataTable
        data={data}
        view={view}
        editing
        onViewChange={onView}
        onDisplayChange={onDisplay}
        display={display}
      />,
    );
  }

  it('offers a remove control on a derived column', async () => {
    // Derived columns are their own list, so a measure's control cannot
    // reach them.
    let next: PivotSpec | undefined;
    const el = await mount((v) => (next = v as PivotSpec));
    const x = el.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove the Twice column"]',
    )!;
    expect(x).toBeTruthy();
    await act(async () => x.click());
    expect(next!.computed).toEqual([]);
    expect(next!.values).toHaveLength(1);
  });

  it('makes only the listed footer rows draggable', async () => {
    const el = await mount();
    const rows = [...el.querySelectorAll<HTMLElement>('tfoot tr')];
    // The rule row and the grand total have no position in `display.footer`.
    expect(rows.map((r) => r.getAttribute('draggable'))).toEqual([
      null,
      'true',
      'true',
      null,
    ]);
  });

  it('drags with the label cell as its ghost, not the whole row', async () => {
    // A row's default drag image is a snapshot of its full width — the entire
    // footer area — which reads as dragging the table rather than the line.
    const el = await mount();
    const row = el.querySelector<HTMLElement>('tfoot tr[draggable="true"]')!;
    let image: Element | undefined;
    const e = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', {
      value: {
        effectAllowed: '',
        setData: () => {},
        setDragImage: (el: Element) => (image = el),
      },
    });
    await act(async () => {
      row.dispatchEvent(e);
    });
    expect(image?.tagName).toBe('TH');
    expect(image?.textContent).toContain('avg');
  });

  it('reorders footer rows by dragging', async () => {
    let d: DataTableDisplay | undefined;
    const el = await mount(
      () => {},
      (x) => (d = x),
    );
    const rows = [
      ...el.querySelectorAll<HTMLElement>('tfoot tr[draggable="true"]'),
    ];
    await act(async () => {
      fire(rows[1]!, 'dragstart');
      fire(rows[0]!, 'dragover');
      fire(rows[0]!, 'drop');
    });
    expect(d!.footer!.map((f) => f.agg)).toEqual(['sum', 'mean']);
  });
});
