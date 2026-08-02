#!/usr/bin/env python3
"""Generate the fleet-metrics demo dataset (flat table with unit metadata).

Dev-time only: standard library + seeded RNG for determinism. Writes data.json
next to this script, in the `{meta, rows}` wire form so the column metadata —
including the compound units — travels with the data in one document.
"""
import json
import os
import random

random.seed(7)

REGIONS = ["us-east", "us-west", "eu-central", "ap-south"]
ROLES = ["api", "worker", "cache", "ingest"]

# Column metadata. Unit-related fields are index-aligned parallel arrays: entry
# `i` describes factor `i`, repetition squares a factor, and a `1/` prefix
# inverts it. Shortnames are deduced from the built-in tables when omitted.
META = {
    "host": {"displayName": "Host"},
    "region": {"displayName": "Region"},
    "role": {"displayName": "Role"},
    # RAM is conventionally binary: mebi (2^20), not mega (10^6).
    "memory": {
        "displayName": "Memory",
        "kind": ["memory"],
        "unit": ["byte"],
        "scale": ["mebi"],
    },
    "latency": {
        "displayName": "Latency",
        "kind": ["duration"],
        "unit": ["second"],
        "scale": ["milli"],
    },
    # Unitless: a bare scale is a complete unit on its own. No `kind` needed —
    # "percentage" is what the scale already says.
    "cpu": {
        "displayName": "CPU",
        "scale": ["percent"],
    },
    "throughput": {
        # tokens per second: two factors, the second inverted.
        "displayName": "Throughput",
        "kind": ["count", "1/duration"],
        "unit": ["token", "1/second"],
        "scale": ["kilo", None],
    },
    "bandwidth": {
        # Deliberately decimal, unlike memory above: throughput is quoted in
        # MB/s, so one table shows both a binary and an SI prefix.
        "displayName": "Bandwidth",
        "kind": ["memory", "1/duration"],
        "unit": ["byte", "1/second"],
        "scale": ["mega", None],
    },
    "floorArea": {
        # length x length: the same factor twice, rendered as an exponent.
        "displayName": "Rack Area",
        "kind": ["length", "length"],
        "unit": ["meter", "meter"],
    },
}


def main() -> None:
    rows = []
    for i in range(72):
        region = REGIONS[i % len(REGIONS)]
        role = random.choice(ROLES)
        rows.append(
            {
                "host": f"{role}-{region}-{i:02d}",
                "region": region,
                "role": role,
                "memory": round(random.uniform(512, 30720), 1),
                "latency": round(random.uniform(0.4, 480), 2),
                "cpu": round(random.uniform(2, 98), 1),
                "throughput": round(random.uniform(0.2, 64), 2),
                "bandwidth": round(random.uniform(1.5, 940), 1),
                "floorArea": round(random.uniform(0.6, 2.4), 2),
            }
        )

    # A couple of nulls to exercise skipna handling in the footer aggregations.
    rows[3]["latency"] = None
    rows[11]["throughput"] = None

    out = os.path.join(os.path.dirname(__file__), "data.json")
    with open(out, "w") as f:
        json.dump({"meta": META, "rows": rows}, f, indent=0)
    print(f"wrote {len(rows)} rows -> {out}")


if __name__ == "__main__":
    main()
