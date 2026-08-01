#!/usr/bin/env python3
"""Generate the stock-ticker demo dataset (flat table).

Dev-time only: standard library + seeded RNG for determinism. Writes data.json
next to this script.
"""
import json
import os
import random
import urllib.parse

random.seed(42)

WORDS = [
    "Acme", "Globex", "Initech", "Umbra", "Stark", "Wayne", "Wonka", "Cyberdyne",
    "Tyrell", "Soylent", "Hooli", "Pied", "Vandelay", "Gringotts", "Oscorp",
    "Massive", "Nakatomi", "Aperture", "Black", "Multi", "Sterling", "Prestige",
    "Dunder", "Sirius", "Xanatos", "Virtucon", "Zorg", "Rekall", "Weyland", "Abstergo",
]
SUFFIX = ["Corp", "Inc", "Labs", "Holdings", "Group", "Systems", "Partners"]
COLORS = ["#e57373", "#64b5f6", "#81c784", "#ffb74d", "#ba68c8", "#4db6ac", "#f06292"]


def svg_data_uri(letters: str, color: str) -> str:
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">'
        f'<rect width="20" height="20" rx="4" fill="{color}"/>'
        f'<text x="10" y="14" font-size="9" fill="white" text-anchor="middle" '
        f'font-family="sans-serif">{letters}</text></svg>'
    )
    return "data:image/svg+xml," + urllib.parse.quote(svg)


def make_symbol(i: int) -> str:
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    return "".join(random.choice(letters) for _ in range(random.choice([3, 4])))


def main() -> None:
    rows = []
    used = set()
    for i in range(64):
        sym = make_symbol(i)
        while sym in used:
            sym = make_symbol(i)
        used.add(sym)
        name = f"{random.choice(WORDS)} {random.choice(SUFFIX)}"
        base = round(random.uniform(12, 480), 2)
        price = round(base * (1 + random.gauss(0.0, 0.13)), 2)
        rows.append(
            {
                "symbol": sym,
                "image": svg_data_uri(sym[:2], random.choice(COLORS)),
                "description": name,
                "price": price,
                "basePrice": base,
            }
        )

    # A couple of nulls to exercise null handling / fallbacks.
    rows[5]["image"] = None
    rows[9]["price"] = None

    out = os.path.join(os.path.dirname(__file__), "data.json")
    with open(out, "w") as f:
        json.dump(rows, f, indent=0)
    print(f"wrote {len(rows)} rows -> {out}")


if __name__ == "__main__":
    main()
