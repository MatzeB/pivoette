#!/usr/bin/env python3
"""Generate the net-worth demo dataset (a decade of monthly account balances).

Dev-time only: standard library + seeded RNG for determinism. Writes data.json
next to this script, in the `{meta, rows}` wire form so the column metadata
travels with the data in one document.

The shape is chosen to exercise the chart rather than to look tidy:

  * The mortgage is negative, so the value axis has to straddle zero.
  * The brokerage account opens 30 months in — its rows are simply absent, so
    the line has a real gap rather than a run of zeroes.
  * Balances run from a few thousand to the high hundreds of thousands, which
    puts the shared scale ladder on the k$ rung.
  * `contribution` is the money moved into the account that month — for the
    mortgage, the principal repaid. Summed over the decade it is what each
    account cost, which is the only reading the demo puts on screen.
"""
import json
import math
import os
import random

random.seed(23)

MONTHS = 120
START_YEAR = 2016

META = {
    "month": {
        "displayName": "Month",
        # The only encoding the data layer decodes; `kind: timestamp` follows.
        "encoding": "rfc3339",
    },
    "account": {"displayName": "Account"},
    "balance": {
        "displayName": "Net worth",
        "kind": ["price"],
        "unit": ["dollar"],
    },
    # Named for what a *sum* of it means, since that is the only way a chart
    # ever shows it: one month's inflow on its own says nothing.
    "contribution": {
        "displayName": "Paid in",
        "kind": ["price"],
        "unit": ["dollar"],
    },
}

# name -> (opening balance, monthly drift, volatility, month it opens)
ACCOUNTS = {
    "Checking": (4_200, 60, 900, 0),
    "Retirement": (18_000, 1_450, 2_600, 0),
    "Brokerage": (25_000, 2_100, 7_500, 30),
    "Mortgage": (-286_000, 1_150, 0, 0),
}


def month_iso(i: int) -> str:
    """First of the month, i months after January of START_YEAR."""
    year = START_YEAR + i // 12
    month = i % 12 + 1
    return f"{year}-{month:02d}-01T00:00:00Z"


def main() -> None:
    rows = []
    for name, (opening, drift, volatility, opens) in ACCOUNTS.items():
        balance = float(opening)
        for i in range(MONTHS):
            if i < opens:
                continue
            # A mild cycle on top of the drift, so the lines have some shape
            # to scrub along rather than being straight.
            season = math.sin(i / 6.0) * volatility * 0.35
            balance += drift + random.gauss(0, volatility) + season
            # The mortgage is paid down towards zero and stops there.
            if name == "Mortgage":
                balance = min(balance, 0.0)
            # Signed, and positive for every account including the mortgage:
            # money paid in raises that account's balance, and the mortgage's
            # rises from -286k towards zero as the principal is repaid. Taking
            # an absolute value here would not *establish* that — it would hide
            # a withdrawal by reporting it as a deposit.
            contribution = drift + random.gauss(0, drift * 0.25)
            rows.append(
                {
                    "month": month_iso(i),
                    "account": name,
                    "balance": round(balance, 2),
                    "contribution": round(contribution, 2),
                }
            )

    out = os.path.join(os.path.dirname(__file__), "data.json")
    with open(out, "w") as f:
        json.dump({"meta": META, "rows": rows}, f, indent=0)
    accounts = len({r["account"] for r in rows})
    print(f"wrote {len(rows)} rows ({accounts} accounts x {MONTHS} months) -> {out}")


if __name__ == "__main__":
    main()
