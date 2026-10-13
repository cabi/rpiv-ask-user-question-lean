#!/usr/bin/env python3
"""Run the full live comparison: prompts x reps x {upstream, lean}.

Alternates arm order between reps to avoid ordering bias, runs everything
sequentially, and prints a result table + totals.

Usage: run_all.py [reps]   (default 2)
"""
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
FIXTURE = os.path.join(HERE, "fixture")
OUTDIR = os.path.join(HERE, "runs")
UPSTREAM_EXT = os.path.join(
    REPO, "node_modules", "@juicesharp", "rpiv-ask-user-question", "index.ts"
)
LEAN_EXT = os.path.join(REPO, "src", "index.ts")
ARMS = {"upstream": UPSTREAM_EXT, "lean": LEAN_EXT}


def main():
    reps = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    prompts = [
        ln.strip()
        for ln in open(os.path.join(HERE, "prompts.txt"))
        if ln.strip()
    ]
    os.makedirs(OUTDIR, exist_ok=True)
    results = []

    for rep in range(1, reps + 1):
        order = list(ARMS.items()) if rep % 2 == 1 else list(ARMS.items())[::-1]
        for pi_, prompt in enumerate(prompts, 1):
            for arm, ext in order:
                slug = f"rep{rep}-p{pi_}-{arm}"
                out = os.path.join(OUTDIR, f"{slug}.jsonl")
                summary_path = os.path.join(OUTDIR, f"{slug}.json")
                if os.path.exists(summary_path):
                    with open(summary_path) as f:
                        summary = json.load(f)
                    print(f"[skip] {slug}: ask_calls={summary['ask_calls']}")
                else:
                    t0 = time.time()
                    r = subprocess.run(
                        [
                            sys.executable, os.path.join(HERE, "run_one.py"),
                            "--ext", ext,
                            "--fixture", FIXTURE,
                            "--prompt", prompt,
                            "--out", out,
                            "--summary", summary_path,
                        ],
                        capture_output=True, text=True, timeout=480,
                    )
                    with open(summary_path) as f:
                        summary = json.load(f)
                    print(
                        f"[{int(time.time()-t0)}s] {slug}: "
                        f"ask={summary['ask_calls']} "
                        f"textq={summary['asked_in_text']} "
                        f"tools={summary['tool_calls']} "
                        f"{'TIMEOUT' if summary['timed_out'] else ''}",
                        flush=True,
                    )
                summary.update({"rep": rep, "prompt_idx": pi_, "arm": arm})
                results.append(summary)

    print("\n=== per prompt ===")
    header = f"{'prompt':<55} " + " ".join(f"{a:>9}" for a in ARMS)
    print(header)
    for pi_, prompt in enumerate(prompts, 1):
        cells = []
        for arm in ARMS:
            calls = [
                r["ask_calls"] for r in results
                if r["prompt_idx"] == pi_ and r["arm"] == arm
            ]
            cells.append(f"{sum(calls)}/{len(calls)}")
        print(f"{prompt[:52]:<55} " + " ".join(f"{c:>9}" for c in cells))
    print("\n=== totals ===")
    for arm in ARMS:
        runs = [r for r in results if r["arm"] == arm]
        ask = sum(r["ask_calls"] for r in runs)
        used = sum(1 for r in runs if r["ask_calls"] > 0)
        textq = sum(1 for r in runs if r["asked_in_text"])
        avg = sum(r["duration_s"] for r in runs) / max(len(runs), 1)
        print(
            f"{arm:>9}: {used}/{len(runs)} runs used ask_user_question "
            f"({ask} calls total), asked-in-text instead: {textq}, "
            f"avg {avg:.0f}s/run"
        )

    with open(os.path.join(OUTDIR, "results.json"), "w") as f:
        json.dump(results, f, indent=1)


if __name__ == "__main__":
    main()
