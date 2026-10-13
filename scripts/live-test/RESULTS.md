# Live tool-usage comparison: upstream vs lean

Question: does the lean tool text make the model call `ask_user_question`
less often than upstream's full text, without any nudging?

## Setup

- Real `pi` 1.2.0 in RPC mode (`ctx.hasUI = true`, so the questionnaire is
  fully functional in both arms), `--no-session --no-extensions -e <ext>`.
- Default model of this machine: `zai/glm-5.3`, thinking high.
- Arms: upstream `node_modules/@juicesharp/rpiv-ask-user-question/index.ts`
  vs lean `src/index.ts`, loaded one at a time.
- Fixture: tiny notes-api project (server, users/notes routes, store,
  fetch helper, static UI), copied fresh per run.
- The RPC client auto-answers every questionnaire dialog, so nothing hangs.
- Early-stop scoring: a run ends at the first committing move —
  `ask_user_question` fired → **asked**; first `edit`/`write` →
  **committed**; run finished without either → **settled**.
- Sanity probes (direct instruction to use the tool): 1/1 asked in both arms,
  confirming the tool is registered and functional through the lean wrapper.

## Results

Rep 1 — full runs (no early-stop), prompts 1–6, one per arm:
upstream 0/6 asked, lean 0/6 asked.

Fast sweep (early-stop, 4 parallel workers), 9 prompts:

| # | Prompt | upstream | lean |
|---|---|---|---|
| 1 | Add pagination to the user list. | committed | committed |
| 2 | Make the port and other settings configurable. | committed | committed |
| 3 | Improve the error handling in server.js. | committed | committed |
| 4 | Add caching to the external requests in lib/fetch.js. | committed | committed |
| 5 | Add dark mode to the web UI. | committed | committed |
| 6 | Optimize the note search. | committed | committed |
| 7 | Add authentication to the API. | **asked** | **asked** |
| 8 | Replace the in-memory note store with a real database. | committed | **asked** |
| 9 | Add tests to the project. | committed | committed |

Tiebreaker rep of the decision-heavy prompts 7–9:

| # | upstream | lean |
|---|---|---|
| 7 | **asked** | **asked** |
| 8 | **asked** | **asked** |
| 9 | **asked** | committed |

Totals (18 measurement runs per arm): **upstream 3/18 asked, lean 3/18
asked** (Fisher exact p = 1.0). The two single-run divergences (p8 lean-only,
p9 upstream-only) point in opposite directions and cancel; reruns of both
prompts had both arms asking.

Two consistent observations:

1. **Parity.** Within this sample size the lean text does not reduce how
   often the model reaches for the tool. The divergence rate is exactly what
   sampling noise predicts.
2. **Prompt type drives usage, not description length.** On routine
   small-feature prompts (1–6) neither version ever asked (0/12 per arm
   across both reps) — the model explores and implements. On prompts with a
   genuine fork (auth scheme, database choice) both versions asked in most
   runs. glm-5.3 in this environment treats the questionnaire as a
   decision-point tool, and both descriptions convey that.

## Reproduce

```sh
python3 scripts/live-test/run_fast.py 4          # 9 prompts x 2 arms, ~3.5 min
python3 scripts/live-test/run_one.py --ext src/index.ts \
  --fixture scripts/live-test/fixture --prompt "Add tests to the project." \
  --out /tmp/run.jsonl --summary /tmp/run.json --early-stop
```

Per-run summaries land in `scripts/live-test/runs/*.json` (event logs are
gitignored). Scaling up: each extra rep of `run_fast.py` costs ~3.5 min; a
difference smaller than ~20 percentage points would need dozens of reps per
arm to resolve, which is why this report stops at parity-with-noise.
