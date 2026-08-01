#!/usr/bin/env python3
"""Generate the AI-token-spend dataset (multi-level rows: team > project > model)."""
import json
import os
import random

random.seed(3)

TEAMS = ["Platform", "Research", "Growth", "Support"]
PROJECTS = {
    "Platform": ["api-gateway", "ingest", "billing"],
    "Research": ["eval-harness", "fine-tune", "agents"],
    "Growth": ["copywriter", "seo-bot", "ads"],
    "Support": ["helpdesk", "triage"],
}
MODELS = ["opus-4.8", "sonnet-4.6", "haiku-4.5"]
MODEL_RATE = {"opus-4.8": 15.0, "sonnet-4.6": 3.0, "haiku-4.5": 0.8}  # $/Mtok blended


def main() -> None:
    rows = []
    for team in TEAMS:
        for project in PROJECTS[team]:
            for model in MODELS:
                # A handful of usage records per (team, project, model).
                for _ in range(random.randint(3, 6)):
                    inp = random.randint(2_000, 4_000_000)
                    out = int(inp * random.uniform(0.1, 0.6))
                    cached = int(inp * random.uniform(0.0, 0.5))
                    billable = inp - cached + out
                    cost = billable / 1_000_000 * MODEL_RATE[model]
                    rows.append(
                        {
                            "team": team,
                            "project": project,
                            "model": model,
                            "inputTokens": inp,
                            "outputTokens": out,
                            "cachedTokens": cached,
                            "costUsd": round(cost, 4),
                        }
                    )

    out_path = os.path.join(os.path.dirname(__file__), "data.json")
    with open(out_path, "w") as f:
        json.dump(rows, f, indent=0)
    # Result rows = team x project x model combinations.
    combos = sum(len(p) for p in PROJECTS.values()) * len(MODELS)
    print(f"wrote {len(rows)} rows ({combos} grouped rows) -> {out_path}")


if __name__ == "__main__":
    main()
