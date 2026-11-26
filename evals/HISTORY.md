# Eval history

This log only grows, newest entry first. Scores in different entries are not comparable when a
case, grader, fixture, or model changed between them; each entry says what changed. The current
scores are in [EVALS.md](EVALS.md).

## 2026-11-26: Protected-file baseline; two cases for protected files below a directory policy

- Commit: `20a9438`. Command: `pnpm run eval:merge-classification`.
- Deterministic eval: one attempt per case, no model, no judge, no arms, cost $0.

Raw counts, 82 cases:

| Label    | Cases | Correct | False merges | Missed merges |
| -------- | ----- | ------- | ------------ | ------------- |
| `person` | 67    | 67      | 0            | 0             |
| `merge`  | 15    | 14      | 0            | 1 (docs-06)   |

Gate (zero false merges): pass. The 80 cases of the entry below kept their outcomes, so the two
entries are comparable for them.

What changed:

- Cases added: policy-07 (a repository policy file inside `packages/widgets`) and policy-08 (a
  classifier definition inside `packages/widgets`), both labelled `person`.
- Reference policy: `.supervisor/**` became `**/.supervisor/**`. Before the fix, a run with the new
  cases gave 1 false merge (policy-07) and failed the gate: the old pattern matched a repository
  policy file only at the root, so the widgets directory policy let the nested one merge on the
  reviewer's approval. That run was on an uncommitted tree and is not recorded in `cases.csv`.
- `src/policy/evaluate.ts`: a changed policy file or classifier definition that no rule applies to
  now gets a baseline verdict of `comments` and one seat for a person other than the author. No
  case's outcome depends on it, because the reference policy has a rule on every protected path.
  A new test runs the eight cases that change a protected file against no policy at all and checks
  the baseline.

What the run showed:

- No PR labelled `person` was allowed to merge.
- policy-08 was already met before the policy fix, through the inherited `**/.claude/classifiers/**`
  pattern, which it now guards beside policy-02.

## 2026-11-25: Evaluator fix; "allows a merge" now means the next step

- Commit: `ef50c2b`. Command: `pnpm run eval:merge-classification`.
- Deterministic eval: one attempt per case, no model, no judge, no arms, cost $0.

Raw counts, 80 cases: unchanged from the entry below. False merges 0; missed merges 1 (docs-06).
Gate (zero false merges): pass.

What changed:

- `src/policy/evaluate.ts`: the next step is `merge` only when every changed file has a rule
  whose verdict is `approves`. A `comments` verdict, a file no rule covers, and an empty change
  now escalate. This closes both findings of the first run (human-04, scope-06).
- Grader change: "the evaluator allows a merge" is now the evaluator's next step alone, in place
  of the four-part check of the first run. No case changed outcome, so the two entries are
  comparable. The separate count of merge next steps without an `approves` verdict is gone.

What the run showed:

- The evaluator's own answer, which `supervisor policy check` prints and a loop acts on, now
  merges no case labelled `person`.

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
