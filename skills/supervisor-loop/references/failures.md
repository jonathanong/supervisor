# Failures

For a merge-queue ejection or a default-branch CI failure, dedupe per repository and workflow (or
PR) while a fix is in flight, and against `handledFailures` so a completed incident is not diagnosed
again. A diagnosis subagent reads the logs with the `review-ci-logs` skill and classifies it: flake,
infra, or real failure.

## Finding failures

The sweep's backstop (Phase G) finds both kinds over the last 24 hours:

- **Ejections:** per repository, query GraphQL
  `timelineItems(itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT])` over recently updated PRs, paginated
  until a PR's update time leaves the window. An ejection is a removal whose reason is not `merged`.
  A removal followed by a later merge of the same PR is resolved: no action, except that a
  failed-checks removal that passed on requeue is a flake candidate. A `manual` removal is the
  owner's: leave it alone. Drop PRs currently queued.
- **Default-branch runs:** take the default branch from the repository listing. Count runs whose
  conclusion is `failure`, `timed_out`, or `startup_failure`, including `workflow_dispatch` and
  `repository_dispatch` runs. Ignore runs whose event is the dependency bot's own update job.
- **Group before diagnosing:** by repository, workflow, and failing job or step. Diagnose only the
  newest run of each group, and record every member's run id in `handledFailures`. "A fix is in
  flight" means an open PR or open issue that names that workflow failure.
- **Reading a log:** find the failing job and step first with `gh run view <id> --json jobs`, then
  fetch only that job's log to a file in the temporary directory and search the file.
  `--log-failed` prints the whole job log: never read it directly into context.

## Handling a failure

- **Ejected PR:** requeueing belongs to whichever agent shepherds the PR, through `pr-shepherd`'s
  "Merge queue ejection" playbook. The supervisor never requeues a PR it is not shepherding (one
  whose shepherd it did not start in this session). For such a PR it still diagnoses the failure for
  the flake handling below. Notify the PR's owning agent session only when no shepherd is running
  for the PR (`pr-shepherd` exit 17 means a live one exists) and one can be identified and is running (PR provenance lines, branch name, or the
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
and dispatched; file nothing, dispatch no fixer, and record nothing in `handledFailures` (see
[report mode](../../supervisor-sweep/SKILL.md#rules-for-every-phase)).
