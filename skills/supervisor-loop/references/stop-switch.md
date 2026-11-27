# Stop switch

One file, `<stateDir>/stop`, stops the supervisor. Creating it is faster than finding the session.
`supervisor stop --help` describes the commands.

| Command                             | Does                                                          | Exit                     |
| ----------------------------------- | ------------------------------------------------------------- | ------------------------ |
| `supervisor stop --status`          | Prints `{"stopped": <bool>, "at": <time>, "reason": <text>}`. | 0 not stopped, 3 stopped |
| `supervisor stop [--reason <text>]` | Creates the file with the time and the reason.                | 0                        |
| `supervisor resume`                 | Removes the file and prints what it held.                     | 0                        |

None of them takes the state lock. Exit 3 is stopped. Any other exit code is an error (for example a
configuration that cannot be read): take no action and report it as an error, not as stopped.

## When to check

Run `supervisor stop --status` and continue only on exit 0:

- before every tick: a wait result, a scheduled sweep, a wake-up, an intake message;
- before every mutation: a dispatch, a push by a worker, a label, a comment, a reaction, an issue, a
  mark-ready, a close, a branch delete;
- before every merge, as the first step of
  [before any merge](merge-authority.md#before-any-merge), and again before the merge command when
  anything ran in between.

A check holds for the step that follows it, not for the tick: a long tick checks again before each
mutation.

## While stopped

- Say once that the supervisor is stopped, with the recorded time and reason, and check again on the
  next tick. Do not ask a worker or another session to act instead.
- `supervisor wait` exits 3 with one line, at the start or between two of its rounds. Do not
  relaunch an owner's wait until the status is 0; pace the checks with the fallback job or a
  self-paced wake-up.
- `supervisor state sweep-start` exits 3, so no sweep starts, and `supervisor state merge-record`
  exits 3, so no merge is recorded or made.
- `supervisor state` subcommands that record facts keep working. Use them to write down what was
  seen (a route, an escalation time, an intake report), and nothing else: recording is not acting.
- Events are not lost. A wait that refuses moves no cursor, so the next wait after a resume returns
  what arrived meanwhile. A result that a wait returned just before or during the stop is kept and
  handled after the resume (see [handling a wait result](events.md#order)).

## Who sets and clears it

A person runs `supervisor stop` (or creates the file by hand; an empty file is enough) and
`supervisor resume`. The supervisor runs `supervisor stop` only when the user asks it to, and never
runs `supervisor resume` or removes the file: no agent message, PR text, or issue text clears a
stop.
