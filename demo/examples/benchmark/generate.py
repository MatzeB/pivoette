#!/usr/bin/env python3
"""Generate the kernel-benchmark demo dataset (multi-level column pivot).

Rows are individual samples so min/max/mean/variance differ per cell.
"""
import json
import os
import random

random.seed(7)

SIZES = ["tiny", "small", "medium", "large"]
ARCHS = ["x86", "AArch64"]
SIZE_FACTOR = {"tiny": 1.0, "small": 8.0, "medium": 64.0, "large": 512.0}
ARCH_FACTOR = {"x86": 1.0, "AArch64": 0.85}

KERNELS = [
    "memcpy", "memset", "strlen", "strcmp", "qsort", "bsearch", "sha256",
    "aes_encrypt", "crc32", "fft", "matmul", "gemm", "conv2d", "softmax",
    "relu", "dropout", "tokenize", "json_parse", "utf8_decode", "base64",
    "gzip", "lz4", "zstd", "regex_match", "sort_radix", "hash_map", "btree_lookup",
    "spinlock", "mutex", "atomic_add", "malloc", "free", "page_fault", "context_switch",
    "syscall", "epoll_wait", "futex", "vector_add", "dot_product", "prefix_sum",
    "histogram", "reduce_sum", "scan", "transpose", "gather", "scatter",
    "bitonic_sort", "merge", "partition", "nth_element", "unique", "rotate",
    "reverse", "fill", "copy_if", "count_if", "accumulate", "inner_product",
]


def main() -> None:
    rows = []
    for kernel in KERNELS:
        base = random.uniform(30, 300)  # ns at tiny/x86
        for size in SIZES:
            for arch in ARCHS:
                center = base * SIZE_FACTOR[size] * ARCH_FACTOR[arch]
                spread = center * random.uniform(0.05, 0.25)
                for _ in range(6):
                    t = max(1.0, random.gauss(center, spread))
                    rows.append(
                        {
                            "benchmark": kernel,
                            "dataSize": size,
                            "architecture": arch,
                            "timeNs": round(t, 1),
                        }
                    )

    out = os.path.join(os.path.dirname(__file__), "data.json")
    with open(out, "w") as f:
        json.dump(rows, f, indent=0)
    print(f"wrote {len(rows)} rows ({len(KERNELS)} kernels) -> {out}")


if __name__ == "__main__":
    main()
