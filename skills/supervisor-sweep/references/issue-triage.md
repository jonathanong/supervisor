# Phase D - Issue triage

Every open issue must be in a milestone or a project, or be worked on now. Work through the
`github-issue` skill, under the scope's `taxonomy`. Without `taxonomy`, use each repository's own
open milestones and projects.

## List

A mechanical-tier subagent builds the list from the repositories selected in supervisor-loop
[Step 1](../../supervisor-loop/SKILL.md#step-1---preflight), never from an owner-wide search (that
returns archived and unselected repositories). Per repository, list open issues with no milestone
and no project (`gh issue list --repo <owner>/<repo> --state open --search 'no:milestone no:project' --limit 1000 --json number,title,body,labels --jq '...'`,
with `<owner>/<repo>` in every output row).

Exclude an issue only when an OPEN PR is linked to it. A search's `-linked:pr` also matches closed
and merged PRs, so check state: one GraphQL query per repository for all listed issues, aliasing
`issue(number: N) { closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { nodes { number state } } }`.

Leave an umbrella or tracking issue (a parent that lists children) alone when its children are
sorted.

## Decide

- **Assign** the best-fitting existing milestone or project. Every issue in a repository listed in
  `taxonomy.projectByRepo` joins that project. Sensitive issues go in `taxonomy.sensitiveIssueRepo`.
- **Create a milestone** when several open issues or PRs share one theme and its name is clear (for
  example a multi-issue refactor split into steps). Report it as `milestone created`. Never create a
  project. Never reopen a closed milestone.
- **Close** an issue already fixed on the default branch, and a duplicate (`Duplicate of #N`). Look
  for a duplicate only when a title or body suggests one. An implementation-tier subagent verifies
  each against the current default branch first. Close with a comment and the right `state_reason`.
- **Work on now** an issue with no theme (a one-off, or a flaky test): it needs no milestone.
  Dispatch a fixer (an implementation-tier worker or a fitting workspace agent), as for a flake (see
  [failures](../../supervisor-loop/references/failures.md)). It is not listed for the owner.
  Dispatch at most 5 new fixers per repository per sweep, oldest issue first; later sweeps pick up
  the rest, and the summary counts them. Skip an issue that already has an assignee or a recorded
  dispatch. `routed` is a list of `{what, to, at, evidence?, issue?, note?}` with no issue key, so
  match a record whose `what` or `issue` text contains `<owner>/<repo>#N`.
- **Needs decision** is left only for urgent or risky work the merge policy would send to a person
  anyway, a reorganization of existing taxonomy, and an issue the sweep cannot classify. List each
  once as a `needs decision` summary line, deduped on `escalations` (key `<owner>/<repo>#N`). It is
  a Phase H escalation (label, comment, notification) only when it is urgent.

## Projects

Projects need a token with the project scopes (checked in Preflight). When they are missing, skip
only the project step and say so in the summary.
