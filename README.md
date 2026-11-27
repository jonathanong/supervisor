# supervisor

`supervisor` is an autonomous supervisor for coding agents across GitHub repositories and owners. It provides a CLI for configuration validation and supervision workflows, an MCP server (`supervisor mcp`), JSON Schemas, and agent skills.

## Install

Requires Node.js >=24 and [pnpm](https://pnpm.io/).

```bash
pnpm add -g @jongleberry/supervisor
```

Or build from source:

```bash
pnpm install
pnpm run build
```

Validate a configuration file:

```bash
supervisor config validate examples/config.example.json
```

Start the stdio MCP server:

```bash
supervisor mcp
```

## Loop commands

The supervisor loop keeps its state, waits for events, and is stopped through these commands. All read the config from `$SUPERVISOR_CONFIG`, else `.supervisor.json` in the current directory, and need `stateDir` set. They call `gh`, and `wait` runs `hook-harness` through `npx`.

- `supervisor state <subcommand>` is the only writer of `<stateDir>/state.json`. Each subcommand holds a lock for the whole read-modify-write, checks each top-level field that the write adds or changes against [schemas/state.json](schemas/state.json) (the field names and the exact shape of `schedule`), and replaces the file atomically; a write that breaks the schema exits 1 and saves nothing, while reads never check the file and an old invalid field that a write leaves alone does not block it. `supervisor state --help` lists the subcommands. `supervisor state merge-record --pr <owner>/<repo>#<N> --head <sha> --check <file> --review <text> --always-human <text>` records each autonomous merge from the `supervisor policy check <owner>/<repo> <pr> --json` result that allowed it. It refuses a result for another pull request or head, one made with `--input`, and one whose next step is not a merge; `supervisor state merge-records` lists the records by repository or rule.
- `supervisor wait --owner <owner> [--advance]` waits for one owner's repository events and returns only the ones that need action: a JSON summary line, then one compact JSON line per event. The full result goes to `<stateDir>/hh-last.<owner>.json`. Run one wait per scope owner. `supervisor wait --help` describes what returns. It exits 3 while the stop switch is set, and 4 (one line naming `supervisor state advance-hh --owner <owner>`) when `hh-last.<owner>.json` still holds events that were not advanced; that check is skipped when the wait advances itself. A hook-harness failure passes its own exit code through, told apart by its message (`hook-harness exited N`). It also drops events already in `hookHarness.<owner>.seen`.
- `supervisor stop [--reason <text>]` sets the stop switch, one file at `<stateDir>/stop` that records the time and the reason. `supervisor stop --status` prints whether it is set and exits 3 when it is; `supervisor resume` removes it. While it is set, `supervisor wait`, `supervisor state sweep-start`, and `supervisor state merge-record` refuse with one line and exit 3, and the skills check the status before every tick, mutation, and merge. The `supervisor state` subcommands that only record facts keep working. None of the three takes the state lock.

`supervisor preflight [--json]` runs the checks a loop needs before it starts, in one command. Each is reported as `{name, ok, detail}`: `config` (the file loads), `gh` (`gh auth status`, with the token scopes), `pr-shepherd` (`pr-shepherd --version`), `hook-harness` (`npx -y hook-harness@<eventWait.hookHarness> --version`), and `stop` (not ok while the stop switch is set). `hook-harness` is reported ok with the detail `not configured` when the config file does not set `eventWait`. When the config does not load, `gh` and `pr-shepherd` still run. The default `eventWait.hookHarness` moved from `0.3.5` to `0.4.1`; `supervisor wait` runs that version, and the preflight check needs `0.4.1` or newer (the first with `--version`), so a config that pins an older version keeps working for `wait` but fails the check. Each detail is one line. It prints one line per check, or one `{ok, checks}` object with `--json`, and exits 0 only when every check is ok.

## Policy commands

What may merge without a person is written in a [merge policy](docs/merge-policy.md). Two commands read it:

- `supervisor policy explain <dir> [path]` lists the policy files under `<dir>`, or the rules that decide one path.
- `supervisor policy check <owner>/<repo> <pr> --dir <dir> [--supervisor-policy] [--json]` reads one pull request from GitHub through `gh api` and evaluates it: its current head, changed files, authors, labels, and approvals of that head. It then asks pr-shepherd, read-only, whether it would merge the head; the merge is held unless it would. It prints the rules that apply, the verdict, the seats and who fills them, pr-shepherd's action, and the next step: merge, request a review (also when only a bot's seat is unmet), escalate to a person, or run pr-shepherd when the policy allows the merge but the head is not ready. pr-shepherd reads its config from `--repo-dir`, or from the current directory without it. It exits 0 only when the next step is a merge, 1 when it is not, and 2 when the pull request or the policy could not be read whole.
  - `--print-input` prints the collected input as JSON and evaluates nothing.
  - `--classifiers <json>` gives classifier results, which the command cannot collect. Without it, a rule that waits on a classifier stays undecided.
  - `supervisor policy check --dir <dir> --input <json>` evaluates a written input file instead, for dry runs and the eval. It reads nothing from pr-shepherd.

## Development

```bash
pnpm run format        # format files with oxfmt
pnpm run format:check  # check formatting
pnpm run lint          # lint with oxlint
pnpm run typecheck     # typecheck with TypeScript
pnpm run test          # run unit tests
pnpm run test:coverage # run tests with 100% coverage enforcement
pnpm run build         # compile TypeScript to dist/
pnpm run pack:check    # verify pnpm pack --dry-run file list
```

## Release

Bump `version` in `package.json` on `main`, then publish a GitHub Release tagged `v<version>` (`release.yml` tests, packs, and publishes to npm via OIDC).
