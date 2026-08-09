/**
 * The rendered half of the chart. Deliberately few: the geometry, the series
 * building, and the path arithmetic are all covered without a DOM in
 * `scale.test.ts`, `time.test.ts`, `series.test.ts`, and `shape.test.ts`, so
 * what is left to check here is the wiring.
 *
 * Every case passes an explicit `width` and `height` — jsdom has no layout, so
 * a responsive chart would measure zero and render its placeholder.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { installTestDom } from '../test-dom';
import type { ColumnMetaInput } from '../data/meta';
import { Axis } from './Axis';
import { GraphBox } from './GraphBox';
import { Legend } from './Legend';
import { LineSeries } from './LineSeries';
import { BarSeries } from './BarSeries';
import { Dot, PointLabel } from './marks';
import { Scrubber } from './Scrubber';

installTestDom();

type Row = Record<string, unknown>;

const ROWS: Row[] = [
  { month: '2026-01-01T00:00:00Z', account: 'Checking', balance: 120_000 },
  { month: '2026-02-01T00:00:00Z', account: 'Checking', balance: 130_000 },
  { month: '2026-03-01T00:00:00Z', account: 'Checking', balance: 145_000 },
  // Brokerage arrives late, so the shared x index has a hole in it.
  { month: '2026-02-01T00:00:00Z', account: 'Brokerage', balance: 400_000 },
  { month: '2026-03-01T00:00:00Z', account: 'Brokerage', balance: 460_000 },
];
const META: Record<string, ColumnMetaInput> = {
  month: { encoding: 'rfc3339', displayName: 'Month' },
  balance: { kind: 'price', unit: 'dollar', displayName: 'Net worth' },
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(node: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(node);
  });
  return container;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

function chart(children: ReactElement | ReactElement[], props: object = {}) {
  return (
    <GraphBox
      data={{ meta: META, rows: ROWS }}
      x="month"
      y="balance"
      series="account"
      width={600}
      height={300}
      {...props}
    >
      {children}
    </GraphBox>
  );
}

describe('rendering', () => {
  it('draws one path per series', async () => {
    const host = await render(chart(<LineSeries />));
    const paths = host.querySelectorAll('path');
    expect(paths).toHaveLength(2);
    expect(host.querySelectorAll('g[data-series]')).toHaveLength(2);
  });

  it('breaks a path where the series has no data', async () => {
    const host = await render(chart(<LineSeries />));
    const byKey = (key: string) =>
      host.querySelector(`g[data-series="${key}"] path`)!.getAttribute('d')!;
    // One subpath for the complete series, one for the run after the hole.
    expect(byKey('Checking').match(/M/g)).toHaveLength(1);
    expect(byKey('Brokerage').match(/M/g)).toHaveLength(1);
    // The late series starts at the second x, not at the left edge.
    const checking = byKey('Checking');
    const brokerage = byKey('Brokerage');
    const startOf = (d: string) => Number(d.slice(1).split(',')[0]);
    expect(startOf(brokerage)).toBeGreaterThan(startOf(checking));
  });

  it('colours marks through the palette variable, in series order', async () => {
    const host = await render(chart(<LineSeries />));
    const strokes = [...host.querySelectorAll('path')].map(
      (p) => (p as SVGPathElement).style.stroke,
    );
    expect(strokes).toEqual(['var(--pv-series-0)', 'var(--pv-series-1)']);
  });

  it('adds an area wash without replacing the line', async () => {
    const host = await render(chart(<LineSeries area />));
    expect(host.querySelectorAll('path')).toHaveLength(4);
  });

  it('sizes the svg in pixels, with no scaling viewBox', async () => {
    const host = await render(chart(<LineSeries />));
    const svg = host.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('600');
    expect(svg.getAttribute('height')).toBe('300');
    expect(svg.getAttribute('viewBox')).toBe('0 0 600 300');
  });

  it('pins the palette only when the theme is not auto', async () => {
    const auto = await render(chart(<LineSeries />));
    expect(auto.firstElementChild!.hasAttribute('data-theme')).toBe(false);
    await act(async () => root!.unmount());
    const dark = await render(chart(<LineSeries />, { theme: 'dark' }));
    expect(dark.firstElementChild!.getAttribute('data-theme')).toBe('dark');
  });
});

describe('axes', () => {
  it('names the value axis with the unit the ladder chose', async () => {
    const host = await render(chart([<Axis key="y" side="left" grid />]));
    const titles = [...host.querySelectorAll('text')].map((t) => t.textContent);
    // Balances in the hundreds of thousands land on the $k rung.
    expect(titles).toContain('Net worth ($k)');
  });

  it('labels ticks with only the digits the step needs', async () => {
    const host = await render(chart([<Axis key="y" side="left" />]));
    const ticks = [...host.querySelectorAll('text')]
      .map((t) => t.textContent!)
      .filter((t) => /^[\d,.]+$/.test(t));
    expect(ticks.length).toBeGreaterThan(1);
    // A $k axis stepping in hundreds needs no decimals at all.
    expect(ticks.every((t) => !t.includes('.'))).toBe(true);
  });

  it('formats a time axis as dates', async () => {
    const host = await render(
      chart([<Axis key="x" side="bottom" />], {
        locale: 'en-US',
        timeZone: 'UTC',
      }),
    );
    const texts = [...host.querySelectorAll('text')].map((t) => t.textContent!);
    expect(texts.some((t) => /Jan|Feb|Mar|2026/.test(t))).toBe(true);
  });

  it('draws a gridline per tick only when asked', async () => {
    const bare = await render(chart([<Axis key="y" side="left" />]));
    const bareLines = bare.querySelectorAll('line').length;
    await act(async () => root!.unmount());
    const grid = await render(chart([<Axis key="y" side="left" grid />]));
    expect(grid.querySelectorAll('line').length).toBeGreaterThan(bareLines);
  });
});

describe('per-point children', () => {
  it('renders each child once per non-null point', async () => {
    const host = await render(
      chart(
        <LineSeries>
          <Dot />
        </LineSeries>,
      ),
    );
    // Checking has three points, Brokerage two — the hole draws nothing.
    expect(host.querySelectorAll('circle')).toHaveLength(5);
  });

  it('gives a per-point mark its own series colour', async () => {
    const host = await render(
      chart(
        <LineSeries>
          <Dot />
        </LineSeries>,
      ),
    );
    // Series are ordered by their own name, so Brokerage takes slot 0 and
    // keeps it however many other accounts come and go.
    const fills = [
      ...host.querySelectorAll('g[data-series="Brokerage"] circle'),
    ].map((c) => (c as SVGCircleElement).style.fill);
    expect(fills).toEqual(['var(--pv-series-0)', 'var(--pv-series-0)']);
  });

  it('accepts a function child and hands it the datum', async () => {
    const host = await render(
      chart(
        <LineSeries>
          {(datum) => (
            <circle data-x={datum.point.x} cx={datum.cx} cy={datum.cy} r={2} />
          )}
        </LineSeries>,
      ),
    );
    expect(host.querySelectorAll('circle[data-x]')).toHaveLength(5);
  });

  it('draws built-in markers without needing a child', async () => {
    const host = await render(chart(<LineSeries markers />));
    expect(host.querySelectorAll('circle')).toHaveLength(5);
  });

  it('drops its own markers once they would be too dense to read', async () => {
    const host = await render(chart(<LineSeries markers maxMarkers={2} />));
    expect(host.querySelectorAll('circle')).toHaveLength(0);
  });

  it('keeps the children the cap does not own', async () => {
    // A child may render at one point rather than at all of them, so the
    // marker cap must not decide for it.
    const host = await render(
      chart(
        <LineSeries markers maxMarkers={2}>
          <PointLabel at="last" />
        </LineSeries>,
      ),
    );
    expect(host.querySelectorAll('circle')).toHaveLength(0);
    expect(host.querySelectorAll('text')).toHaveLength(2);
  });

  it('labels every mark when asked, for the handful-of-bars case', async () => {
    const host = await render(
      chart(
        <LineSeries>
          <PointLabel at="all" />
        </LineSeries>,
      ),
    );
    // Five non-null points across the two series.
    expect(host.querySelectorAll('text')).toHaveLength(5);
  });

  it('puts an outside label past the data end, on either side of zero', async () => {
    const rows: Row[] = [
      { g: 'up', v: 100 },
      { g: 'down', v: -100 },
    ];
    const host = await render(
      <GraphBox data={rows} x="g" y="v" width={400} height={300} includeZero>
        <BarSeries>
          <PointLabel at="all" side="outside" />
        </BarSeries>
      </GraphBox>,
    );
    const labels = [...host.querySelectorAll('text')];
    expect(labels).toHaveLength(2);
    const down = labels.find((l) => l.textContent!.startsWith('-'))!;
    const up = labels.find((l) => !l.textContent!.startsWith('-'))!;
    // A downward bar's cap is below the baseline, so its label goes below too
    // — above would land inside the fill.
    expect(Number(up.getAttribute('y'))).toBeLessThan(
      Number(down.getAttribute('y')),
    );
    expect(up.getAttribute('dominant-baseline')).toBeNull();
    expect(down.getAttribute('dominant-baseline')).toBe('hanging');
  });

  it('labels one point per series, not all of them', async () => {
    const host = await render(
      chart(
        <LineSeries>
          <PointLabel at="last" />
        </LineSeries>,
      ),
    );
    expect(host.querySelectorAll('text')).toHaveLength(2);
  });
});

describe('legend', () => {
  it('lists every series beneath the plot', async () => {
    const host = await render(
      chart([<LineSeries key="l" />, <Legend key="g" />]),
    );
    const text = host.textContent ?? '';
    expect(text).toContain('Checking');
    expect(text).toContain('Brokerage');
  });

  it('stays out of the way when there is only one series', async () => {
    const host = await render(
      <GraphBox
        data={{ meta: META, rows: ROWS }}
        x="month"
        y="balance"
        width={600}
        height={300}
      >
        <LineSeries />
        <Legend />
      </GraphBox>,
    );
    expect(host.textContent).toBe('');
  });
});

describe('bars', () => {
  /** A single series over a categorical x, which is what `colorBy` is for. */
  const byCategory = (children: ReactElement) => (
    <GraphBox
      data={{ meta: META, rows: ROWS }}
      x="account"
      y="balance"
      agg="sum"
      width={600}
      height={300}
    >
      {children}
    </GraphBox>
  );

  it('paints one series in one colour by default', async () => {
    const host = await render(byCategory(<BarSeries />));
    const fills = [...host.querySelectorAll('path')].map(
      (p) => (p as SVGPathElement).style.fill,
    );
    expect(fills).toEqual(['var(--pv-series-0)', 'var(--pv-series-0)']);
  });

  it('gives each bar its category’s slot when asked', async () => {
    const host = await render(byCategory(<BarSeries colorBy="category" />));
    const fills = [...host.querySelectorAll('path')].map(
      (p) => (p as SVGPathElement).style.fill,
    );
    // The same slots the accounts hold as series elsewhere, because both are
    // ordered by name — which is what makes the two charts match.
    expect(fills).toEqual(['var(--pv-series-0)', 'var(--pv-series-1)']);
  });

  it('carries the bar’s colour into its children', async () => {
    const host = await render(
      byCategory(
        <BarSeries colorBy="category">
          <Dot />
        </BarSeries>,
      ),
    );
    const fills = [...host.querySelectorAll('circle')].map(
      (c) => (c as SVGCircleElement).style.fill,
    );
    expect(fills).toEqual(['var(--pv-series-0)', 'var(--pv-series-1)']);
  });

  it('draws one bar per point and shares the slot between series', async () => {
    const host = await render(chart(<BarSeries />));
    const bars = host.querySelectorAll('path');
    expect(bars).toHaveLength(5);
    const xOf = (p: Element) =>
      Number(p.getAttribute('d')!.slice(1).split(',')[0]);
    const checking = host.querySelectorAll('g[data-series="Checking"] path');
    const brokerage = host.querySelectorAll('g[data-series="Brokerage"] path');
    // The two series occupy different halves of the same x slot.
    expect(xOf(brokerage[0]!)).not.toBe(xOf(checking[1]!));
  });
});

describe('where the unit is stated', () => {
  const everything = [
    <Axis key="y" side="left" />,
    <LineSeries key="l">
      <PointLabel at="last" />
    </LineSeries>,
    <Scrubber key="s" />,
  ];

  /** Every string the chart prints, SVG and overlay alike. */
  async function texts(props: object = {}) {
    const host = await render(chart(everything, props));
    const hit = host.querySelector('rect')!;
    await act(async () => {
      hit.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 500, bubbles: true }),
      );
    });
    return {
      svg: [...host.querySelectorAll('svg text')].map((t) => t.textContent!),
      readout: host.querySelector('[class*="readout"]')!.textContent!,
    };
  }

  it('says it once, on the axis title, by default', async () => {
    const { svg, readout } = await texts();
    expect(svg).toContain('Net worth ($k)');
    // Not again on the ticks, the end labels, or under the pointer.
    expect(svg.filter((t) => t.includes('$'))).toEqual(['Net worth ($k)']);
    expect(readout).not.toContain('$');
  });

  it('moves it onto the values instead when asked', async () => {
    const { svg, readout } = await texts({ unitPlacement: 'value' });
    expect(svg).toContain('Net worth');
    expect(svg).not.toContain('Net worth ($k)');
    // Ticks and the end labels carry it now, and so does the readout.
    expect(svg.filter((t) => t.includes('$')).length).toBeGreaterThan(1);
    expect(readout).toContain('$');
  });

  it('drops it everywhere when turned off', async () => {
    const { svg, readout } = await texts({ unitPlacement: 'off' });
    expect(svg).toContain('Net worth');
    expect(svg.some((t) => t.includes('$'))).toBe(false);
    expect(readout).not.toContain('$');
  });
});

describe('scrubber', () => {
  const withScrubber = () =>
    chart([<LineSeries key="l" />, <Scrubber key="s" />], {
      locale: 'en-US',
      timeZone: 'UTC',
    });

  it('shows nothing until the pointer arrives', async () => {
    const host = await render(withScrubber());
    expect(host.querySelector('[class*="readout"]')).toBeNull();
  });

  it('reads out the nearest point on a pointer move', async () => {
    const host = await render(withScrubber());
    const hit = host.querySelector('rect')!;
    await act(async () => {
      hit.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 500, bubbles: true }),
      );
    });
    const readout = host.querySelector('[class*="readout"]')!;
    expect(readout).toBeTruthy();
    // Near the right edge: the last month, where both series have a value.
    expect(readout.textContent).toContain('Checking');
    expect(readout.textContent).toContain('Brokerage');
  });

  it('marks the hovered position with a rule and a dot per series', async () => {
    const host = await render(withScrubber());
    const hit = host.querySelector('rect')!;
    await act(async () => {
      hit.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 500, bubbles: true }),
      );
    });
    expect(host.querySelectorAll('circle')).toHaveLength(2);
  });

  it('is reachable without a pointer at all', async () => {
    const host = await render(withScrubber());
    const hit = host.querySelector('rect')!;
    await act(async () => {
      hit.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });
    const readout = host.querySelector('[class*="readout"]')!;
    expect(readout).toBeTruthy();
    // Stepping right from nothing lands on the first position, then the
    // second — where Brokerage has just appeared.
    expect(readout.textContent).toContain('Brokerage');
  });

  it('clears on escape', async () => {
    const host = await render(withScrubber());
    const hit = host.querySelector('rect')!;
    await act(async () => {
      hit.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });
    expect(host.querySelector('[class*="readout"]')).toBeTruthy();
    await act(async () => {
      hit.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(host.querySelector('[class*="readout"]')).toBeNull();
  });
});

describe('sizing', () => {
  it('renders a placeholder rather than an Infinity transform', async () => {
    // No width given and no ResizeObserver measurement: the box has no size.
    const host = await render(
      <GraphBox
        data={{ meta: META, rows: ROWS }}
        x="month"
        y="balance"
        height={300}
      >
        <LineSeries />
      </GraphBox>,
    );
    expect(host.querySelector('svg')).toBeNull();
    expect(host.querySelector('path')).toBeNull();
  });
});
