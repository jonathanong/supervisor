# Loop 4: claims, milestones and labels

Agents leave GitHub saying who is working on what and where it fits. The supervisor reads ownership from the forge, not from terminal pane titles.

[Back to the graph](graph.md)

## Claims

A claim is a provenance comment an agent posts when it opens a PR or picks up an issue. It has one fixed shape, so a script can parse it:

- harness and harness version
- model or models
- session id
- role: author, shepherd or reviewer
- any further fields a scope's config adds, such as the machine

**One writer.** The MCP tools `pr_create` and `pr_update` render the comment, so its format cannot drift between repositories, and `pr_validate` checks descriptions and provenance comments before a push. The fixed comment format begins with `<!-- supervisor:provenance v1 -->` followed by `- <field>: <value>` lines for `harness`, `version`, `models`, `session`, `role`, and any extra fields configured for the repository scope in supervisor config. Credentials are stripped before writing, and `pr_create` and `pr_update` inherit the linked issue's open milestone and open projects. See [skills/supervisor-pr/SKILL.md](../skills/supervisor-pr/SKILL.md).

**Reconciliation.** Each sweep matches claims against the live agents:

- a claim whose session is gone is marked stale and the work is re-dispatched
- a second claim on the same issue or PR is refused
- work in a repository that another session owns goes to that session

The claims answer "who owns this?". The supervisor uses them, with the live agent list and its own work, to [coordinate](coordination.md).

## Milestones and projects

- **PRs inherit.** A PR that closes an issue takes that issue's milestone and project.
- **One project per issue,** by default. Before adding an issue to a project, the agent checks that the project's auto-add won't pull a sub-issue into a second project. A repository can override this in its `AGENTS.md`.
- **Agents may create milestones.** A milestone is an epic within one repository: created for a piece of work and completed with it, so it needs no approval. A milestone with nothing open is proposed for closing. A closed milestone is never reopened: new work gets a new milestone.
- **Reopened issues leave closed milestones.** When an issue in a closed milestone is reopened, the closed milestone stays closed. During the sweep, the agent moves the issue out of the closed milestone: into a fitting open milestone, into a new open milestone when several open issues or PRs share its theme, or—for a lone follow-up with no fitting milestone—clears the closed milestone so triage handles it (in an existing project, worked on now as a one-off, or flagged for a decision). Either way it can be dispatched instead of staying stuck in a closed milestone (see [backlog](backlog.md)).
- **Projects need a person's approval to create.** A project spans repositories and is high-level, so an agent proposes one and waits. Agents may add issues to existing projects.
- **Progress in the sweep summary.** For each open milestone: open and closed counts, items with no claim and no linked PR, and items claimed but idle.

## Labels

Labels are permanent, unlike milestones and projects, so they get a higher bar.

- **Use existing labels first.** A new label is only for a lasting category. Something tied to one piece of work belongs in a milestone or a project.
- **A person approves every new, renamed or deleted label:** the exact name, description, colour and repositories.
- **Follow the standards.** A label every repository in an organization shares lives in that organization's declared label source, for example infrastructure-as-code, so a new shared label is a PR to that source. A label for one repository is created there, matching its naming and colours. Path labels also get a rule in that repository's labeler config.
- **Proposals are batched.** When nothing fits, the agent records a proposal with the exact name and description, plus the issues it would hold. The supervisor batches proposals per repository into one decision.

The generic procedure for both lives in the `github-issue` and `github-repository-settings` skills in [ratchet-stack](https://github.com/jongleberry/ratchet-stack).

## Audit

Each sweep checks PRs and issues for a milestone, labels, a closing reference and an owner, fixes what is missing, and detects any open issue still in a closed milestone so it is moved to an open milestone or cleared for triage. It closes duplicates and issues already fixed, after checking each against the current default branch, with a comment and the right close reason. Every open issue should be in an open milestone or a project, or be in progress; a flake is always in progress. A periodic taxonomy audit reports:

- near-duplicate and unused labels
- labels made for one-off work
- labels on GitHub that are missing from the declared label source
