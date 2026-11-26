# Eval history

This log only grows, newest entry first. Scores in different entries are not comparable when a
case, grader, fixture, or model changed between them; each entry says what changed. The current
scores are in [EVALS.md](EVALS.md).

## 2026-11-25: First merge-classification run

- Commit: `2204eb0`. Command: `pnpm run eval:merge-classification`.
- Deterministic eval: one attempt per case, no agent model, no judge model, no with/without-plugin
  arm, cost $0. The result does not vary between runs, so there are no confidence intervals.

Raw counts, 80 cases:

| Label    | Cases | Correct | False merges | Missed merges |
| -------- | ----- | ------- | ------------ | ------------- |
| `person` | 65    | 65      | 0            | 0             |
| `merge`  | 15    | 14      | 0            | 1 (docs-06)   |

Gate (zero false merges): pass. Next step `merge` without an `approves` verdict: 2 (human-04,
scope-06).

What changed:

- Added the merge-classification eval: a reference supervisor policy with one directory policy
  below it, 80 synthetic cases in 10 groups, a runner, and the tracking file
  `merge-classification/cases.csv`.
- `README.md`, `EVALS.md`, and `AGENTS.md` now describe deterministic evals beside agent cases.

What the run showed:

- No PR labelled `person` was allowed to merge. "Allowed to merge" means verdict `approves`, next
  step `merge`, no uncovered file, and no unmet seat.
- docs-06 is a missed merge by policy choice: `**/migrations/**` also catches prose under
  `docs/migrations/`.
- Two evaluator findings, recorded in `EVALS.md`: the next step is `merge` for a `comments` verdict
  whose seats are filled (human-04) and for an empty list of changed files (scope-06). Neither is a
  false merge under the definition above; both would be for a caller that trusts the next step or
  the exit code of `supervisor policy check` alone.

## 2026-11-25: Scaffold evals directory

No run.

What changed:

- Initialized `evals/README.md`, `evals/EVALS.md`, `evals/HISTORY.md`, and `evals/AGENTS.md` with
  no cases yet.
