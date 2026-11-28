# Usage limits mid-sweep

A model or harness usage limit (such as a 5-hour or weekly quota cap) is distinct from GitHub API
rate limits. When one or more subagents stop on a usage limit partway through a sweep, treat the
pass as waiting for the reset rather than failed.

## When subagents stop on a usage limit

1. Stop spawning or retrying subagents while the account is exhausted.
2. Print a partial summary naming the phases that completed, the subagents and phases that stopped
   on the usage limit, and the reset time if the harness reported one.
3. In a standing loop, wait until after the reset: schedule a self-paced wake-up after the reported
   reset time when known, or let the recurring fallback sweep fire. If the fallback job is near
   expiry and the loop session still has quota, refresh the schedule before waiting (see
   [Phase H](../SKILL.md#phase-h---report-and-escalate)).

## What to release and what to keep

- **Release the sweep claim** with `supervisor state remove sweep`, never
  `supervisor state sweep-done`. `sweep-done` sets `lastSweepAt` to now, which makes the loop skip
  the next fallback sweep until the fallback interval elapses; `remove sweep` releases only the
  claim so the sweep can resume or rerun as soon as quota resets. On `--dry-run`, no claim was
  written, so skip this step.
- **Clean up temporary local files** left by an interrupted phase — in particular, remove any local
  snapshot and partitions created by [Phase E](journal-distill.md) before stopping.
- **Do not advance `lastSweepAt`:** leave it unset if no sweep has finished yet, or at the previous
  completed sweep's timestamp.
- **Do not advance incomplete phase cursors:**
  - `retroCursor` (Phase E) stays put unless Phase E completed and cleaned up for every selected
    scope (and none is in `report` mode).
  - `lateReview.<owner>/<repo>` (`scannedThrough`, `activityThrough`, `fullScanAt`) stays put for
    any repository whose Phase F scan did not finish.
  - `commandsThrough` (Phase G2) stays put unless G2 completed for every selected repository (and
    none is in `report` mode).
  - `scheduledPrompts.next` and `scheduledPrompts.runs` (Phase G3) are not recorded for a prompt
    that did not finish.
- **Keep already-recorded per-item facts** from steps that finished before the stop
  (`reviewedComments`, `handledFailures`, `escalations`, `routed`, `mergeRecords`), so resuming or
  rerunning does not duplicate issues, notifications, or dispatches.

## Resuming or rerunning after the reset

Before continuing after the reset:

1. Run `supervisor stop --status`; stop on any non-zero exit (exit 3 is stopped).
2. Re-claim the sweep with `supervisor state sweep-start --id <id>`. Exit 1 means another sweep
   already holds a live claim: do nothing and report `sweep skipped: another sweep is running`.
3. Finish the pass using whichever path fits the session state:
   - **Resume the stopped subagents** when the harness supports resuming them, the session is still
     alive, and the wait was short enough that earlier listings are still current. Let them finish
     their phases, continue through the remaining phases, and finish Phase H with
     `supervisor state sweep-done`. Before acting on or merging any PR listed before the wait, still
     re-read its current head per the [reviewed-head](../SKILL.md#rules-for-every-phase) rule.
   - **Rerun the sweep from the start** when subagents cannot be resumed, the session restarted, or
     the wait made earlier listings stale. Because `lastSweepAt` and incomplete phase cursors were
     left unadvanced, nothing is skipped, and already-recorded per-item facts prevent duplicate
     work.
