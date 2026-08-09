/**
 * The DOM pieces jsdom does not have, for tests that render.
 *
 * jsdom implements no layout and only part of the event model, so three things
 * a chart depends on are simply absent: `ResizeObserver`, `PointerEvent`, and
 * pointer capture. Each is stubbed here rather than in each test file, so two
 * suites in one worker cannot install incompatible versions of the same stub —
 * the `??=` idiom the older test files use means whichever file loads first
 * wins, which is fine while every stub is a no-op and a trap as soon as one
 * of them does something.
 *
 * What is deliberately *not* here: `getBBox`, `getScreenCTM`, `createSVGPoint`.
 * Those are missing too, and the chart is written never to call them — see the
 * margin note in `GraphBox.tsx`. Stubbing them would let that constraint rot.
 */

export interface TestDomOptions {
  /**
   * Width a `ResizeObserver` reports, synchronously on `observe`. Omitted, the
   * observer is inert and a responsive chart never gets a size — which is what
   * every test that passes an explicit `width` wants.
   */
  resizeTo?: number;
}

export function installTestDom(options: TestDomOptions = {}): void {
  // react-dom needs this to accept `act`.
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  const { resizeTo } = options;
  class TestResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      if (resizeTo === undefined) return;
      // Synchronous, unlike the real thing: a test wants the measured render
      // without an extra tick, and nothing here depends on the timing.
      this.callback(
        [
          {
            target,
            contentRect: { width: resizeTo, height: 0 } as DOMRectReadOnly,
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver =
    TestResizeObserver as unknown as typeof ResizeObserver;

  // React listens for the native `pointermove`; jsdom has MouseEvent but no
  // PointerEvent, and a MouseEvent dispatched under that name works. Giving it
  // the real name keeps the tests reading like the code they exercise.
  if (
    typeof (globalThis as { PointerEvent?: unknown }).PointerEvent !==
    'function'
  ) {
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      constructor(
        type: string,
        init: MouseEventInit & { pointerId?: number } = {},
      ) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    (globalThis as { PointerEvent?: unknown }).PointerEvent = TestPointerEvent;
  }

  // Capture is optional in the product code, but defining it keeps a test from
  // depending on which branch it took.
  const proto = Element.prototype as Element & {
    setPointerCapture?: (id: number) => void;
    releasePointerCapture?: (id: number) => void;
    hasPointerCapture?: (id: number) => boolean;
  };
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.hasPointerCapture ??= () => false;
}

/**
 * Pin an element's box, since jsdom measures everything as zero.
 *
 * A chart reads exactly one rect — the scrubber's hit area — to turn a
 * `clientX` into a plot coordinate. Left at zero, a test's `clientX: 120`
 * simply means "120 pixels into the element", which is a perfectly good way to
 * write the assertion; this is for the cases where it is not.
 */
export function stubRect(el: Element, rect: Partial<DOMRect>): void {
  el.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      ...rect,
      toJSON: () => ({}),
    }) as DOMRect;
}
