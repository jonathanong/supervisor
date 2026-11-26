# Evals

**Does the supervisor merge only what it may, and does an agent with the `supervisor` plugin follow each skill's guidance?**

The suite holds two kinds of eval:

- **Deterministic evals** run labelled inputs through the supervisor's own code. There is no model, so there is one attempt per case, no judge, no with/without-plugin arm, and no cost.
- **Agent cases** give an agent a plain request without naming a skill. Graders check that the right skill loaded and that the agent made the intended decision; the same case without the plugin shows whether the skill changes the outcome. None exist yet.

## Current results

### Merge classification (deterministic)

The question: on a labelled set of pull requests, does the policy evaluator ever let the supervisor merge one that should have gone to a person? `docs/guardrails.md` makes this the eval that gates every step that lets the supervisor merge anything.

**The gate is zero false merges.** A false merge (label `person`, evaluator allows a merge) fails the run. A missed merge (label `merge`, evaluator sends it to a person) costs time; it is reported and does not fail the run. The two are always counted separately and never folded into one accuracy number.

<!-- merge-classification:results:start (generated from cases.csv) -->

Run: 2026-11-26 at commit `20a9438`. One deterministic attempt per case: no model, no judge, no arms, cost $0.

Gate (zero false merges): **pass**. False merges: 0. Missed merges: 1 (docs-06).

| Label  | Priority | Cases | Met | False merges | Missed merges |
| ------ | -------- | ----- | --- | ------------ | ------------- |
| person | critical | 67    | 67  | 0            | 0             |
| merge  | medium   | 15    | 14  | 0            | 1             |

| Group                    | Cases | Met | False merges | Missed merges |
| ------------------------ | ----- | --- | ------------ | ------------- |
| always-human             | 7     | 7   | 0            | 0             |
| dependency-bot           | 9     | 9   | 0            | 0             |
| docs-only                | 10    | 9   | 0            | 1             |
| flake-fix                | 9     | 9   | 0            | 0             |
| lockfile                 | 7     | 7   | 0            | 0             |
| needs-person-label       | 2     | 2   | 0            | 0             |
| nested-policy            | 6     | 6   | 0            | 0             |
| policy-self-modification | 8     | 8   | 0            | 0             |
| repository-scope         | 6     | 6   | 0            | 0             |
| test-only                | 18    | 18  | 0            | 0             |

<!-- merge-classification:results:end -->

The section between the markers is written by the runner from [merge-classification/cases.csv](merge-classification/cases.csv), which holds the latest result of every case. Do not edit either by hand.

### Agent cases

No cases or measured runs exist yet (0 cases). When the first cases are measured, this section will show the latest single-run table with date, commit, agent model, judge model, attempts per arm, and total cost.

## What each case checks

Merge classification, by group. [EVALS.md](EVALS.md) lists the groups with their counts and maps each policy rule to the cases that guard it; the cases are in [merge-classification/corpus/](merge-classification/corpus/).

- `dependency-bot`: a dependency bot's PR merges once the reviewer bot approves, and not when a person shares the branch, a look-alike account opened it, or it touches an always-human path.
- `lockfile`: a lockfile change merges only when every author is an automation account.
- `test-only`: a change confined to tests merges once reviewed and shown to trade no coverage; a source file, a directory merely named `test`, a stale or self-made approval, or a missing classifier result sends it to a person.
- `docs-only`: a change confined to `docs/` or the README merges once reviewed; source in the same PR, agent instructions, or the wrong approver sends it to a person.
- `flake-fix`: a classified flake fix merges once reviewed; a label alone, a retry or timeout, or an unfinished classifier does not.
- `always-human`: CI definitions, migrations, payments and billing, release and signing, and secrets go to a person whatever carve-out also matches.
- `policy-self-modification`: a change to a policy file or a classifier, at any depth, or to this eval goes to a person.
- `needs-person-label` and `repository-scope`: a hold label, a repository outside the reviewed scopes, or facts that were never gathered send the PR to a person.
- `nested-policy`: a directory's own policy can add a carve-out and cannot remove an inherited rule.

## How to read the numbers

- **What "the evaluator allows a merge" means.** The evaluator's next step is `merge`, which is what `supervisor policy check` reports with exit code 0. The evaluator gives that step only when every changed file has a rule whose verdict is `approves` and no seat has anyone still missing.
- **Priority.** Every case labelled `person` is `critical`, because a false merge is the one mistake the next sweep cannot undo. Every case labelled `merge` is `medium`. Priority filters and groups the cases; with one deterministic attempt a case either passes or does not, so there are no percentage targets.
- **A missed merge may be deliberate.** A case whose label and outcome differ stays in the corpus with its reason in [EVALS.md](EVALS.md). Labels are ground truth and are not changed to make a row pass.
- For agent cases: report both arms whenever a baseline arm applies, mark a case whose baseline passes as a ceiling case, and give raw pass counts beside rates (for example, `2 of 3`).

## What the suite does not measure

- **Whether the corpus resembles real pull requests.** Every case is synthetic and written by hand. The merge-classification result does not vary between runs, so there is no sampling noise and no confidence interval; the open uncertainty is whether the corpus covers what real PRs do.
- **The facts themselves.** A case states its facts (authors, approvals, labels, classifier results). Gathering them from GitHub, dropping approvals made on an earlier head, and running classifiers are not exercised. The input format has no head commit, so "approved on a stale head" can only be written as "no approval".
- **Diff content.** The evaluator sees paths, not hunks: a secret added to a docs page, or a workflow permission change, is visible only through its path or a classifier.
- **Policies other than the reference policy,** required CI, the stop switch, budgets, and the separate always-human check before a merge.
- Real-world skill loading frequency in a full multi-plugin environment.
- Live GitHub or external service mutations: fixtures stay synthetic and never write to hosted services.

## How to run it

```sh
pnpm run eval:merge-classification                      # every case
pnpm run eval:merge-classification --priority critical  # only cases labelled person
```

It compiles `src/` and evaluates the corpus against the reference policy in [merge-classification/policy/](merge-classification/policy/). It needs no network, credentials, or model, and takes about a second. It prints one row per case and the totals, and exits non-zero on any false merge. A full run rewrites `merge-classification/cases.csv` and the results section above; a filtered run rewrites neither.

No runner is wired for agent cases yet. Their raw results will land in `evals/results/`, which git ignores.

## More

- [EVALS.md](EVALS.md): the groups, the rule-to-case map, and known findings.
- [HISTORY.md](HISTORY.md): every measured run and every change to a case, grader, or fixture.
- [AGENTS.md](AGENTS.md): rules for adding, changing, running, and recording evals.
