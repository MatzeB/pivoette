import type { ViewSpec } from '../../../src';

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
  rows: ['author'],
  columns: ['weekday'],
  rowSort: [{ field: 'author', direction: 'asc' }],
  columnSort: [{ field: 'weekday', direction: 'asc' }],
  values: [
    { id: 'added', field: 'linesAdded', agg: 'sum', label: '+' },
    { id: 'removed', field: 'linesRemoved', agg: 'sum', label: '−' },
  ],
  showSummary: true,
};
