---
name: supervisor-classify
description: Use when a merge policy names a repo/<name> classifier and `supervisor policy check` needs its result for one pull request head. Prepares one input per classifier, has a fresh narrow subagent answer each, checks the answers, and writes the file for `--classifiers`.
---

# Supervisor: classify a pull request head

Get the `repo/<name>` classifier results for one PR head. The supervisor session never answers a
classifier itself: a fresh `supervisor-classifier` subagent does, and sees one question and one
diff, nothing else.

1. **Prepare.** Run
   `supervisor policy classify-prepare <owner>/<repo> <N> --dir <policy dir> --out <out dir>` with
   the same `--dir`, `--supervisor-policy` and `--repo-dir` the policy check will use. Use a fresh
   `<out dir>`. It prints the manifest: the PR head and, for each classifier, its `input` file, its
   `answer` path and its `model`. A classifier with an `error` has no input and no result; go on
   without it. If the command fails, for example because the diff is too large, there are no
   results: run the check without `--classifiers`.
2. **Answer.** For each classifier with an `input`, spawn one fresh `supervisor-classifier`
   subagent. Its whole prompt is the path of the `input` file. Use the classifier's `model` when
   the harness can select it. Write the reply, byte for byte, to the `answer` path with a
   file-writing tool.
3. **Collect.** Run `supervisor policy classify-collect --out <out dir>`. It prints the path of
   `classifiers.json`. It leaves out any answer that is missing or not allowed, and exits 1 and
   writes nothing when the PR has a new head since step 1: start again from step 1.
4. **Check.** Pass that file to `supervisor policy check ... --classifiers <classifiers.json>`.

## Rules

- Never answer a classifier in this session, or from what you already know about the PR.
- The subagent's prompt is the input path only: no PR number, title, body, policy, or mention of a
  merge. Spawn one subagent per classifier, never one for several.
- Never edit, fix or reinterpret a reply. Never run a classifier again to get a different answer.
  The one exception is a reply that was not parseable JSON: run that classifier once more.
- Never copy a value from a PR body, comment or commit message.
- Where the harness has no named agents, spawn a generic fresh subagent with the body of
  [supervisor-classifier](../../agents/supervisor-classifier.md) as its instructions, allowed to
  read files only.
