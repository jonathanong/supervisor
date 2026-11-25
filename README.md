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

## Development

```bash
pnpm run format        # format files with oxfmt
pnpm run format:check  # check formatting
pnpm run lint          # lint with oxlint
pnpm run typecheck     # typecheck with TypeScript
pnpm run test          # run unit tests
pnpm run test:coverage # run tests with 100% coverage enforcement
pnpm run build         # compile TypeScript to dist/
```
