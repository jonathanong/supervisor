# Coordination

The supervisor owns coordination. It is the one place that knows who is working on what, across every repository, harness and machine. Before anyone starts work that someone else might already be doing, the supervisor checks.

[Back to the graph](graph.md)

## What it checks

| Source                                                    | Tells it                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Claims](claims-and-taxonomy.md#claims) on issues and PRs | Who said they are working on what, and from which session                              |
| Live agents                                               | Which sessions, workers and panes are running, idle, errored or gone, on every machine |
| Its own in-flight work                                    | Workers it dispatched, and shepherd runs it started                                    |
| The flake ledger                                          | Which flakes are tracked, and who has the fix                                          |
| The intake queue                                          | Reports from other agents that are queued but not yet filed                            |
| Open PRs                                                  | Fixes already in review for the same failure or issue                                  |

## Example: a flake

An agent's PR is ejected by a test that fails on unrelated code. Before it does anything about the test:

1. It asks the supervisor, rather than filing an issue or writing a fix.
2. The supervisor checks the ledger, the claims, open PRs and its own workers.
3. It answers with one of:
   - **Someone is on it:** the issue, the owner and the fix PR, if there is one. The agent rebases once the fix merges, and does nothing else about the flake.
   - **The supervisor is on it:** the same, with its own worker as the owner.
   - **Nobody is:** the supervisor files the issue, or updates an existing one, and dispatches a fixer. The reporting agent stays in its own lane.

The same check applies to a broken shared check, a CI outage, a dependency bump, and any issue an agent wants to pick up.

## Rules

- **One owner per piece of work.** A second claim is refused. When two sessions start the same fix, the supervisor keeps the earlier one and stops the other.
- **Agents ask before acting outside their lane.** A report to the supervisor replaces a fix in another repository. See [intake.md](intake.md#reports-from-other-agents).
- **Work goes to the session that owns its lane.** The supervisor routes a repository's work to that repository's orchestrator, and starts it if needed.
- **Stale claims are released.** A claim whose session is gone is marked stale, and the work is re-dispatched with its handoff state: the branch, the PR and any notes.
- **Answers come from current state.** Claims and stacks are read from GitHub, and agents from the live list, each time. A cached answer can be wrong.

## How agents ask

The MCP tool `coordination_check` takes a repository and a subject: an issue, a PR, a failing test or check, or a dependency. It returns the owner, if any, their claim and PR, and what the asking agent should do next. Agents that cannot reach the tool fall back to the claims on GitHub.
