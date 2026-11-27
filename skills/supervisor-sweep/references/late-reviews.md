# Phase F - Missed code reviews

Phase F is incremental. The state file keeps, per repository, `lateReview.<owner>/<repo>` with:

- `scannedThrough` (ISO time): only PRs merged after it get a full scan;
- `activityThrough` (ISO time): the `since` for the review-activity signal in step 2, advanced only
  after that step succeeds, falling back to `scannedThrough`;
- `fullScanAt`: the time of the last full window rescan.

## Harvest

The harvest is GraphQL-first. A mechanical-tier subagent per owner loops over that owner's
repositories and runs one query per page of 50 merged PRs, ordered by update time, and stops when a
PR's update time is older than the window. Each page fetches `mergedAt`, `reviewThreads`
(`isResolved`, `comments` with `createdAt` and author), and `reviews`. Do not use REST per-PR calls
for the scan. The page sizes are starting values. When a PR's `reviewThreads` or `reviews`, or a
thread's `comments`, has `hasNextPage`, follow it with a per-PR query until it is exhausted. The
filter needs only a thread's root comment and its last comment, so fetch `comments` as `first: 1`
plus `last: 1` instead of paging. An owner-wide search that returns 1000 results (the search cap) is
truncated: split it per repository or into narrower date ranges and rerun.

The scan has three parts:

1. **New merges:** fully scan every PR merged after `scannedThrough` and within `lateReviewDays`
   (default the last 14 days).
2. **Active older merges:** PRs merged earlier but still in the window are rescanned only when they
   have new review activity since `activityThrough` (falling back to `scannedThrough` when unset).
   Never use `lastSweepAt`: it advances even when Phase F is skipped or fails, so activity in that
   gap would be missed. The same GraphQL page carries the signal: a thread comment or review newer
   than the cursor, which also catches a review with only a body. A failed query fails step 2, so
   `activityThrough` stays put.
3. **Backstop:** when `fullScanAt` is unset or older than `fullRescanDays` (default 7), rescan every
   PR in the window as before.

"Unresolved at merge" cannot be read from the API. Scan for threads unresolved now, plus comments or
non-empty review bodies created after `mergedAt`, that are not yet in the state file's
`reviewedComments`.

## Noise filter

Apply this before any verification. Drop:

- a review body that only states an approve verdict;
- a bot summary, walkthrough, "analysis", or tool-output comment, and a reply that withdraws a
  finding;
- a thread whose last comment is the PR author's (or the shepherd's) answer followed by resolution;
- an unresolved review-bot thread whose last comment is the PR author's or the shepherd's reply that
  addresses the finding (says it was fixed, or declines it with a reason): the bot never answered, so
  it was answered and only left unresolved. Keep it when the reply defers or promises later work. A
  person's thread in the same state is kept.

A review bot's thread that states a finding counts like a person's. Judge a thread by its root comment: a new reply inside an already-harvested thread is not a new
finding.

## Verify and file

An implementation-tier subagent verifies each comment against the default branch read through the
API (or a freshly fetched temporary worktree), never a local checkout's possibly stale ref, and drops
anything already addressed, non-actionable, or a duplicate of an open issue. File one issue per root
cause through the `github-issue` skill, linking the PR and comment with a non-closing, fully
qualified reference. The issue carries the exact existing `follow-up` label; re-fetch it and verify
the label and link. When labeling or linking is unavailable or unauthorized, report the blocker
instead of filing it unlabeled. Add a harvested comment id to `reviewedComments`
(`supervisor state reviewed --file <ids file>`, a `{"<owner>/<repo>": [ids]}` file) only once it is
dropped or its issue's label and link are verified; leave a blocked comment out so a later sweep
retries it. While any comment of a repository is left blocked, advance neither `activityThrough` nor
`scannedThrough` for it in that sweep. A comment posted days after merge is still found.

Prune `reviewedComments` after a successful scan. The state keeps `{id, harvestedAt}` per
repository, not the creation time, and a comment is harvested only after its PR merged, so an entry
whose `harvestedAt` is older than `lateReviewDays` belongs to a PR that has left the window. Run
`supervisor state reviewed --prune-before <ISO time>` with the window start: it drops those entries
under the state lock, alone or together with `--file`.

Advance `scannedThrough` to the newest `mergedAt` scanned (or the sweep start) only after the scan
succeeds. If a `gh search prs` stands in for the GraphQL listing, it has no `mergedAt` field (for a
merged PR `closedAt` equals the merge time) and takes dates, not times, so filter by exact time
after fetching; a `--limit 1000` search is ten search-API calls, so batch it.
Advance `activityThrough` to the sweep start only after step 2 succeeds, and set
`fullScanAt` after a full rescan. Pass each key as its own argument, because a repository name can
contain a dot:
`supervisor state set lateReview <owner>/<repo> scannedThrough --json '"<ISO time>"'`.

The supervisor loop also runs this scan for one PR as soon as a wait reports it merged (see
[handling a wait result](../../supervisor-loop/references/events.md#per-event)). That per-PR check
advances no cursor, so everything above still applies, and `reviewedComments` dedupes between the
two.

In a `report` repository nothing is filed, so record no `reviewedComments` and advance no cursor
above: a later switch to `enforce` must still file what the scan found. Run the harvest and the
noise filter there and report candidate counts per repository, but verify only a sample: at most 5
candidates per owner, newest first, labeled as a sample in the summary.
