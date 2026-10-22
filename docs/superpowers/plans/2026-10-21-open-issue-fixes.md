# Open Issue Fixes Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task with regression tests.

**Goal:** Fix all four currently open issues (#615–#618) in one pull request.

**Architecture:** Keep runtime and tooling on their shared declaration and argument readers. Extend the passive snapshot builder to freeze native styles and remap local SVG references without running authored lifecycles.

**Tech Stack:** TypeScript, Preact, Vitest, Playwright Chromium.

**Spec:** GitHub issues rohal12/spindle#615, #616, #617, #618.

## Global Constraints

- Follow CLAUDE.md: reuse shared readers; fix matching patterns throughout the repository.
- Preserve snapshot inertness, custom-element isolation, and outgoing animation.
- Run typecheck, formatting, full tests, browser tests, build, and duplication checks.
- Push one branch and create or update one PR with each closing issue reference.

## Review Focus

- Trailing comments in both declaration scopes; syntax diagnostic offsets remain accurate.
- Widgets with and without holds, mixed-case names, and either metadata ordering override macro contracts.
- Input-name widgets must not inherit quoted variable bindings; genuine widget code and holds remain checked.
- Native Markdown, ID styles, pseudo-elements and custom-element shadow contents retain their appearance.
- SVG URL and href references resolve within the snapshot, with incoming IDs and animation isolated.

### Task 1: Initializer comments (#617)

**Files:** src/story-variables.ts; test/unit/parse-declarations.test.ts; test/unit/story-variables.test.ts.

- [x] Add failing runtime and tooling cases for trailing comments in both scopes.
- [x] Run focused declaration tests and confirm the expected failures.
- [x] Terminate initializer lines before generated closing syntax in both wrappers.
- [x] Run focused tests and commit (185 tests passed).

### Task 2: Widget validation precedence (#618)

**Files:** src/code-check.ts; src/story-variables.ts; test/unit/widget-macro-precedence.test.ts; test/headless/boot-widget-macro-precedence.test.ts.

- [x] Add failing tooling and boot regressions for shadowed expression and binding macros, with and without holds.
- [x] Make shared parameter lookup select widgets before macro metadata regardless of list order; suppress shadowed built-in special cases and binding rules.
- [x] Verify focused validation, variable-reference and widget tests; commit (481 tests including DOM snapshot regressions passed).

### Task 3: Snapshot appearance (#615, #616)

**Files:** src/components/macros/PassageDisplay.tsx; test/e2e/issue615-616.test.ts; CHANGELOG.md.

- [x] Add browser regressions for native and pseudo styling and SVG gradients, clip paths and use references in both outgoing transition modes.
- [x] Observe failures against the existing build.
- [x] Freeze visual CSS for native elements while allowing the root outgoing animation; assign fresh SVG IDs and rewrite snapshot-local URL/href references, including computed CSS and shadow trees.
- [x] Verify focused snapshot tests and update the changelog (11 browser tests passed).
- [x] Run all required checks and review the complete diff.

Final verification: 4,857 regression tests and 301 browser tests passed. Type checking, formatting, build and all three duplication checks passed; duplication did not increase against `origin/main`. Review identified a literal-percent SVG ID case, covered by a failing regression and fixed before the final browser run.

Delivery: commit and push the fixes on `fix/review-issues-615-618`, then open one pull request closing #615–#618. No open issue required the `blocked` label.
