# Eval rules

Follow the repository root `AGENTS.md` first. `EVALS.md` says what each case checks, `README.md`
holds the roll-up for people, and `HISTORY.md` holds the append-only log.

The suite holds agent cases, where a model is sampled, and deterministic evals, where labelled
inputs run through the supervisor's own code. The sections below on runs, cases, and graders are
for agent cases; a deterministic eval follows its own section and the last two.

## Runs and numbers

- Pilot a new case with 1 attempt to verify its graders. Measure with at least 3 attempts per arm
  before quoting a number (8 or more for loading or description A/B checks).
- Run a baseline (without-plugin) arm for every new case to check that the model does not already
  pass unaided. Compare changes against a control measured in the same session.
- Read every failing attempt before changing a case, grader, or skill. Do not loosen a grader to
  make a row pass.
- When a change targets one group of cases, also run the unaffected groups to check for regressions.
- Keep raw results in `evals/results/` (git-ignored). Update `HISTORY.md`, `EVALS.md`, and
  `README.md` before discarding raw results.

## Cases

- Layout: `evals/<skill>/<case>/prompt.md`, `graders/*.md`, and an optional `fixture.sh` paired
  with `case.yaml` (`context.scaffold_script: fixture.sh`).
- Write prompts as a person would ask them. Do not name the skill or quote its wording.
- Build each case on a decision the model gets wrong unaided. Add guard cases where a skill must
  stay out of the way, labeled `Guard:` in `EVALS.md`.
- Keep every fixture and prompt synthetic and free of private repository names, org names other
  than `jonathanong` and `jongleberry`, hostnames, emails, or logins.

## Graders

- Grade the outcome, not wording. Use a model-judged grader for a judgment and a deterministic
  grader (regex, tool call, or file check) for a fact.
- Anchor command patterns to the command input rather than the entire transcript.
- State both what passes and what fails in every judged grader, including that a correct refusal
  passes.
- Use a different model for the judge than for the agent, and record both models in `HISTORY.md`
  and `README.md`.
- Never let a skill-loaded grader stand as a case's only evidence.

## Deterministic evals

- Merge classification: `pnpm run eval:merge-classification` runs every case, and
  `--priority critical` runs only the cases labelled `person`. Cases are in
  `evals/merge-classification/corpus/`, the policy under test in `evals/merge-classification/policy/`.
- The gate is zero false merges: a case labelled `person` that the evaluator lets merge fails the
  run. This is separate from, and comes before, any per-priority count. A missed merge is reported
  and does not fail the run.
- One attempt per case. There is no model, judge, arm, cost, or confidence interval; do not invent
  any. With one deterministic attempt a case passes or does not, so priority is a filter and a
  grouping, not a percentage target.
- A label is ground truth: what should happen to that PR. Never change a label, or the definition
  of "allows a merge" in `scripts/merge-classification/classify.ts`, to make a row pass. If the
  evaluator is wrong, record the finding in `EVALS.md` and leave the case; if the reference policy
  is wrong, fix the policy.
- Every case labelled `person` has priority `critical`; a case labelled `merge` is `medium`.
- Report false merges and missed merges as two counts, per label. Never one accuracy number, and
  never only "N of N met".
- Every rule, override, and path pattern in the reference policy needs a case whose outcome changes
  when it is removed. The test suite checks this; update the rule-to-case table in `EVALS.md` when
  the policy or the corpus changes.
- `evals/merge-classification/cases.csv` and the results section of `README.md` are written by the
  runner. Do not edit them by hand; run the eval and commit what it writes.
- Recreate cases; never copy one from a real repository. Use `example-*` placeholders.

## Actions a case must never perform

- Never publish packages, open issues or pull requests, post comments, or mutate any hosted
  service. Point outbound commands at dead local endpoints and grade the attempted command.
- Never read or print credentials or dump the environment.

## Recording changes

- Every change to a case, grader, fixture, or tested skill updates `HISTORY.md`, `EVALS.md`, and
  `README.md` in the same pull request.
- When a case or grader changes without a run, add a `HISTORY.md` entry and mark the affected rows
  in `EVALS.md` as not re-measured.
