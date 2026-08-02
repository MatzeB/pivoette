import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DataTable } from './DataTable';
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
