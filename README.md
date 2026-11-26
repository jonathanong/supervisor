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

The supervisor loop keeps its state and waits for events through two commands. Both read the config from `$SUPERVISOR_CONFIG`, else `.supervisor.json` in the current directory, and need `stateDir` set. They call `gh`, and `wait` runs `hook-harness` through `npx`.

- `supervisor state <subcommand>` is the only writer of `<stateDir>/state.json`. Each subcommand checks the shape of the fields it touches, holds a lock for the whole read-modify-write, and replaces the file atomically. `supervisor state --help` lists the subcommands.
- `supervisor wait --owner <owner> [--advance]` waits for one owner's repository events and returns only the ones that need action: a JSON summary line, then one compact JSON line per event. The full result goes to `<stateDir>/hh-last.<owner>.json`. Run one wait per scope owner. `supervisor wait --help` describes what returns.

## Policy commands

What may merge without a person is written in a [merge policy](docs/merge-policy.md). Two commands read it:

- `supervisor policy explain <dir> [path]` lists the policy files under `<dir>`, or the rules that decide one path.
- `supervisor policy check <owner>/<repo> <pr> --dir <dir> [--supervisor-policy] [--json]` reads one pull request from GitHub through `gh api` and evaluates it: its current head, changed files, authors, labels, approvals of that head, and every check on that head. It prints the rules that apply, the verdict, the seats and who fills them, the checks, and the next step. It exits 0 only when the next step is a merge, 1 when it is not, and 2 when the pull request or the policy could not be read whole.
  - `--print-input` prints the collected input as JSON and evaluates nothing.
  - `--classifiers <json>` gives classifier results, which the command cannot collect. Without it, a rule that waits on a classifier stays undecided.
  - `supervisor policy check --dir <dir> --input <json>` evaluates a written input file instead, for dry runs and the eval. It reads no checks.

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
