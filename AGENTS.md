# supervisor

- Prefer `pnpm` over `npm`.
- Write TypeScript only (ESM, Node >=24); do not add Python.
- Keep every source file at or under 200 lines (`oxlint` enforces `max-lines`).
- Maintain 100% test coverage across lines, branches, functions, and statements (enforced by Vitest and Codecov).
- This repository is public: never include private repository names, owner names other than `jonathanong` and `jongleberry`, hostnames, emails, or other personal logins anywhere.
- Use `pr-shepherd` for pull requests; do not use `gh pr checks`.

## References

- [docs/use-cases.md](docs/use-cases.md): read when designing supervisor features or checking real agent failure modes.
- [evals/AGENTS.md](evals/AGENTS.md): read when adding, changing, running, or recording eval cases.
