import type { DataTableDisplay, ViewSpec } from '../../../src';

/**
 * Commits by author and weekday.
 *
 * The whole temporal feature in four lines: `committedAt` declares its
 * `encoding` in the data, so it reaches the expression already decoded;
 * `weekday()` turns it into a locale ordinal (0 = whatever day the locale
 * starts on); the integers sort into calendar order by themselves; and
 * `kind: ['weekday']` deduces the format that renders them as names.
 *
 * No `timeZone` here — it defaults to `'auto'`. Setting it changes which
 * calendar day a commit falls on, so it moves commits between columns rather
 * than merely relabelling them.
 */
export const view: ViewSpec = {
  derive: {
    weekday: {
      compute: 'weekday(committedAt)',
      meta: { displayName: 'Weekday', kind: ['weekday'] },
    },
  },
  pivotRows: [{ field: 'author', sort: 'asc' }],
  pivotColumns: [{ field: 'weekday', sort: 'asc' }],
  columns: [
    { id: 'added', source: 'linesAdded', agg: 'sum', label: '+' },
    { id: 'removed', source: 'linesRemoved', agg: 'sum', label: '−' },
  ],
  showSummary: true,
};

/**
 * How the result is presented, once the engine has produced it. Separate from
 * the view because `computeView` never sees it: everything here is applied to
 * the rows that already exist, so changing it repaints without re-pivoting.
 */
export const display: DataTableDisplay = { groupSpacing: 10 };
