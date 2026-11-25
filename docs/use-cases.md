# Use cases

Real incidents from about 2,300 Claude Code sessions between 2026-10-20 and 2026-11-24, across the repos asig will supervise. Automated runs (reviewer benches, eval graders) were left out. Each case says what happened, how often, and what asig or `ci-probe` should do. Details are generalized: no PR numbers, session ids or private repo contents.

Counts are distinct sessions, read from user messages, and approximate. A raw text search over all transcripts in the window, automated ones included, finds the same themes more often (for example, the weekly usage-limit message in about 550 files), so the counts below are lower bounds.

Areas refer to the design doc: G1 journal and distill, G2 feedback to skills, G3 CI and merging, G4 workflow hygiene, G5 escalations to rules, G6 backlog to work, U usage limits, CP `ci-probe`, O orchestration.

## Merging

### 1. Merge approvals typed one PR at a time

- **Area:** G3, G5
- **Seen:** about 150 short "merge it", "approve", "yes" replies in 25+ sessions; standing grants in 8+.
- **What happened:** In almost every orchestrator session the user approves merges one or two PRs at a time. Afterwards they often grant a standing rule: docs may merge without asking, small rule-enabling PRs under 300 lines, version bumps, CI-only changes, anything `code-reviewer` approves with no behavior change.
- **asig should:** hold those grants as merge rules, merge PRs that match them, and bring the user only the rest, in one batch, each with the reason it did not match.

### 2. A re-queue after ejection blocked as "merge without review"

- **Area:** G3, G5
- **Seen:** 3+ sessions.
- **What happened:** The user approved and queued a PR. It was ejected from the merge queue, and the agent's re-queue was refused by the permission classifier as a merge without review. The agent stopped to ask again, although the user had said to re-queue their own queued PRs after an ejection.
- **asig should:** record an approval against the PR and its head commit. A re-queue of the same head is covered; a changed head gets a fresh `code-reviewer` pass first. Where the harness still refuses, give the user one exact command.

### 3. Final review before merge

- **Area:** G3
- **Seen:** 8+ sessions.
- **What happened:** The user's standing instruction: send it to `code-reviewer`, and merge if it approves and there is no behavior change. One large PR filed as test work carried production and architecture changes, which the review confirmed.
- **asig should:** request the review on the head commit once checks pass, attach the verdict to the merge decision, and flag a PR whose changed paths do not match its title or milestone.

## CI

### 4. Ejections caused by infrastructure, not the PR

- **Area:** G3, CP
- **Seen:** 8+ sessions.
- **What happened:** PRs were ejected by set-up action timeouts, release-asset download 504s during image builds, a linter download 504, a browser step timeout and a stale coverage base report. The user's rule is never to rerun CI blindly: fix the cause, file a flake issue, or rebase for a fresh run. Agents spent time choosing between these.
- **`ci-probe` should:** classify an ejection from the failing step and log signature as the PR's own failure, a known flake or infrastructure class, or an outage. asig then rebases and re-queues, files or updates a flake issue, or waits out the outage.

### 5. Flaky tests become tracked issues, never silent reruns

- **Area:** G3, CP
- **Seen:** 6+ sessions.
- **What happened:** Agents filed flake issues found during PR runs, and were asked to check whether a flake was already tracked first. One check failed twice on a transient 503; the user approved a retry and said the check had to be made reliable.
- **`ci-probe` should:** keep a flake registry keyed by test or step and failure signature, check it before filing, file with run links, counts and the first failing step, and raise priority when a flake ejects PRs.

### 6. CI backlog and runner bottlenecks

- **Area:** CP, G3
- **Seen:** 3 sessions, mostly one long one.
- **What happened:** Pushes to `main` backed CI up; macOS runners were the bottleneck. The user's rules: jobs on `main` finish and are not cancelled, superseded commits elsewhere may be skipped, no paid larger runners. An agent asked permission to cancel a superseded run, and the user asked why it was asking.
- **`ci-probe` should:** report queue depth and wait time per runner label, tell stuck runs from slow ones, and name the jobs holding the queue. asig cancels superseded runs off `main` without asking, and proposes concurrency changes as a PR.

### 7. GitHub API quota spent by polling

- **Area:** CP
- **Seen:** 3 sessions, 5+ discussions.
- **What happened:** Custom agent scripts used up the user's personal GraphQL quota; the rate-limit error appears in dozens of transcripts. The user is designing a webhook relay so agents wait on events instead of polling.
- **`ci-probe` and asig should:** wait on events where they exist, cache and batch reads, count API cost per tick, and prefer an app token to the user's own.

### 8. Dependabot PRs: grouping and stuck PRs

- **Area:** G3, G4
- **Seen:** 6+ sessions.
- **What happened:** Dependabot grouped by dev and prod instead of by vendor; one vendor's packages were split across PRs; a Dependabot PR sat stuck.
- **asig should:** triage Dependabot PRs by group and CI state, merge the ones its rules allow, and flag split groups and stuck PRs.

## Dispatch and orchestration

### 9. "No agents are working. What's next?"

- **Area:** G6
- **Seen:** 12+ sessions; one hand-written hourly "pop the next task" prompt fired 200+ times.
- **What happened:** The user repeatedly tells the orchestrator to start work already sitting in a milestone, and asks why idle workers were not given it.
- **asig should:** each tick, match ready issues (in a milestone, not blocked, not claimed) to idle workers and dispatch without being asked, skipping a hold list (issues awaiting a decision or a paid run) and respecting machine load.

### 10. The check-in loop, re-typed by hand

- **Area:** O
- **Seen:** 600+ fires in 8+ sessions; "set up an hourly loop to check on the agents" typed about 13 times.
- **What happened:** The user keeps asking for an hourly loop that reads each worker pane, reports its state, unblocks it and sends the next task. Session cron jobs expire after 7 days or with the session, and a 55-minute interval did not fire as expected.
- **asig should:** be that loop: one that survives sessions and re-registers itself.

### 11. Dead workers, dead machines, resets

- **Area:** O, U
- **Seen:** 8+ sessions.
- **What happened:** A worker machine died and was restarted; sessions died mid-task; workers ran out of quota or hit "model at capacity"; a workspace disappeared; one worker's lock stalled another. The user moved work between machines by hand.
- **asig should:** notice idle, errored or missing workers, keep enough handoff state (branch, PR, notes) to resume, and re-dispatch, preferring a healthy machine.

### 12. Two sessions on the same work

- **Area:** O, G4
- **Seen:** 8+ sessions.
- **What happened:** Two sessions opened the same CI fix seconds apart. The user asked which agent owned a PR, why two sessions were both making the same kind of PR, and why subagents made PRs in a repo another session owns.
- **asig should:** keep a claim per issue and PR (the provenance comment), refuse a duplicate claim, route work to the session that owns the repo, and answer "who owns this?" from the claims.

### 13. Machine disk and memory

- **Area:** O
- **Seen:** 4+ sessions.
- **What happened:** Review agents could not delete their build folders from inside the sandbox, so the user was asked to; build folders reached 15 to 29 GB; the orchestrator watched disk use and paused builds while benchmarks ran.
- **asig should:** watch disk and memory per machine, have workers clean up worktrees and build folders once their PR closes, and hold heavy jobs while a benchmark needs a quiet machine.

## Usage limits

### 14. Weekly limits across Claude, Codex and Grok

- **Area:** U
- **Seen:** 10+ orchestrator sessions juggling accounts; the weekly-limit message in 135+ sessions.
- **What happened:** The user tracks each account's reset time by hand and directs spending: use what is left before a reset, lift a floor until the reset, move workers from one account to another, use only small models until the reset. Agents that hit a limit sat idle. Scheduled prompts like "if it is before midnight do nothing, else re-dispatch" were written by hand.
- **asig should:** read each account's remaining usage and reset time, route work by the spending order and floors, mark work as waiting for a reset rather than failed, and resume it after the reset.

### 15. Paid eval runs wait for a budget decision

- **Area:** G2, U
- **Seen:** 5+ sessions.
- **What happened:** The user asks to write evals but not run them yet, to run only evals that never ran or need a re-run, and to judge skill changes by an equal or better score.
- **asig should:** treat a large or paid eval run as a budget decision, and queue it for after the next reset.

## Rules and learning

### 16. The same correction, again

- **Area:** G2, G5
- **Seen:** 4+ sessions in 3 repos.
- **What happened:** Agents kept writing their own polling scripts or using `gh pr checks` instead of `pr-shepherd`, which also burned GraphQL quota. The user corrected this repeatedly and wrote feedback for the plugin.
- **asig should:** detect a repeated correction, check whether a rule already exists and why it is missed, and propose a stronger rule or eval case.

### 17. Asking permission for routine steps

- **Area:** G5
- **Seen:** 5+ sessions.
- **What happened:** Agents asked the user to rebase, to close an obviously finished issue, to cancel and re-cut a release, and brought the user items other agents were already handling. The user asked whether a skill covered it.
- **asig should:** log each question it raises with a category, and when a category gets the same "yes, obviously" twice, propose a rule and stop asking.

### 18. "Should this be a rule?"

- **Area:** G1, G2
- **Seen:** 15+ sessions.
- **What happened:** The user routinely asks to add a decision to `AGENTS.md` or `jong-skills`, asks whether a lint rule is needed, and deleted agent memories once a skill held the rule.
- **asig should:** for each decision or journal theme, ask where the rule belongs and open the PR there, then remove the duplicate memory.

### 19. Journals are rich; distilling them is manual

- **Area:** G1
- **Seen:** journal entries in about 500 sessions.
- **What happened:** Agents journal frictions and denials heavily. Recurring themes: sandbox writes in linked worktrees, CI set-up flakes, local checks that miss CI gates, the tooling MCP losing its install or needing a reconnect.
- **asig should:** cluster entries by signature across sessions and repos, open an issue or rule PR once a theme recurs, and treat "MCP unavailable" as its own signal.

### 20. Review bot noise

- **Area:** G2, G3
- **Seen:** 4 sessions.
- **What happened:** An agent acted on bot notices its config said to ignore; several review bots were added, with a request for classifiers for each.
- **asig should:** treat each repo's ignore and classifier config as the definition of actionable feedback, and add a new bot to it when one is enabled.

## Workflow hygiene

### 21. PRs without milestones or owners

- **Area:** G4
- **Seen:** 8+ sessions.
- **What happened:** The user found many open PRs with no milestone and asked whose they were; asked agents to put their PRs in a milestone; corrected an issue filed in the wrong milestone; said not to reopen closed milestones.
- **asig should:** audit PRs and issues for milestone, labels, a closing reference and an owner, fix what is missing, and open a new milestone rather than reopen a closed one.

### 22. Release gates with a peer

- **Area:** G3, O
- **Seen:** 6+ sessions.
- **What happened:** Merges in one repo were frozen while a peer session validated a batch; a release then needed a performance run, an approved workflow dispatch, and a message to the peer with the new version. A release resumed an existing version rather than cutting a new one.
- **asig should:** model "freeze until the peer validates this head, release, notify", and track the approval each release dispatch needs.

## Not covered by the current design

- **An ownership map.** Which session owns which repo or lane, and which session may merge where. Merge rules alone do not say this.
- **Expiring instructions.** "No floor until the reset", "cancel superseded runs": rules tied to a time or a state need an expiry.
- **Machine health as an input** to dispatch and clean-up: disk, memory, load, which host is up.
- **Context hygiene for long-running sessions.** Auto-compaction thrashing in long orchestrator sessions; `/compact` typed 66 times. The supervisor needs summaries and planned restarts.
- **A PR scope check.** Changed paths against the title and milestone (one strong example).
- **Release mechanics.** Publish approvals per registry, partial publishes, and version bumps in downstream repos.
- **`koa`.** One session in the window, setting up trusted publishing and a release. No recurring pattern yet.

## Seen once, low confidence

- Picking the best free model for a CLI, and retrying non-interactive agents on a rate limit.
- Antigravity: set up once; no usage-limit evidence.
- Notifications outside the session (Slack, email) for escalations: not seen.
- GitHub auto-merge pinned to a commit did not merge after a new push.
- A documentation pass requested and never done (possible dropped backlog).
- Stale coverage reports fixed by a rebase: 3 sessions, one repo; a good `ci-probe` signature.
