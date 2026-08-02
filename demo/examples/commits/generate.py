#!/usr/bin/env python3
"""Generate the commit-log demo dataset (pivot over a derived weekday).

Dev-time only: standard library + seeded RNG for determinism. Writes data.json
next to this script in the `{meta, rows}` wire form, so the timestamp column
declares its own encoding — that is a property of the data, not of any view.

Commit times deliberately cover the full 24 hours (with a chunk near the UTC
day boundary) so switching the demo's time zone visibly moves commits between
weekday columns.
"""
import datetime as dt
import json
import os
import random

random.seed(11)

AUTHORS = [
    "Ada Lovelace",
    "Grace Hopper",
    "Alan Turing",
    "Barbara Liskov",
    "Ken Thompson",
    "Radia Perlman",
    "Donald Knuth",
]

# `encoding` says how the value is written; `kind: ['timestamp']` follows from
# it automatically, so it need not be spelled out.
META = {
    "committedAt": {"displayName": "Committed", "encoding": "rfc3339"},
    "author": {"displayName": "Author"},
    "linesAdded": {"displayName": "Added", "kind": ["count"]},
    "linesRemoved": {"displayName": "Removed", "kind": ["count"]},
}

START = dt.datetime(2026, 1, 5, tzinfo=dt.timezone.utc)  # a Monday


def main() -> None:
    rows = []
    for _ in range(900):
        author = random.choice(AUTHORS)
        day = random.randrange(0, 84)  # twelve weeks
        # Most commits land in working hours; a deliberate tail sits late in the
        # UTC day, where a zone change pushes them onto the next weekday.
        hour = random.choice(
            [random.randrange(8, 19)] * 4 + [random.randrange(19, 24)]
        )
        when = START + dt.timedelta(
            days=day, hours=hour, minutes=random.randrange(0, 60)
        )
        rows.append(
            {
                "committedAt": when.isoformat().replace("+00:00", "Z"),
                "author": author,
                "linesAdded": random.randrange(1, 420),
                "linesRemoved": random.randrange(0, 260),
            }
        )

    rows.sort(key=lambda r: r["committedAt"])
    out = os.path.join(os.path.dirname(__file__), "data.json")
    with open(out, "w") as f:
        json.dump({"meta": META, "rows": rows}, f, indent=0)
    print(f"wrote {len(rows)} rows -> {out}")


if __name__ == "__main__":
    main()
