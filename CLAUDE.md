# Spindle: notes for coding agents

- Before writing a helper, parser, hook or lookup, search for an existing one
  and extend it; the shared modules are listed under "Code duplication" in
  README.md. Several bugs here were fixed more than once because parallel
  copies of the same logic existed.
- Fix a bug everywhere its pattern occurs, not only where it was reported.
- Before opening a pull request, run `npm run typecheck`, `npx prettier
--check .`, `npx vitest run` and `bun run duplication` (CPD needs
  `PMD_BIN`). CI fails on any added duplication compared with `main`; if a
  clone is really needed, raise `duplication-budget.json` in the same pull
  request and say why.
