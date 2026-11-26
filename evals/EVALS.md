# Eval cases

What each case checks and where its current result lives. The summary for people is in
[README.md](README.md); every run and suite change is logged in [HISTORY.md](HISTORY.md).

## Merge classification (deterministic)

- Cases: [merge-classification/corpus/](merge-classification/corpus/), one JSON file per group. Each
  case has an id, a group, a priority, a one-line description, the evaluator input, the label
  (`merge` or `person`), and the reason for the label.
- Policy under test: [merge-classification/policy/](merge-classification/policy/), a reference
  supervisor policy with one directory policy below it.
- Current result of every case: [merge-classification/cases.csv](merge-classification/cases.csv),
  written by the runner. Scores are stated there and in the generated section of
  [README.md](README.md), nowhere else.

There is one deterministic attempt per case, so a case either passes or does not. There is no
model, no judge, and no without-plugin arm.

### Groups

82 cases: 67 labelled `person` (priority `critical`) and 15 labelled `merge` (priority `medium`).

| Group                      | Cases | `merge` | `person` | Tests                                                                     |
| -------------------------- | ----- | ------- | -------- | ------------------------------------------------------------------------- |
| `dependency-bot`           | 9     | 2       | 7        | The dependency-bot carve-out and the ways an author can only look like it |
| `lockfile`                 | 7     | 2       | 5        | Lockfile changes by an automation author                                  |
| `test-only`                | 18    | 6       | 12       | Test paths, the coverage-trade classifier, and who fills the seat         |
| `docs-only`                | 10    | 3       | 7        | Docs paths and who fills the seat                                         |
| `flake-fix`                | 9     | 1       | 8        | The flake-fix classifier carve-out; a label alone opens nothing           |
| `always-human`             | 7     | 0       | 7        | Always-human paths against every carve-out                                |
| `policy-self-modification` | 8     | 0       | 8        | Policy files and classifiers at any depth, and this eval                  |
| `needs-person-label`       | 2     | 0       | 2        | The hold label                                                            |
| `repository-scope`         | 6     | 0       | 6        | Repositories outside the reviewed scopes, and facts that are missing      |
| `nested-policy`            | 6     | 1       | 5        | A directory policy and the rules it inherits                              |

### Which case guards which rule

For every rule, override, and path pattern in the reference policy, these are the cases whose
outcome changes when it is removed. `test/eval-merge-classification.test.ts` removes each one in
turn and fails if no case changes, so a rule cannot lose its last case unnoticed. No rule, override
or path pattern is currently without a case.

| Rule (root policy unless noted)                  | Part removed                      | Cases that change                                             |
| ------------------------------------------------ | --------------------------------- | ------------------------------------------------------------- |
| Nothing merges on its own unless a carve-out     | the rule                          | dep-01, dep-09, flake-01 (missed merge)                       |
|                                                  | dependency-bot override           | dep-01, dep-09 (missed merge)                                 |
|                                                  | flake-fix override                | flake-01 (missed merge)                                       |
|                                                  | `!test/**`                        | test-18 (missed merge)                                        |
|                                                  | `!packages/*/test/**`             | test-15 (missed merge)                                        |
|                                                  | `!**/__tests__/**`                | test-09 (missed merge)                                        |
|                                                  | `!**/*.test.ts`                   | test-17 (missed merge)                                        |
|                                                  | `!docs/**`                        | docs-01, test-16 (missed merge)                               |
|                                                  | `!README.md`                      | docs-07 (missed merge)                                        |
|                                                  | `!**/pnpm-lock.yaml`              | lock-01, lock-05 (missed merge)                               |
| Test-only changes                                | the rule, or its override         | test-01, test-09, test-15 to test-18, flake-01 (missed merge) |
|                                                  | `test/**`                         | test-18 (missed merge)                                        |
|                                                  | `packages/*/test/**`              | test-15 (missed merge)                                        |
|                                                  | `**/__tests__/**`                 | test-09 (missed merge)                                        |
|                                                  | `**/*.test.ts`                    | test-17 (missed merge)                                        |
| Docs-only changes                                | the rule                          | docs-01, docs-07, test-16 (missed merge)                      |
|                                                  | `docs/**`                         | docs-01, test-16 (missed merge)                               |
|                                                  | `README.md`                       | docs-07 (missed merge)                                        |
| Lockfile changes by an automation author         | the rule, or its override         | dep-01, lock-01, lock-05 (missed merge)                       |
| Always a person                                  | `.github/workflows/**`            | dep-03, flake-05 (false merge)                                |
|                                                  | `.github/actions/**`              | human-06 (false merge)                                        |
|                                                  | `**/migrations/**`                | nested-03 (false merge); docs-06 would then merge             |
|                                                  | `**/payments/**`                  | dep-07, test-11 (false merge)                                 |
|                                                  | `**/billing/**`                   | flake-09 (false merge)                                        |
|                                                  | `**/release/**`                   | human-02 (false merge)                                        |
|                                                  | `**/signing/**`                   | human-05 (false merge)                                        |
|                                                  | `**/secrets/**`                   | human-07 (false merge)                                        |
| A change to merge rules, classifiers or the eval | `**/.supervisor/**`               | policy-03, policy-07 (false merge)                            |
|                                                  | `**/.claude/approvals.yml`        | policy-05, nested-04 (false merge)                            |
|                                                  | `**/.claude/approvals.yaml`       | policy-06 (false merge)                                       |
|                                                  | `**/.claude/classifiers/**`       | policy-02, policy-08 (false merge)                            |
|                                                  | `evals/**`                        | policy-04 (false merge)                                       |
| A needs-person label                             | the rule                          | label-01, label-02, nested-06, scope-05 (false merge)         |
| A repository outside the reviewed scopes         | the rule                          | scope-01, scope-02, scope-04, nested-05 (false merge)         |
| Widgets package (directory policy)               | the rule                          | nested-01 (missed merge)                                      |
| Seat `@reviewed`                                 | `!pr/authors` and `!pr/opened_by` | test-13 (false merge); not removed by the test                |

The remaining `person` cases do not each guard a rule of their own. They check that a carve-out
stays shut: no approval (dep-02, lock-04, test-02, docs-02, flake-06, nested-02), the wrong
approver (dep-08, docs-08 to docs-10, test-12, test-14), a look-alike author (dep-04, dep-05,
lock-06), a shared branch (dep-06, lock-07), a path that only resembles a carve-out (test-07,
test-08, docs-04, docs-05), source mixed in (test-06, test-10, docs-03, lock-03, human-03), and a
classifier that said no or said nothing (test-03 to test-05, flake-02 to flake-04, flake-07,
flake-08).

**The protected-file baseline has no case of its own.** Where no rule applies to a changed policy
file or classifier definition, the evaluator asks one person other than the author, counts no bot,
and never merges. The reference policy has a rule on every such path, so no case reaches that
baseline: remove the rule and the catch-all rule still covers the file. Instead,
`test/eval-merge-classification.test.ts` runs every case that changes a protected file against no
policy at all and checks the baseline's verdict, seat and next step.

### Known differences between label and outcome

| Case    | Label   | Outcome      | Why it stays                                                                                                                                                                                                             |
| ------- | ------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| docs-06 | `merge` | missed merge | Policy choice, not an evaluator fault. `**/migrations/**` also matches prose at `docs/migrations/`. Excluding `docs/` from the always-human rule would let a real migration placed there merge, so the rule stays broad. |

### Evaluator findings

None open. Adding policy-07 found a fault in the reference policy, not in the evaluator: `.supervisor/**` matched a repository policy file only at the root, so the widgets directory policy let one in `packages/widgets/.supervisor/` merge. The pattern is now `**/.supervisor/**`. The first run found two evaluator faults, both fixed in `src/policy/evaluate.ts`: the next step was `merge` for a `comments` verdict whose seats were filled (human-04) and for an empty list of changed files (scope-06). The next step is now `merge` only when every changed file has a rule whose verdict is `approves`. [HISTORY.md](HISTORY.md) has both entries.

## Agent cases

A score is the mean over a case's attempts, and an attempt's score is the share of its graders
that passed. `Guard:` marks a case where the skill must stay out of the way; the model passes it
unaided by design.

No cases exist yet.

| Case | Checks that the agent | Score | Passed | Without plugin |
| ---- | --------------------- | ----- | ------ | -------------- |
