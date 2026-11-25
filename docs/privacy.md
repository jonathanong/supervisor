# What may leave a private repository

The supervisor reads private repositories and private session data. Its outputs can land in public repositories, this one included. These rules keep the private data private.

[Back to the graph](graph.md)

| Material | Rule |
| --- | --- |
| Loop data: journals, snapshots, state, merge records, escalations | Private. It never appears in a public repository |
| Distilled findings | Filed in the repository they concern. A finding about a private repository stays there |
| Learnings bound for shared skills | Allowed from private repositories, as principles only: no code, paths or names from the source |
| Eval cases | Recreated, never copied. A worker writes a fresh case that shows the same mistake; the private case is not reused, even redacted |

## Enforced before a push, not at review

A PR in a public repository is public the moment it opens, so a reviewer who finds a leak finds it too late.

1. **Isolation.** The distill step can see private data, so it writes each change request in general terms. The worker that edits a public repository receives only that request, never the private session, PR or code. It has nothing to copy.
2. **`supervisor prepush`.** A pre-push hook scans the outgoing diff and commit messages against a private denylist kept outside the repository, plus built-in patterns for emails and hostnames. A match blocks the push. The hook reports which entry matched, never the term itself.
3. **Review keeps its usual job.** The final reviewer enforces the repository's own rules. It is not the privacy gate, and it is not told which names are private.
