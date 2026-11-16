#!/usr/bin/env python3
"""Generate the compiler-benchmark demo dataset (FooCC against BarCC).

Dev-time only: standard library + seeded RNG for determinism. Writes data.json
next to this script, in the `{meta, rows}` wire form.

The story: two compilers, FooCC and BarCC, each built three ways, all
measured against BarCC at -O2. Every number is a *speedup* over that one
reference build (its time / this build's time), so 1.0 means "the same",
above it is faster, and below it is slower — and BarCC's own base build is
exactly 1.0, since it is the reference.

  * base          -O2: for FooCC a small, uneven gain over BarCC.
  * LTO+PGO       link-time optimisation plus profile-guided optimisation.
  * LTO+PGO+Bolt  the same binary, its layout rewritten by BOLT afterwards.

Each variant builds on the one before, so a benchmark's speedup is the product
of the steps it has taken. How much each step buys depends on the program:

  * CPython is an interpreter loop with a huge, branchy hot path: PGO and
    BOLT both pay off handsomely, which is why distributions ship it that way.
  * bzip2 is a few tight kernels that already fit in cache. FooCC is slightly
    *slower* than BarCC at -O2, PGO only just wins that back, and BOLT
    has no layout left to fix — so its base bar crosses the line.
  * zstd sits in between.
  * SPEC 2006 is a dozen unrelated programs, so it averages out — and one of
    them (429.mcf, memory-bound) is slightly *slower* under FooCC,
    though one benchmark in a dozen barely moves a geomean.

The rows are per benchmark; the chart reduces each suite with `geomean`, which
is how speedups are summarised (2x and 0.5x cancel to 1x, as they should).
"""
import json
import os
import random

random.seed(2006)

META = {
    "suite": {"displayName": "Suite"},
    "benchmark": {"displayName": "Benchmark"},
    "compiler": {"displayName": "Compiler"},
    "variant": {"displayName": "Build"},
    "speedup": {"displayName": "Speedup over BarCC -O2"},
}

VARIANTS = ["base", "LTO+PGO", "LTO+PGO+Bolt"]

# suite -> (benchmarks, base gain, PGO gain, BOLT gain, per-benchmark spread)
# Gains are multiplicative factors on top of the variant before.
SUITES = {
    "CPython": (
        ["richards", "nbody", "json_dumps", "regex_v8", "django_template", "go"],
        1.02,
        1.18,
        1.07,
        0.025,
    ),
    "bzip2": (
        ["compress-text", "compress-binary", "decompress-text", "decompress-binary"],
        0.975,
        1.04,
        1.004,
        0.008,
    ),
    "zstd": (
        ["compress-l1", "compress-l19", "decompress", "dict-compress"],
        1.03,
        1.07,
        1.025,
        0.012,
    ),
    "SPEC 2006": (
        [
            "400.perlbench",
            "401.bzip2",
            "403.gcc",
            "429.mcf",
            "445.gobmk",
            "456.hmmer",
            "458.sjeng",
            "462.libquantum",
            "464.h264ref",
            "471.omnetpp",
            "473.astar",
            "483.xalancbmk",
        ],
        1.015,
        1.06,
        1.02,
        0.02,
    ),
}

# BarCC's own LTO+PGO and BOLT gains, per suite: (PGO gain, BOLT gain).
# Its base build *is* the reference, so it is 1.0 by definition and drawn as
# the zero-length bar every other one is measured from.
BARCC = {
    "CPython": (1.14, 1.05),
    "bzip2": (1.03, 1.002),
    "zstd": (1.05, 1.02),
    "SPEC 2006": (1.05, 1.015),
}

# Benchmarks FooCC makes slower than BarCC does, before any of the extra
# optimisation: (suite, benchmark) -> factor applied to every variant.
REGRESSIONS = {
    ("SPEC 2006", "429.mcf"): 0.93,
}


def main() -> None:
    rows = []

    def emit(compiler, suite, bench, steps):
        speedup = 1.0
        for variant, step in zip(VARIANTS, steps):
            speedup *= step
            rows.append(
                {
                    "suite": suite,
                    "benchmark": bench,
                    "compiler": compiler,
                    "variant": variant,
                    "speedup": round(speedup, 4),
                }
            )

    # FooCC first, drawing from the generator exactly as it always has, so
    # adding BarCC leaves FooCC's numbers where they were.
    for suite, (benchmarks, base, pgo, bolt, spread) in SUITES.items():
        for bench in benchmarks:
            penalty = REGRESSIONS.get((suite, bench), 1.0)
            # One draw per step, kept across the variants, so a benchmark that
            # PGO helped stays helped once BOLT is added on top.
            steps = [
                base * random.gauss(1, spread) * penalty,
                pgo * random.gauss(1, spread),
                bolt * random.gauss(1, spread / 2),
            ]
            emit("FooCC", suite, bench, steps)

    for suite, (benchmarks, _base, _pgo, _bolt, spread) in SUITES.items():
        pgo, bolt = BARCC[suite]
        for bench in benchmarks:
            emit(
                "BarCC",
                suite,
                bench,
                [1.0, pgo * random.gauss(1, spread), bolt * random.gauss(1, spread / 2)],
            )

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json")
    with open(out, "w") as f:
        json.dump({"meta": META, "rows": rows}, f, indent=1)
        f.write("\n")
    print(f"wrote {len(rows)} rows to {out}")


if __name__ == "__main__":
    main()
