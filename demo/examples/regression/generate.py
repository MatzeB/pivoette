#!/usr/bin/env python3
"""Generate the before/after regression dataset (pivot + derived Δ% columns).

Writes the small showcase `data.json` (~60 apps). Pass `--stress` to also write
a large `stress.json` (~10k apps) for the virtualization smoke test / demo
toggle; that file is git-ignored (not committed) to keep the repo small.
"""
import json
import os
import random
import sys

PLATFORMS = ["Intel", "AMD", "GPU"]
REVISIONS = ["before", "after"]
PLATFORM_FACTOR = {"Intel": 1.0, "AMD": 0.92, "GPU": 0.4}

APP_WORDS = [
    "photon", "quasar", "nimbus", "cobalt", "verve", "lumen", "atlas", "orbit",
    "pulse", "vertex", "raster", "cipher", "matrix", "kernel", "vector", "tensor",
    "lambda", "sigma", "delta", "omega", "helix", "prism", "flux", "spark",
    "forge", "anvil", "beacon", "cascade", "drift", "ember", "falcon", "glide",
]


def app_name(i: int, rng: random.Random) -> str:
    return f"{rng.choice(APP_WORDS)}-{i:04d}"


def gen(n_apps: int, samples: int, seed: int) -> list:
    rng = random.Random(seed)
    rows = []
    for i in range(n_apps):
        app = app_name(i, rng)
        base_time = rng.uniform(200, 5000)  # ns
        # Each app has a per-platform improvement (or regression) after the change.
        for platform in PLATFORMS:
            pf = PLATFORM_FACTOR[platform]
            before_center = base_time * pf
            # Mostly improvements (faster after), some regressions.
            delta = rng.gauss(-0.12, 0.15)
            after_center = before_center * (1 + delta)
            for revision in REVISIONS:
                center = before_center if revision == "before" else after_center
                spread = center * 0.06
                for _ in range(samples):
                    t = max(1.0, rng.gauss(center, spread))
                    rows.append(
                        {
                            "app": app,
                            "platform": platform,
                            "revision": revision,
                            "timeNs": round(t, 1),
                        }
                    )
    return rows


def main() -> None:
    here = os.path.dirname(__file__)
    rows = gen(n_apps=60, samples=5, seed=11)
    out = os.path.join(here, "data.json")
    with open(out, "w") as f:
        json.dump(rows, f, indent=0)
    print(f"wrote {len(rows)} rows (60 apps) -> {out}")

    if "--stress" in sys.argv:
        big = gen(n_apps=10000, samples=1, seed=99)
        sout = os.path.join(here, "stress.json")
        with open(sout, "w") as f:
            json.dump(big, f, indent=0)
        print(f"wrote {len(big)} rows (10000 apps) -> {sout}")


if __name__ == "__main__":
    main()
