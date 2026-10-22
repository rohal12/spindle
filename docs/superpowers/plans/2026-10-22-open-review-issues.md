# Open review issues implementation plan

**Goal:** Fix every open, unblocked issue (#620–#625), plus the remaining initial-focus path documented on #460.

**Architecture:** Keep widget classification with the parser's existing widget registrations. Cache immutable binding facts and parsed configs within each discovery call. Index source positions within each validation/parsing pass and bound optional name suggestions. Traverse authored shadow trees in their focus scopes and share iframe entry logic between initial focus and subsequent navigation.

**Tech stack:** TypeScript, Preact, Vitest, Playwright Chromium, Bun, Node 24.

**Spec:** GitHub issues #620–#625 and the latest reproduction on #460.

## Constraints and review focus

- Preserve built-in branching and raw JavaScript when no widget overrides them; reset classification when widgets clear.
- Keep static discovery's lexical scopes, write invalidation, offsets and per-call isolation.
- Preserve ordinary suggestions and exact UTF-16 diagnostic positions, including tolerant pairing errors.
- Keep positive tabindex ordering within each shadow scope, slots, hidden/inert hosts, nested roots and opener restoration.
- Preserve iframe, native media/date controls, nested dialog boundaries and dynamically loaded frame behavior.

## Task 1: Widget parsing (#620, #621)

- [x] Add runtime regressions to `test/headless/boot-widget-invocation.test.ts` for children and selectors of widgets named `if`, `switch`, `timed`, and `do`; watch failures.
- [x] Update `src/markup/ast.ts` classification to respect registered widget names; pass widget-aware raw hooks through tooling validation where needed.
- [x] Run widget, parser and tooling tests; preserve built-in behavior and registry cleanup.

## Task 2: Macro discovery (#622)

- [x] Add a bounded repeated-config regression to the tooling/discovery tests; watch failure.
- [x] Cache binding facts by name and property set in `src/js-bindings.ts`, reuse function-scope lookups, and cache parsed configs by source offset in `src/macro-discovery.ts`.
- [x] Run discovery and JavaScript binding coverage, including changed configs and shadowed declarations.

## Task 3: Validation scaling (#623, #624)

- [x] Add regressions for oversized names and many correctly positioned diagnostics, including tolerant parsing; watch failures.
- [x] Bound optional suggestion work in `src/markup/validate.ts` and reuse source-position indexes in validation, pairing and tolerant parsing.
- [x] Run markup validation, pairing, tokenizer and tooling tests.

## Task 4: Modal focus (#625, remaining #460 path)

- [x] Add compiled-story Chromium regressions covering forward/reverse shadow traversal, nested roots/slots, opener restoration and initial iframe entry; watch failures.
- [x] Update `src/hooks/use-modal-focus.ts` to use composed focus scopes and deep active elements; share frame entry logic for initial focus.
- [x] Run dialog DOM tests and browser regressions, including prior iframe/date/media cases.

## Final verification and delivery

- [x] Update the changelog, run formatting, type checking, build, full Vitest suite and browser suite.
- [x] Review the complete diff for regressions and fix any findings.
      Delivery: re-check open issues/PRs, commit, push the branch, and create one PR closing #620–#625.

## Triage

`gh issue list --state open --limit 200` returned #620–#625. The explicit blocked-label query returned no issues. #460 is closed; its remaining initial-focus path is covered with #625. No issue needs another repository or a maintainer decision.

## Review and decisions

Independent review confirmed two additional shadow traversal cases: text-only slot assignments must suppress fallback controls, and an explicitly visible control remains reachable inside a `visibility:hidden` shadow host. Both were reproduced with failing Chromium tests and fixed.

Binding and config caches are local to each discovery pass. The existing tolerant group lookup remains intact to preserve malformed-input semantics; review benchmarks put the reported 800-registration workload near 100–200 ms rather than the original roughly 15 seconds. Larger scripts can still have nonlinear scope-lookup work.

Name suggestions are optional: cap name lengths, candidate count and comparison work, while always reporting the underlying unknown-name diagnostic. The behavior is documented in `docs/tooling.md`.

## Verification

- `bun run test:coverage --maxWorkers=4`: 4,866 tests passed in 283 files; statement coverage 93.18%, line coverage 94.53%.
- `bun run typecheck`: passed, including test and consumer declarations.
- `bun run format:check`: passed.
- Focused Chromium regressions: six passed, including both review findings.
- `bun run test:e2e --maxWorkers=2`: 312 tests passed in 20 files; global setup built the runtime and compiled the development story without warnings.
- Screenshots: `docs/public/images/review-widget-overrides.png` and `docs/public/images/review-shadow-dialog.png`.
