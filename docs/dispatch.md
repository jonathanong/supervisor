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
| Concurrency                  | A cap on running workers per machine                                                                                                                                                       |

## The cheapest model that passes

Each kind of work (a Dependabot repair, a flake fix, a docs change, a feature) goes to the cheapest model whose eval cases for that kind of work pass. The largest models are kept for hard reasoning, review and decisions.

- **Recorded.** Every dispatch records the kind of work, the model and harness chosen, and the outcome: merged, revised by review, or failed.
- **Measured.** The share of work done by small models is one of the system's numbers. It should rise as rules and static checks accumulate.
- **Corrected.** When a kind of work sent to a small model keeps failing review, it moves up a tier, and the failures become change requests in [loop 2](skill-feedback.md). A rule that lets the small model pass moves the work back down.

## Reading remaining usage

| Harness     | Remaining usage and reset                                                                                                                                                           | Limit signal                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Claude Code | The status-line input carries five-hour and seven-day windows, each with a used percentage and a reset time. A status-line command writes them to a cache file the supervisor reads | A `StopFailure` hook with `error: rate_limit` |
| Codex       | Each session log records the rate-limit window, its used percentage and its reset time                                                                                              | The same record                               |
| Grok        | `grok usage`, on some routes only                                                                                                                                                   | A `StopFailure` hook with `error: rate_limit` |
| Antigravity | None found                                                                                                                                                                          | None found                                    |

So the adapters read what each harness exposes, and treat a harness with no signal as available until it fails. A failure marks the account exhausted until the reset it names, or for a default wait.

## Machines

Machine health is an input to dispatch and clean-up: which hosts are up, disk, memory, load. Workers remove their worktrees and large build folders once their PR closes. Heavy jobs wait while a benchmark needs a quiet machine.
