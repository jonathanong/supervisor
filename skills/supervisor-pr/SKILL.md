---
name: supervisor-pr
description: Use when opening, updating, or validating a pull request through the supervisor MCP tools (`pr_validate`, `pr_create`, `pr_update`). Defines the PR description rules, fixed provenance comment format, credential stripping, and issue milestone and project inheritance.
---

# Supervisor: pull request descriptions and provenance

Use the `supervisor mcp` tools (`pr_validate`, `pr_create`, `pr_update`) to validate, open, and
update pull requests. Read every applicable repository `AGENTS.md` first.

## Workflow

1. **Validate before pushing.** Call `pr_validate` with `repository`, `title`, `body`, and either
   structured `provenance` or a raw `provenanceComment`. Fix every reported rule error before
   pushing.
2. **Open with `pr_create`.** Pass `repository`, `head`, optional `base`, `title`, `body`, optional
   `draft`, optional `issue`, and `provenance`. The tool strips anything that looks like a
   credential before writing, validates the result, creates the pull request, posts one provenance
   comment, and applies the linked issue's open milestone and open projects.
3. **Update with `pr_update`.** Pass `repository`, `pr`, optional `title` and `body`, optional
   `issue`, and `provenance`. The tool strips credentials before writing, updates the pull request,
   updates the existing provenance comment in place (or creates one if absent), and applies the
   linked issue's open milestone and open projects.

## Scope provenance configuration

Never pass a list of configured provenance field names in tool arguments. The MCP server loads the
supervisor configuration (`$SUPERVISOR_CONFIG`, else `.supervisor.json` in the working directory),
resolves the matching scope for `repository`, and enforces `scope.provenance.fields` (falling back
to top-level `provenance.fields`) in addition to the five core claim fields. Provide values for
configured extra fields in `provenance.fields`.

## Provenance comment format

`pr_create` and `pr_update` render one comment in this fixed, parseable shape:

```text
<!-- supervisor:provenance v1 -->
- harness: claude-code
- version: 2.1.0
- models: claude-sonnet-4-6
- session: session-123
- role: author
- machine: workstation-1
```

Lines after `role` appear in the order configured for the repository's scope.

## Issue milestone and project inheritance

Pass `issue` or include a same-repository closing keyword in `body` (such as `Fixes #17` or
`Closes owner/repo#17`, outside fenced code blocks). `pr_create` and `pr_update` read that issue's
open milestone and open Projects v2 items and apply them to the pull request. Closed milestones and
closed projects are never inherited.

## Rules

`pr_validate`, `pr_create`, and `pr_update` enforce these rules:

- **`title-required`**: Provide a non-empty, single-line pull request title.
- **`title-length`**: Keep the pull request title at or under 72 characters.
- **`title-no-bare-issue`**: Describe the change in the title instead of using only an issue
  reference such as `#17` or `Fixes #17`.
- **`section-problem`**: Include a non-empty `## Problem` section explaining what was wrong or
  missing.
- **`section-change`**: Include a non-empty `## Change` section explaining what the pull request
  changes.
- **`section-verification`**: Include a non-empty `## Verification` section explaining how the
  change was verified.
- **`no-credentials`**: Never include credentials, API keys, bearer tokens, private keys, or URL
  passwords in the title, description, or provenance comment.
- **`provenance-marker`**: Begin the provenance comment with the exact marker line
  `<!-- supervisor:provenance v1 -->`.
- **`provenance-format`**: Format every line after the provenance marker as a unique
  `- <field>: <value>` bullet with no blank or malformed lines.
- **`provenance-harness`**: Include a non-empty `harness` field naming the coding harness.
- **`provenance-version`**: Include a non-empty `version` field giving the harness version.
- **`provenance-models`**: Include a non-empty `models` field listing one or more comma-separated
  model names.
- **`provenance-session`**: Include a non-empty `session` field identifying the agent session.
- **`provenance-role`**: Set the `role` field to one of `author`, `shepherd`, or `reviewer`.
- **`provenance-scope-fields`**: Include every extra field configured in the repository scope's
  `provenance.fields` (falling back to top-level `provenance.fields`) with a non-empty value, and
  include no unconfigured extra fields.
