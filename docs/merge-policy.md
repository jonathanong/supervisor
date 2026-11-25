# Merge policy

What may merge without a person is written in the format of Claude Approvals' `approvals.yml` (`version: 1`), the format Claude Code's `/ship` uses. The supervisor evaluates it itself. So any harness can run the evaluator, and a repository can switch to the Claude Approvals product later without rewriting its rules.

[Back to the graph](graph.md)

## Two places a policy can live

| File                         | Where                                         | Role                                                         |
| ---------------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| Supervisor policy            | A private file, named in the config           | The root. Its rules apply in every repository of every scope |
| Repository policy (optional) | `.supervisor/approvals.yml` in the repository | Below the root, like a directory's policy file in the format |

They combine the way the format combines a root file and a directory's file. Where a repository has its own file, that file decides. Of the supervisor's rules, only those marked `nested: inherit` still hold there. So the always-human rules and the final-review seat are inherited rules. A repository file can add its own carve-outs or ask for more, and cannot remove them.

A PR that changes a policy file is judged by the default branch's copy, and an inherited rule sends every change to a policy file to a person.

## Staying compatible with Claude Approvals

- **Repository policies use only the product's vocabulary.** The product refuses a whole file for one unknown key, so the supervisor's loader checks each repository policy against that vocabulary.
- **Judgment carve-outs are `repo/<name>` classifiers,** defined in `.claude/classifiers/<name>/` in the product's layout. The supervisor runs them with its own model; the product would run the same definitions.
- **The folder is the switch.** `.supervisor/approvals.yml` is inert for the product. Moving it to `.claude/approvals.yml` hands that repository to Claude Approvals.
- **A trial without risk.** In `compare` mode the supervisor evaluates as usual, also reads the product's check, and reports any disagreement.

## How the supervisor reads the format

| Key                    | In Claude Approvals     | In the supervisor                                                                                                 |
| ---------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `claude: approves`     | Claude may approve      | The supervisor may merge once the seats are filled                                                                |
| `claude: comments`     | Claude does not approve | The supervisor does not merge; the PR goes to a person                                                            |
| `claude: blocks`       | Nothing merges          | Nothing merges                                                                                                    |
| `seats`                | Who must approve        | The same                                                                                                          |
| `pr/*`, `rule/*` facts | As documented           | The same, computed from the GitHub API                                                                            |
| `repo/<name>`          | Custom classifiers      | The same definitions, run by the supervisor's model                                                               |
| `claude/code_review`   | Anthropic's Code Review | Mapped to a review request to [code-reviewer](https://github.com/jonathanong/code-reviewer) at the matching depth |

**Extensions, in the supervisor policy only:** the facts `pr/repository`, because one file covers many repositories, and `pr/labels`.

**Outside the policy:**

- **Required CI:** the supervisor merges only once required checks pass, as the format leaves CI to GitHub.
- **Host, model and attended session:** these decide who may merge at all, so they live in the config.

## The author trap

Agents push under a person's login, so that person is the author of the agents' PRs. The author fills a seat without approving. So a bare `seats: 1` is met by the agent's own PR, with nobody looking. A rule that means "reviewed" names the reviewer: `[{ count: 1, from: "bot:<review app>" }]`. The evaluator flags any rule whose seats the author alone can fill.

## Review depth

The format takes no new keys, so full versus light review is expressed with what exists:

1. **The review level.** `claude/code_review(level=quick|standard|deep)`: a rule on sensitive paths asks for `deep`. The supervisor requests a review of that depth from the final reviewer.
2. **Path rules.** Light paths, such as docs and tests, need only the reviewer bot. Full paths need a person, or two seats. The strictest matching rule wins.
3. **Later, a classifier.** If paths prove a poor guide to risk, a `repo/review_depth` classifier with an ordinal output `[light, full]` can decide from the diff. With no result, the stricter verdict holds.

## What the evaluator tells an agent

`supervisor policy check <repo> <pr>` prints:

- the rules that apply
- the verdict
- the seats and who must fill them
- which seats are filled on the current head
- the review depth asked for
- the next step: merge, request a review at a given depth on that head, or escalate

`supervisor policy explain <repo> [path]` describes the policy without a PR. The MCP tool `policy_check` runs the same check, so a worker can ask what its PR needs.

## A sketch

Placeholders are in angle brackets; a real file cannot hold them.

```yaml
version: 1
locals:
  reviewed: [{ count: 1, from: 'bot:<review app>' }]
rules:
  - purpose: 'Nothing merges on its own unless a carve-out applies.'
    paths: ['**', '!**/test/**', '!docs/**']
    verdict: { claude: comments, seats: 1 }
    override:
      - { if: 'ALL pr/authors = bot:dependabot', verdict: { claude: approves, seats: '@reviewed' } }
      - { if: 'repo/flake_fix = yes', verdict: { claude: approves, seats: '@reviewed' } }
  - purpose: 'Test-only and docs-only changes merge once the reviewer approves.'
    paths: ['**/test/**', 'docs/**']
    verdict: { claude: approves, seats: '@reviewed' }
  - purpose: 'Always a person: CI workflows, migrations, payments.'
    paths: ['.github/workflows/**', '**/migrations/**', '**/payments/**']
    nested: inherit
    verdict: { claude: comments, seats: 1 }
  - purpose: 'A change to merge rules always goes to a person.'
    paths: ['.supervisor/**', '.claude/approvals.yml', '.claude/classifiers/**']
    nested: inherit
    verdict: { claude: comments, seats: 1 }
```
