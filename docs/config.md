# Configuration

Everything that can differ between owners, repositories or machines is data in one JSON file per installation. This repository holds the schema and an example with no real names. The file itself is kept in a private config repository, because it names private scopes.

[Back to the graph](graph.md)

- **Shape:** [schemas/config.json](../schemas/config.json) defines every key. [examples/config.example.json](../examples/config.example.json) is a complete file.
- **Location:** the `SUPERVISOR_CONFIG` environment variable names the file.
- **Check:** `supervisor config validate [path]` validates a file against the schema, and defaults to `$SUPERVISOR_CONFIG`.

## Defaults and overrides

Top-level values are defaults, and a scope overrides them. `provenance.fields` shows the pattern: the top level lists the fields every [claim](claims-and-taxonomy.md#claims) carries, and one scope can list its own, for example to add the machine name where several machines work on the same repositories.

## Scopes

A scope is one GitHub owner and the repositories the supervisor covers there.

- **`kind`** is `org` or `user`. It matters because GitHub lists an organization's repositories and a user account's repositories through different endpoints, and the event wait takes one owner at a time. So the supervisor keeps one wait and one cursor per owner.
- **`repos`** is `"*"` or a list of names. With `"*"`, `excludeForks` and `excludedRepos` narrow it. With a list, only those repositories are supervised. Archived repositories are always skipped.
- **`mode`** is `enforce` or `report`. `enforce` runs every phase. `report` triages and reports, with no worker PRs and no merges. It suits a scope with outside contributors, where the [untrusted-text rule](guardrails.md) and the list of trusted logins carry more weight.
- **`taxonomy`** holds a scope's own milestone and project conventions, such as which project a repository's issues belong to.

## Who may merge

`mergeAuthority` says who may merge at all, and which evaluation to trust. It does not say what a PR needs.

- **`policy`** is the path to the supervisor policy. Merge rules are not in the config file. They live in that policy and in repository policies, in the `approvals.yml` format: see [merge-policy.md](merge-policy.md).
- **`policyEngine`** picks the evaluation: the supervisor's own, the Claude Approvals check, or both compared. See [merge-policy.md](merge-policy.md#staying-compatible-with-claude-approvals).
- **`hosts`, `models` and `attendedOnly`** limit merging to named machines, named models and an attended session. A session outside them can still run workers and sweeps, and hands its merges over.

## Requesting the final review

`finalReview` says how to ask the final reviewer for a review of a head: a message to its session, a label on the PR, or both. `label` names that label.

Whether a review is required is a rule in the merge policy, not a setting here.
