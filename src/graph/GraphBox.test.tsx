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

describe('ordering', () => {
  // Name order and value order disagree here, which is the only way to see
  // that the box passes `order` down at all.
  const RANKED: Row[] = [
    { m: 1, who: 'aaa', v: 10 },
    { m: 2, who: 'aaa', v: 10 },
    { m: 1, who: 'zzz', v: 900 },
    { m: 2, who: 'zzz', v: 900 },
  ];

  /** Series in drawn order, with the palette slot each one ended up wearing. */
  const drawn = (host: HTMLElement) =>
    [...host.querySelectorAll('g[data-series]')].map((g) => [
      g.getAttribute('data-series'),
      (g.querySelector('path') as SVGPathElement).style.stroke,
    ]);

  const ranked = (props: object) =>
    render(
      <GraphBox
        data={RANKED}
        x="m"
        y="v"
        series="who"
        width={600}
        height={300}
        {...props}
      >
        <LineSeries />
      </GraphBox>,
    );

  it('draws in name order by default', async () => {
    expect(drawn(await ranked({}))).toEqual([
      ['aaa', 'var(--pv-series-0)'],
      ['zzz', 'var(--pv-series-1)'],
    ]);
  });

  it('draws the largest first when the box asks, without moving a colour', async () => {
    expect(drawn(await ranked({ order: 'value' }))).toEqual([
      // Re-ordered — and each still wearing the slot it had under name order,
      // so a second chart sorted differently still agrees about the colours.
      ['zzz', 'var(--pv-series-1)'],
      ['aaa', 'var(--pv-series-0)'],
    ]);
  });
});

describe('regressions the review turned up', () => {
  it('reserves left margin for the text the axis really draws', async () => {
    // Grouped, un-rescaled thousands: measuring `1000` instead of `1,000`
    // used to put the ticks over the rotated title and past x=0.
    const rows: Row[] = [
      { g: 1, v: 120 },
      { g: 2, v: 880 },
    ];
    const host = await render(
      <GraphBox
        data={{ meta: { v: { kind: 'price', unit: 'dollar' } }, rows }}
        x="g"
        y="v"
        width={600}
        height={300}
        locale="en-US"
      >
        <Axis side="left" />
      </GraphBox>,
    );
    const ticks = [...host.querySelectorAll('text')].filter((t) =>
      /^[\d,]+$/.test(t.textContent!),
    );
    expect(ticks.length).toBeGreaterThan(1);
    // Anchored `end`, so x is the right edge of the text; it has to clear the
    // rotated title sitting at x=11 by at least the text's own width.
    const widest = Math.max(...ticks.map((t) => t.textContent!.length));
    const anchor = Number(ticks[0]!.getAttribute('x'));
    expect(anchor - widest * 6.6).toBeGreaterThan(11);
  });

  it('lets the box ask for more ticks than the default', async () => {
    const five = await render(chart([<Axis key="y" side="left" />]));
    const count = (h: HTMLElement) =>
      [...h.querySelectorAll('text')].filter((t) =>
        /^[\d,.-]+$/.test(t.textContent!),
      ).length;
    const withFive = count(five);
    await act(async () => root!.unmount());
    const many = await render(
      chart([<Axis key="y" side="left" />], { ticks: 12 }),
    );
    expect(count(many)).toBeGreaterThan(withFive);
  });

  it('does not wrap a ninth series onto the first one’s colour', async () => {
    const rows: Row[] = [];
    for (let s = 0; s < 9; s++) {
      for (const m of [1, 2]) rows.push({ m, who: `s${s}`, v: s + 1 });
    }
    const host = await render(
      <GraphBox data={rows} x="m" y="v" series="who" width={600} height={300}>
        <LineSeries />
      </GraphBox>,
    );
    const strokes = [...host.querySelectorAll('g[data-series] path')].map(
      (p) => (p as SVGPathElement).style.stroke,
    );
    expect(strokes).toHaveLength(9);
    expect(new Set(strokes.slice(0, 8)).size).toBe(8);
    // The ninth is out of palette, and says so rather than impersonating one.
    expect(strokes[8]).toBe('var(--pv-muted)');
    expect(strokes[8]).not.toBe(strokes[0]);
  });

  it('reaches the first point with one arrow press', async () => {
    const host = await render(
      chart([<LineSeries key="l" />, <Scrubber key="s" />], {
        locale: 'en-US',
        timeZone: 'UTC',
      }),
    );
    const hit = host.querySelector('rect')!;
    await act(async () => {
      hit.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });
    // January, the first month — not February, which stepping from 0 gave.
    expect(host.querySelector('[class*="readout"]')!.textContent).toContain(
      'Jan',
    );
  });

  it('announces the readout to a screen reader', async () => {
    const host = await render(
      chart([<LineSeries key="l" />, <Scrubber key="s" />], {
        locale: 'en-US',
        timeZone: 'UTC',
      }),
    );
    const hit = host.querySelector('rect')!;
    await act(async () => {
      hit.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });
    const readout = host.querySelector('[class*="readout"]')!;
    expect(readout.getAttribute('aria-live')).toBe('polite');
    // No `role="slider"`, which would promise an `aria-valuenow` the hit rect
    // deliberately cannot report without subscribing to every pointer move.
    expect(hit.getAttribute('role')).toBeNull();
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

  it('names the hovered point at the resolution the points sit at', async () => {
    // Monthly points on an axis that ticks yearly: the heading has to say
    // which month, not which tick period it fell in.
    const host = await render(
      chart([<LineSeries key="l" />, <Scrubber key="s" />], {
        locale: 'en-US',
        timeZone: 'UTC',
      }),
    );
    const hit = host.querySelector('rect')!;
    await act(async () => {
      hit.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });
    const head = host.querySelector('[class*="readoutHead"]')!;
    expect(head.textContent).toBe('Jan 2026');
  });

  it('names a value the same way wherever it appears', async () => {
    // One rule, one digit past the axis step — so a point does not read
    // `$160k` on the axis, `$163.1k` as a label and `$163.09k` under the
    // pointer, which is what three separate pipelines produced.
    const host = await render(
      chart(
        [
          <Axis key="y" side="left" />,
          <LineSeries key="l">
            <PointLabel at="last" />
          </LineSeries>,
          <Scrubber key="s" />,
        ],
        { locale: 'en-US', timeZone: 'UTC' },
      ),
    );
    const hit = host.querySelector('rect')!;
    await act(async () => {
      for (let i = 0; i < 3; i++) {
        hit.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        );
      }
    });
    const labels = [...host.querySelectorAll('svg text')]
      .map((t) => t.textContent!)
      .filter((t) => t.startsWith('4'));
    const readout = host.querySelector('[class*="readout"]')!.textContent!;
    // Brokerage's last point, as an end label and under the pointer.
    expect(labels).toContain('460.0');
    expect(readout).toContain('460.0');
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
