# Dispatch and usage limits

The supervisor spends quota from several accounts across several harnesses: Claude Code, Codex, Grok, Antigravity. Each account and its rules are data in the config.

[Back to the graph](graph.md)

## Rules

| Rule                         | What the supervisor does                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accounts are config          | Each account lists its harness, plan, machines, a floor, and its place in the spending order                                                                                               |
| Spending order               | Large work spends the accounts in a configured order. Quick tasks go straight to a small, fast model                                                                                       |
| Floors                       | An account gets no new work once its remaining usage reaches its floor                                                                                                                     |
| A reserve for the supervisor | The supervisor itself, and every merge, need the merging account. Workers spend the other accounts first and stop at a reserve, so the supervisor is never left without quota              |
| Manual resets                | Used only when the next automatic reset is several days away, since a manual reset restarts the clock                                                                                      |
| Out of quota                 | When every account a task could use is at its floor, the task waits. The supervisor records the earliest reset and wakes up then. The task is marked as waiting for a reset, not as failed |
| Concurrency                  | A cap on running workers per machine. There is no spend cap: the accounts are subscriptions, with no bill per call                                                                         |

## The cheapest model that passes

Each kind of work (a Dependabot repair, a flake fix, a docs change, a feature) goes to the cheapest model whose eval cases for that kind of work pass. The largest models are kept for hard reasoning, review and decisions.

- **Recorded.** Every dispatch records the kind of work, the model and harness chosen, and the outcome: merged, revised by review, or failed.
- **Measured.** The share of work done by small models is one of the system's numbers. It should rise as rules and static checks accumulate.
- **Corrected.** When a kind of work sent to a small model keeps failing review, it moves up a tier, and the failures become change requests in [loop 2](skill-feedback.md). A rule that lets the small model pass moves the work back down.

## Reading remaining usage

No harness offers one command that prints remaining usage, so each adapter reads what its harness leaves behind.

| Harness     | Remaining usage and reset                                                                                                                                                                                                                                                                                             | Limit signal                                                                                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | The status-line input carries `rate_limits.five_hour` and `rate_limits.seven_day`, each with `used_percentage` and `resets_at`. It is present for subscribers only, after a session's first response. No CLI command prints it, so the status-line command also writes its input to a cache file the supervisor reads | A `StopFailure` hook with `error: rate_limit`, which carries no reset time; `api_retry` events in `stream-json` output with `error: rate_limit`. A retry with `error: overloaded` is not a limit signal |
| Codex       | Each session log under `~/.codex/sessions/` records `rate_limits.primary` and `rate_limits.secondary`, each with `used_percent`, `window_minutes` and `resets_at`. `secondary` is `null` on a plan with one window. The floor applies to each window present                                                          | The same record, with `rate_limit_reached_type`                                                                                                                                                         |
| Grok        | `grok usage` prints the plan's usage on the daemon route only. On the shell route it refuses and points at `/usage` in the interface                                                                                                                                                                                  | A `StopFailure` hook with `error: rate_limit`                                                                                                                                                           |
| Antigravity | Nothing in its commands or local files                                                                                                                                                                                                                                                                                | None                                                                                                                                                                                                    |

So the adapters:

- read Claude Code's cache file and Codex's session logs directly
- try `grok usage`, and fall back to the limit signal when it refuses
- treat Antigravity, and any harness with no signal, as available until it fails

A failure marks the account exhausted until the reset it names, or for a default wait when it names none.

## Interrupted sweeps

When a sweep's subagents hit a usage limit partway through a pass, the supervisor treats the pass as waiting for the reset rather than failed. It releases the sweep claim with `supervisor state remove sweep` (never `sweep-done`), leaves `lastSweepAt` and incomplete phase cursors unadvanced, keeps already-recorded per-item facts so work is not duplicated, and cleans up any temporary local snapshot. After the reset it re-claims the sweep and either resumes the stopped subagents or reruns the sweep from the start (see [usage-limits.md](../skills/supervisor-sweep/references/usage-limits.md)).

## Machines

Machine health is an input to dispatch and clean-up: which hosts are up, disk, memory, load. Workers remove their worktrees and large build folders once their PR closes. Heavy jobs wait while a benchmark needs a quiet machine.
