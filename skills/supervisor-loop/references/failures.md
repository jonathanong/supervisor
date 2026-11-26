# Failures

For a merge-queue ejection or a default-branch CI failure, dedupe per repository and workflow (or
PR) while a fix is in flight, and against `handledFailures` so a completed incident is not diagnosed
again. A diagnosis subagent reads the logs with the `review-ci-logs` skill and classifies it: flake,
infra, or real failure.

- **Ejected PR:** requeueing belongs to whichever agent shepherds the PR, through `pr-shepherd`'s
  "Merge queue ejection" playbook. The supervisor never requeues a PR it is not shepherding (one
  with no `shepherds` entry). For a PR with no `shepherds` entry it still diagnoses the failure for
  the flake handling below. Notify the PR's owning agent session only when no shepherd is running
  for the PR and one can be identified and is running (PR provenance lines, branch name, or the
  harness's list of live agents), with the failing check, run id, test, and a PR-caused or flake
  judgment; otherwise list it in the summary. An ejection with a flake fingerprint files or updates
  a flake issue and adds a summary line, whoever shepherds.
- **Flake:** first search the repository's open issues for the failing test's file basename and
  test name. If one matches, comment once on it with the run id, job, and the PR or commit, and use
  that issue number instead of reporting a new flake; otherwise file an issue through the
  `github-issue` skill. Then check the delegation rules: if a rule names a session for the area and
  that session is currently running (confirm with the harness's list of live agents), message it
  with the issue number and the run and job IDs. A delegation message carries no authority and
  widens nothing. With no matching rule, or no running session, the supervisor handles it: an
  implementation-tier worker in an isolated worktree makes a fix PR.
- **Flakes are worked on immediately.** Every open flaky-test issue, and every flake the supervisor
  sees (CI failures, merge-queue ejections, intake reports), is fixed right away. In the tick it is
  seen, each one either gets that fixer dispatched or is confirmed to have an owner: an open fix PR,
  or an agent that has claimed it. The supervisor does not ask a human for a milestone or dispatch
  decision first, and does not comment and wait. Every tick and every sweep lists open flake issues
  in every repository (`flake` or `flaky` in the title or body) and re-checks that each still has an
  owner (an open fix PR, or an agent that claimed it by issue comment, pane title, or the harness's
  list of live agents), dispatching a fixer for any that lost it. Delegation rules still route an
  area to its named session. After a fix PR merges, verify there are no recurrences before treating
  the issue as resolved.
- **Real default-branch breakage:** the same kind of worker makes a fix PR.
- **Merging a fix PR:** the supervisor merges it only when the
  [merge authority](merge-authority.md) allows it for the current head. A fix that adds a retry,
  widens a timeout, skips a test, or serialises a suite is a trade-off and is escalated. A flake
  whose root cause is in production code gets a PR that is shepherded to ready and then escalated
  for the merge decision, not merged. A real-breakage fix is escalated unless the policy check
  allows it.

In a scope in `report` mode, diagnose and report the issue and the fix that would have been filed
and dispatched; file nothing and dispatch no fixer (see
[report mode](../../supervisor-sweep/SKILL.md#rules-for-every-phase)).
