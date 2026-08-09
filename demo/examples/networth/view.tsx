import {
  Axis,
  BarSeries,
  GraphBox,
  Legend,
  LineSeries,
  PointLabel,
  Scrubber,
} from '../../../src';
import type { ChartExampleProps } from '../chart';

/**
 * Ten years of account balances, as a line per account.
 *
 * A chart is composed rather than configured: `GraphBox` works out the scales
 * from the four field names, and everything nested inside reads them. Swapping
 * `<LineSeries>` for `<BarSeries>` needs no other change, and a mark this file
 * does not use — one of your own, reading `useGraph()` and `useDatum()` — would
 * drop in beside them.
 *
 * Nothing here says "dollars" or "thousands". The `balance` column's metadata
 * says it is a price in dollars; the scale ladder sees six-figure values and
 * picks the $k rung for the whole axis; the axis title composes `Net worth
 * ($k)` from the result. That is the same pipeline the table's unit toggles
 * drive — and `unitPlacement` on the box moves the label onto the values
 * instead, or off, for the whole chart at once.
 */
export function Chart({
  data,
  theme,
  locale,
  timeZone,
  unitPlacement,
}: ChartExampleProps) {
  return (
    <>
      <GraphBox
        data={data}
        x="month"
        y="balance"
        series="account"
        agg="sum"
        // Largest holding first, down to the largest debt. The legend follows,
        // so it reads as a ranking rather than an alphabet.
        order="value"
        height={340}
        theme={theme}
        locale={locale}
        timeZone={timeZone}
        unitPlacement={unitPlacement}
        // The mortgage is negative and the assets are not, so the axis has to
        // show zero for the two to be comparable at all.
        includeZero
      >
        <Axis side="left" grid />
        <Axis side="bottom" />
        {/* No `area` here: four 10% washes over one another read as mud. It
            earns its keep on one or two series, not on four. */}
        <LineSeries>
          {/* Children are rendered once per point, so this is how a mark gets
              at a datum. Labelling every one of them would be 480 numbers
              nobody reads, so `at` picks one per line. */}
          <PointLabel at="last" />
        </LineSeries>
        <Scrubber />
        <Legend />
      </GraphBox>

      {/* The same data asked a different question: not what each account is
          worth now, but what went into it. `agg="sum"` over every month makes
          each bar the decade's total, which is the only reading of a monthly
          inflow that means anything on its own — and it is why these numbers
          do not match the line ends above. Brokerage took 183k and is worth
          373k; Retirement took 162k and is worth 151k.

          It also shows that the x axis follows the field rather than the mark:
          `account` is categorical, so the scale becomes a band. */}
      <GraphBox
        data={data}
        x="account"
        y="contribution"
        agg="sum"
        // Ranked by its own measure, which puts the bars in a different order
        // than the chart above — and changes no colours, because a slot comes
        // from the account's name, never from where it happens to be sorted.
        order="value"
        height={200}
        theme={theme}
        locale={locale}
        timeZone={timeZone}
        unitPlacement={unitPlacement}
        includeZero
      >
        <Axis side="left" grid />
        <Axis side="bottom" />
        {/* One series, so `colorBy="series"` would paint all four bars the
            same. Colouring by category instead reuses the slots the accounts
            already hold in the chart above, so the legend up there names these
            bars too and the two charts read as one picture. */}
        <BarSeries colorBy="category">
          {/* No scrubber here: with four bars there is nothing to hunt for, so
              hovering to reveal a number is work the chart can just do. `all`
              is right at this count and wrong on the line above, where it
              would be 480 numbers. */}
          <PointLabel at="all" side="outside" />
        </BarSeries>
      </GraphBox>
    </>
  );
}
