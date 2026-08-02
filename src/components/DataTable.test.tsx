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

  it('offers a single + on the row-index group', async () => {
    const el = await render(
      <DataTable
        data={data}
        view={view}
        editing
        onViewChange={() => {}}
        onDisplayChange={() => {}}
        display={{ footer: [{ label: 'sum', agg: 'sum' }] }}
      />,
    );
    const labels = [...el.querySelectorAll('button[aria-label^="Add"]')].map(
      (b) => b.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['Add a row field']);
  });

  it('widens every row by exactly one cell', async () => {
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
    const after = await cellCounts(edit);
    expect(after.head).toBe(before.head + 1);
    expect(after.foot).toBe(before.foot + 1);
  });

  it('expands the pending column when + is pressed', async () => {
    // The choices themselves live in body rows, which the virtualizer does not
    // render under jsdom — so what is observable here is the column opening.
    const el = await render(
      <DataTable data={data} view={view} editing onViewChange={() => {}} />,
    );
    const add = el.querySelector<HTMLButtonElement>(
      'button[aria-label="Add a row field"]',
    )!;
    const pendingCol = () =>
      [...el.querySelectorAll('colgroup col')].at(view.rows.length)!;

    expect(add.getAttribute('aria-expanded')).toBe('false');
    const narrow = (pendingCol() as HTMLElement).style.width;

    await act(async () => add.click());
    const open = el.querySelector<HTMLButtonElement>(
      'button[aria-label="Cancel"]',
    )!;
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect((pendingCol() as HTMLElement).style.width).not.toBe(narrow);

    await act(async () => open.click());
    expect((pendingCol() as HTMLElement).style.width).toBe(narrow);
  });

  it('names the column fields, which the headers never show', async () => {
    const el = await render(
      <DataTable data={data} view={view} editing onViewChange={() => {}} />,
    );
    // Column headers show members (1, 2); the strip shows the field.
    expect(el.querySelector('thead')!.textContent).toContain('weekday');
  });

  it('leaves the given spec untouched', async () => {
    // Committing a choice goes through `addField`, which never mutates; the
    // click itself is not reachable here because the choices render in body
    // rows and the virtualizer renders none under jsdom.
    const before = JSON.parse(JSON.stringify(view)) as PivotSpec;
    const el = await render(
      <DataTable data={data} view={view} editing onViewChange={() => {}} />,
    );
    await act(async () =>
      el
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Add a row field"]',
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
