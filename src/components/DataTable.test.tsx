import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DataTable } from './DataTable';
import type { DataTableDisplay } from './DataTable';
import type { PivotSpec, TableSpec } from '../pivot/spec';

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
        format: { name: 'number', options: { decimals: 2 } },
      },
      {
        id: 'bandwidth',
        source: 'bandwidth',
        format: { name: 'number', options: { decimals: 1 } },
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
          name: 'number',
          options: { decimals: 2, signDisplay: 'exceptZero' },
        },
      },
      {
        id: 'gain',
        meta: { kind: ['price'], unit: ['dollar'] },
        format: {
          name: 'number',
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
