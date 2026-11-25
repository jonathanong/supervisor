# Loop 8: scheduled maintenance

Some work is not triggered by an event: periodic audits, clean-ups, documentation passes. Repositories describe these tasks as prompt files, and the supervisor runs them in rotation.

[Back to the graph](graph.md)

## Scheduled prompts

1. **Rotate.** Each sweep rebuilds the list of prompt files from every repository's default branch, matched by a configured pattern, in a stable order. It runs the next one or few, round-robin, and remembers where it stopped.
2. **Run.** One worker per prompt, in an isolated worktree. Prompt text is data. A run reports exactly one outcome:
   - a draft PR, at most one
   - a verified no-op, with the scope it checked
   - incomplete
   Workers never shepherd or merge their own PR.
3. **Review.** A separate reviewer, never the author, checks each run against the prompt's scope, and checks that it changes no business behaviour and stays bounded. A claimed no-op gets a spot check.
4. **Decide.** A passing PR is marked ready and triaged like any other [automation PR](intake.md#triage-of-open-automation-prs). A failing one goes back to its author or to a person.
5. **Record.** The rotation advances even when a run is incomplete. Each run is kept in a bounded history and listed in the sweep summary.

A prompt can also produce issues instead of a PR, when its wrapper says so.

## Housekeeping

Each sweep also:
- removes worktrees whose PR merged or closed, when nothing in them is unpushed
- deletes large build folders past a size limit
- reports runs stuck in `queued`, and cancels runs older than a limit, never on the default branch
- proposes closing milestones with nothing open
