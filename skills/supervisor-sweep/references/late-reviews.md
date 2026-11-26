# Phase F - Missed code reviews

Phase F is incremental. The state file keeps, per repository, `lateReview.<owner>/<repo>` with:

- `scannedThrough` (ISO time): only PRs merged after it get a full scan;
- `activityThrough` (ISO time): the `since` for the review-activity signal in step 2, advanced only
  after that step succeeds, falling back to `scannedThrough`;
- `fullScanAt`: the time of the last full window rescan.

For each repository, a mechanical-tier subagent scans in three parts, paginating fully:

1. **New merges:** fully scan every PR merged after `scannedThrough` and within `lateReviewDays`
   (default the last 14 days).
2. **Active older merges:** for PRs merged earlier but still in the window, use a cheap change
   signal and rescan only PRs with new review activity since `activityThrough` (falling back to
   `scannedThrough` when unset). Never use `lastSweepAt`: it advances even when Phase F is skipped
   or fails, so activity in that gap would be missed. Examples:
   - the repository-level review-comment and issue-comment lists sorted by `updated`
     (`gh api --paginate 'repos/<owner>/<repo>/pulls/comments?sort=updated&direction=desc&since=<ts>'`
     and `repos/<owner>/<repo>/issues/comments?sort=updated&since=<ts>`), mapped back to their PRs;
   - and, on every sweep, a signal that catches reviews with only a body: such a review is absent
     from both comment lists, and the weekly backstop can run after a PR has left the window. Search
     for merged PRs in the window updated since then
     (`gh search prs --repo <owner>/<repo> --merged --merged-at '>=<window start>' --updated '><ts>' --limit 1000 --json number`)
     and, for each, keep it when `gh api --paginate 'repos/<owner>/<repo>/pulls/<n>/reviews'` has a
     review whose `submitted_at` is after `<ts>`. A failed search or listing fails step 2, so
     `activityThrough` stays put.
3. **Backstop:** when `fullScanAt` is unset or older than `fullRescanDays` (default 7), rescan every
   PR in the window as before.

Each scanned PR harvests review comments, review threads, and review bodies that are not yet in the
state file's `reviewedComments` and that either:

- were created after the PR's `mergedAt`, or
- were unresolved at merge.

An implementation-tier subagent verifies each comment against the current default branch and drops
anything already addressed, non-actionable, or a duplicate of an open issue. File one issue per root
cause through the `github-issue` skill, linking the PR and comment with a non-closing, fully
qualified reference. The issue carries the exact existing `follow-up` label; re-fetch it and verify
the label and link. When labeling or linking is unavailable or unauthorized, report the blocker
instead of filing it unlabeled. Add a harvested comment id to `reviewedComments`
(`supervisor state reviewed --file <ids file>`, a `{"<owner>/<repo>": [ids]}` file) only once it is
dropped or its issue's label and link are verified; leave a blocked comment out so a later sweep
retries it. Prune ids whose PR has left the window. A comment posted days after merge is still
found.

Advance `scannedThrough` to the newest `mergedAt` scanned (or the sweep start) only after the scan
succeeds. Advance `activityThrough` to the sweep start only after step 2 succeeds, and set
`fullScanAt` after a full rescan. Pass each key as its own argument, because a repository name can
contain a dot:
`supervisor state set lateReview <owner>/<repo> scannedThrough --json '"<ISO time>"'`.

The supervisor loop also runs this scan for one PR as soon as a wait reports it merged (see
[handling a wait result](../../supervisor-loop/references/events.md#per-event)). That per-PR check
advances no cursor, so everything above still applies, and `reviewedComments` dedupes between the
two.
