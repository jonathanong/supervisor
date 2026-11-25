# Dependency updates

Dependency-bot PRs are the most routine work the supervisor merges. It triages them by update size and CI state, and repairs the ones that fail.

[Back to the graph](graph.md)

| Update                                 | Action                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Patch or minor, green                  | Merge, as the [merge policy](merge-policy.md) allows                                                         |
| Patch or minor, failing or conflicting | A fixer repairs it, then it merges as usual. A person is asked only when the fix takes it outside the policy |
| Major                                  | Assess first, as below                                                                                       |
| A lockfile-dedupe PR                   | Handled first in its repository                                                                              |

## Major updates

A worker reads the release notes, changelog and migration guide, finds the affected call sites, and checks whether tests run in CI exercise them. It returns one of:

- `no-migration`
- `small-migration`: mechanical edits with no runtime behaviour change
- `significant-migration`

With no migration or a small one, and the affected code covered by CI tests, the update merges as usual. A significant migration, or affected code without test coverage, goes to a person with the evidence.

When a bump needs code changes (a migration, new enum cases, a renamed type), the supervisor does not ask whether to upgrade. A fixer pushes the change to the bot's branch, and a person is asked only to approve a merge the policy does not cover.

## Repairing a bot's PR

- Read the PR's commits first. A commit by anyone but the bot means the bot's own rebase and recreate commands are off-limits, since they would discard it, and the fixer repairs the PR by hand.
- A conflict in a lockfile or other generated file is regenerated, never hand-merged.

## Keeping the bot moving

Merges free the bot's open-PR slots. After it merges bot PRs, or when a repository has none open, the supervisor requests a fresh update check for that repository and ecosystem.

## Grouping

Updates are grouped by vendor or release family, with a cooldown of about a week. There is no catch-all group and no split by dev and production. The supervisor flags split groups and PRs that have sat stuck.
