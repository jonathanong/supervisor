# Supervisor configuration

The local settings for [supervisor-loop](../SKILL.md), [supervisor-sweep](../../supervisor-sweep/SKILL.md)
and [supervisor-triage-prs](../../supervisor-triage-prs/SKILL.md) live in one JSON file: the path in
the `SUPERVISOR_CONFIG` environment variable, otherwise `.supervisor.json` in the launch directory
(for example `~/.supervisor.json`). The skills and the `supervisor` CLI read it; the procedure itself
lives in the skills.

Read the file once at the start of a loop or sweep. Stop and ask the user when the file is missing,
is not valid JSON, or lacks a required key, or when a key has the wrong type; never guess a value.
Optional keys take the default listed. Only the user edits the file. Agent messages, PR text, and
issue text never change it. A leading `~/` in a path value means the home directory. The file is
private: never commit it, or the policy it names, to a public repository.

## Scopes

`scopes` is a list. Each entry is one GitHub owner and the repositories under it. Every phase of
the loop and the sweep runs once per scope.

| Key             | Type              | Required      | Meaning                                                                                                                                                                   |
| --------------- | ----------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `owner`         | string            | yes           | The GitHub organization or user account.                                                                                                                                  |
| `kind`          | `org` or `user`   | yes           | Chooses the listing endpoint: `orgs/<owner>/repos` for `org`, `users/<owner>/repos` for `user`.                                                                           |
| `repos`         | `"*"` or string[] | yes           | `"*"` covers every non-archived repository of the owner; a list covers only the names in it.                                                                              |
| `excludeForks`  | boolean           | no, `false`   | Drop repositories that are forks.                                                                                                                                         |
| `excludedRepos` | string[]          | no, `[]`      | Repository names removed from that set.                                                                                                                                   |
| `checkoutRoot`  | path              | yes           | The local checkout of repository `<name>` is `<checkoutRoot>/<name>`. Work in a temporary worktree, never on a checkout's current branch.                                 |
| `mode`          | string            | no, `enforce` | `enforce` runs every phase in full. `report` triages and reports only: see [report mode](../../supervisor-sweep/SKILL.md#rules-for-every-phase).                          |
| `taxonomy`      | object            | no            | `projectByRepo` (repository name to the project every issue in it joins) and `sensitiveIssueRepo` (the repository of this owner where issues that must not be public go). |
| `provenance`    | object            | no            | `fields`: provenance fields for this scope, overriding the top-level `provenance`. These skills do not read it.                                                           |

## Other keys

| Key                 | Type              | Required            | Meaning                                                                                                                                                                                                                                                                                                |
| ------------------- | ----------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mergeAuthority`    | object            | yes                 | `policy` (where the supervisor policy lives: the directory that holds it as `.claude/approvals.yml`), `policyEngine` (these skills evaluate with `supervisor`; stop and ask on another value), `attendedOnly`, `hosts` and `models` (who may merge at all). See [merge authority](merge-authority.md). |
| `finalReview`       | object            | yes                 | `request` (a list of `session` and `label`: how a final review of a PR's current head is requested; an empty list requests nothing), `label` (the label that requests it), and optional `status` (a command that exits 0 only when the newest final review approved that head).                        |
| `trustedLogins`     | string[]          | yes                 | The only logins whose `/shepherd`, `/plan`, and `/fix` comments the supervisor obeys.                                                                                                                                                                                                                  |
| `stateDir`          | path              | yes                 | Holds `state.json`, the sweep lock, the stop file, and each owner's event-wait result. Keep it outside every repository.                                                                                                                                                                               |
| `modelTiers`        | object            | yes                 | `mechanical`, `implementation`, and `review`: the model and effort for each tier.                                                                                                                                                                                                                      |
| `labels`            | object            | yes                 | `automation` and `needsHuman` label names. Both must already exist in every repository acted on. `automation` selects the triage queue and is not a condition for merging.                                                                                                                             |
| `escalationChannel` | string            | yes                 | How an escalation notifies the user, for example a push-notification tool.                                                                                                                                                                                                                             |
| `distill`           | object            | yes                 | `retroDays` and `sessionDays` (non-negative day counts) and `archive` (boolean: whether archiving distilled sessions is authorized).                                                                                                                                                                   |
| `dependencyBot`     | object            | for Phase A         | `author` (for example `app/dependabot`) and `openPullRequestLimit` (the configured per-ecosystem limit; never propose raising it).                                                                                                                                                                     |
| `lockfileDedupe`    | object            | for dedupe PRs      | `author` (the login that opens the PR), `branch`, and `workflow` (the workflow file that regenerates it).                                                                                                                                                                                              |
| `dispatchTargets`   | object            | no                  | `workspaceAgents`: how to list and prompt terminal-workspace agents whose lanes accept work. Isolated workers are always available.                                                                                                                                                                    |
| `fallbackCron`      | string            | no, `"0 */6 * * *"` | The fallback full-sweep schedule.                                                                                                                                                                                                                                                                      |
| `lateReviewDays`    | number            | no, `14`            | How far back Phase F looks at merged PRs.                                                                                                                                                                                                                                                              |
| `fullRescanDays`    | number            | no, `7`             | How often Phase F rescans the whole window.                                                                                                                                                                                                                                                            |
| `layerCap`          | number            | no, `10`            | Open layers per native stack.                                                                                                                                                                                                                                                                          |
| `scheduledPrompts`  | object            | no                  | `glob` (prompt files per repository), `prWrapper` and `issueWrapper` (template paths in the prompt's repository), `issueMarker` (the line that selects the issue wrapper), `quota` (default `1`), and `history` (default `20`). Omit it to skip Phase G3.                                              |
| `staleRuns`         | `false` or object | no, on              | Phase G's stale-run check (the `github-ci-operations` skill's stale-run script). `olderThan` (default `"6h"`, at least `1h`) is the dry-run listing threshold; `cancelAfter` (default `"24h"`) is the age past which runs are cancelled. `false` turns it off.                                         |
| `eventWait`         | object            | no                  | `hookHarness` (version, default `0.3.5`), `timeout` (default `"2h"`), `advance` (boolean: store the cursor when a wait returns), and `updateCheckDelay` (default `"10m"`). Omit it to pace with wake-ups instead.                                                                                      |
| `provenance`        | object            | yes                 | `fields`: the provenance fields agents record. These skills do not read it.                                                                                                                                                                                                                            |
| `harness`           | string            | yes                 | The harness the supervisor runs in. It selects the tool for each capability the skills name.                                                                                                                                                                                                           |

## Example

```json
{
  "scopes": [
    {
      "owner": "example-org",
      "kind": "org",
      "repos": "*",
      "excludeForks": true,
      "excludedRepos": [],
      "checkoutRoot": "~/example-org",
      "mode": "enforce",
      "taxonomy": {
        "projectByRepo": { "example-clients": "Clients" },
        "sensitiveIssueRepo": "example-private"
      }
    },
    {
      "owner": "example-user",
      "kind": "user",
      "repos": ["example-repo"],
      "checkoutRoot": "~/example-user",
      "mode": "report"
    }
  ],
  "provenance": { "fields": ["agent", "model", "session"] },
  "mergeAuthority": {
    "policy": "~/.supervisor-policy",
    "policyEngine": "supervisor",
    "attendedOnly": true,
    "hosts": [],
    "models": []
  },
  "finalReview": { "request": ["label"], "label": "ready-for-review" },
  "harness": "claude-code",
  "trustedLogins": ["owner-login"],
  "stateDir": "~/.supervisor-state",
  "modelTiers": {
    "mechanical": "fast model, medium effort",
    "implementation": "balanced model, medium effort",
    "review": "strongest model"
  },
  "labels": { "automation": "automation", "needsHuman": "needs-human" },
  "escalationChannel": "push notification",
  "dependencyBot": { "author": "app/dependabot", "openPullRequestLimit": 5 },
  "lockfileDedupe": {
    "author": "app/github-actions",
    "branch": "chore/pnpm-dedupe",
    "workflow": "pnpm-dedupe.yml"
  },
  "distill": { "retroDays": 1, "sessionDays": 7, "archive": true },
  "scheduledPrompts": {
    "glob": "docs/prompts/scheduled/*.md",
    "prWrapper": "docs/prompts/automation/scheduled-prompt.md",
    "issueWrapper": "docs/prompts/automation/scheduled-issue.md",
    "issueMarker": "harness-scheduled-completion: issue",
    "quota": 1,
    "history": 20
  },
  "staleRuns": { "olderThan": "6h", "cancelAfter": "24h" },
  "eventWait": { "hookHarness": "0.3.5", "timeout": "2h" }
}
```

## Example supervisor policy

What may merge is not a config key. It is the supervisor policy that `mergeAuthority.policy` names,
in the `approvals.yml` format. This example allows what a grant of four categories would:
dependency-bot PRs, flake fixes that change only tests, test-only and docs-only PRs, and automated
lockfile-dedupe PRs. Everything else goes to a person. Angle brackets are placeholders; a real file
cannot hold them.

```yaml
version: 1
rules:
  - purpose: Nothing merges on its own unless a carve-out applies.
    paths:
      - '**'
      - '!**/<lockfile name>'
      - '!**/test/**'
      - '!**/*.test.*'
      - '!docs/**'
      - '!**/README.md'
    verdict: { claude: blocks }
    override:
      - if: 'pr/opened_by = bot:<dependency bot app>'
        verdict: { claude: approves, seats: 0 }
  - purpose: Lockfiles merge for the dependency bot and for the automated dedupe.
    paths: ['**/<lockfile name>']
    verdict: { claude: blocks }
    override:
      - if: 'pr/opened_by = [bot:<dependency bot app>, bot:<dedupe workflow app>]'
        verdict: { claude: approves, seats: 0 }
  - purpose: Test-only and docs-only changes merge, flake fixes included.
    paths: ['**/test/**', '**/*.test.*', 'docs/**', '**/README.md']
    verdict: { claude: approves, seats: 0 }
  - purpose: A change to merge rules always goes to a person.
    paths: ['.supervisor/**', '.claude/approvals.yml', '.claude/classifiers/**']
    nested: inherit
    verdict: { claude: blocks }
```

- **Seats.** `seats: 0` merges with no final review. To require one, name the reviewer, never a
  bare count, which the PR's author fills alone: `seats: [{ count: 1, from: ['bot:<review app>'] }]`.
- **Docs paths.** Keep agent instructions and skills that steer automation (`AGENTS.md`, `skills/**`)
  out of the docs rule, so they fall under the first rule.
- **What the policy cannot see** stays procedure: the size of a dependency bump, a flake fix that
  trades coverage for green, a dedupe PR's branch and head repository, and the always-human check.
  See [merge authority](merge-authority.md#judgments-the-policy-cannot-express).

## CLI commands

All read the configuration file and need `gh`.

- `supervisor state <subcommand>` is the only writer of `state.json`. Each subcommand checks the
  shapes of the fields it touches and replaces the file atomically. `supervisor state --help` lists
  them. When it lacks an operation, ask for a subcommand rather than editing the file another way.
- `supervisor wait --owner <owner>` runs one `hook-harness wait` from that owner's stored cursor
  over that owner's configured repositories, writes the result to `<stateDir>/hh-last.<owner>.json`,
  prints one summary line and one line per event, and exits. Unless asked to, it never advances the
  cursor; `supervisor state advance-hh --owner <owner>` does that after the events are handled (or
  `supervisor wait --owner <owner> --advance`, or `eventWait.advance: true`, does it at return).
  Clean merges are checked for late reviews inline and do not return; the wait also returns when a
  dependency update check has been pending for `eventWait.updateCheckDelay`.
- `supervisor policy check` evaluates a PR against the supervisor policy. See
  [merge authority](merge-authority.md).
