import { Style } from '../../../src';
import type { DataTableDisplay, ViewSpec } from '../../../src';

// light-dark() adapts to the table's color-scheme automatically.
const green = 'light-dark(#137333, #30d158)';
const red = 'light-dark(#c5221f, #ff453a)';

/**
 * Pivot with a per-platform derived Δ% column. Δ% references its own platform's
 * before/after cells (relative colPath); coloring is domain-inverted — faster
 * (negative) is green, a regression (positive) is red.
 */
export const view: ViewSpec = {
  // CSV carries no metadata, so the view supplies it: `timeNs` holds
  // nanoseconds. `autoScale` then reads µs off the data, and the label travels
  // through the same path as the Δ column's `%` — so the unit toggle moves both.
  meta: {
    timeNs: { kind: ['duration'], unit: ['second'], scale: ['nano'] },
  },
  pivotRows: [{ field: 'app', label: 'Application' }],
  pivotColumns: [
    { field: 'platform' },
    {
      field: 'revision',
      // Δ is a member of the revision level, beside `before` and `after` —
      // which is where it is displayed, and where it repeats from. The engine
      // reads "once per platform" off the axis, so moving `platform` to
      // `pivotRows` leaves one Δ per row rather than breaking the reference.
      computed: [
        {
          id: 'delta',
          label: 'Δ',
          inputs: {
            before: { member: 'before' },
            after: { member: 'after' },
          },
          compute: 'before ? (after - before) / before : null',
          place: { after: 'after' },
          // The compute yields a ratio; `factor` converts it to percentage
          // points and the `%` comes from the metadata, so the label follows
          // the unit placement like every other column.
          factor: 100,
          meta: { scale: ['percent'] },
          format: { options: { signDisplay: 'exceptZero' } },
          style: {
            fnName: Style.SignColors,
            options: { negative: green, positive: red },
          },
        },
      ],
    },
  ],
  columns: [
    {
      id: 'mean',
      source: 'timeNs',
      agg: 'mean',
      label: 'mean',
      autoScale: true,
    },
  ],
};

/**
 * How the result is presented, once the engine has produced it. Separate from
 * the view because `computeView` never sees it: everything here is applied to
 * the rows that already exist, so changing it repaints without re-pivoting.
 */
export const display: DataTableDisplay = { groupSpacing: 8 };
