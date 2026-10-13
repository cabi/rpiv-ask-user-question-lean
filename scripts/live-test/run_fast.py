#!/usr/bin/env python3
"""Run the live comparison fast: early-stop scoring + parallel workers.

Each run is killed at the model's first committing move (ask_user_question
-> asked, edit/write -> committed, run finished -> settled), so a run costs
one or two model turns instead of a full implementation loop. Arms run
concurrently through a worker pool.

Usage: run_fast.py [workers]   (default 4)
"""
import concurrent.futures as cf
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


def run_one(slug, arm, ext, prompt):
    out = os.path.join(OUTDIR, f"{slug}.jsonl")
    summary_path = os.path.join(OUTDIR, f"{slug}.json")
    if os.path.exists(summary_path):
        with open(summary_path) as f:
            summary = json.load(f)
    else:
        subprocess.run(
            [
                sys.executable, os.path.join(HERE, "run_one.py"),
                "--ext", ext,
                "--fixture", FIXTURE,
                "--prompt", prompt,
                "--out", out,
                "--summary", summary_path,
                "--early-stop",
            ],
            capture_output=True, text=True, timeout=300,
        )
        with open(summary_path) as f:
            summary = json.load(f)
    summary.update({"slug": slug, "arm": arm, "prompt": prompt})
    print(f"{slug}: {summary['stop_reason']} ask={summary['ask_calls']} "
          f"textq={summary['asked_in_text']} {summary['duration_s']}s", flush=True)
    return summary


def main():
    workers = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    prompts = [
        ln.strip() for ln in open(os.path.join(HERE, "prompts2.txt")) if ln.strip()
    ]
    os.makedirs(OUTDIR, exist_ok=True)

    jobs = []
    for i, prompt in enumerate(prompts, 1):
        for arm, ext in ARMS.items():
            jobs.append((f"es-p{i}-{arm}", arm, ext, prompt))

    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(run_one, *job) for job in jobs]
        results = [f.result() for f in futures]

    print(f"\n=== {len(results)} runs in {time.time()-t0:.0f}s ===\n")
    print(f"{'prompt':<52} {'upstream':<28} {'lean':<28}")
    for i, prompt in enumerate(prompts, 1):
        cells = []
        for arm in ARMS:
            r = next(x for x in results if x["slug"] == f"es-p{i}-{arm}")
            cells.append(f"{r['stop_reason']:<12} ask={r['ask_calls']} textq={r['asked_in_text']}")
        print(f"{prompt[:49]:<52} " + " ".join(cells))

    print("\n=== totals ===")
    for arm in ARMS:
        runs = [r for r in results if r["arm"] == arm]
        asked = sum(1 for r in runs if r["ask_calls"] > 0)
        committed = sum(1 for r in runs if r["stop_reason"] == "committed")
        settled = sum(1 for r in runs if r["stop_reason"] == "settled")
        textq = sum(1 for r in runs if r["asked_in_text"])
        avg = sum(r["duration_s"] for r in runs) / max(len(runs), 1)
        print(f"{arm:>9}: asked {asked}/{len(runs)}, committed {committed}, "
              f"no-action {settled}, asked-in-text {textq}, avg {avg:.0f}s/run")

    with open(os.path.join(OUTDIR, "results-fast.json"), "w") as f:
        json.dump(results, f, indent=1)


if __name__ == "__main__":
    main()
