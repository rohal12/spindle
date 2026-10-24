# Open review issues implementation plan

**Goal:** Fix open issues #638–#643 and the linked remaining SVG case in #569 in one pull request.

**Scope update:** #644 was filed while this work was running. Include it in the same PR: preserve builtin registration provenance in effective tooling metadata, suppress executable-body pieces/references/completion for replaced `do` macros, and preserve builtin and widget behavior. Verify through source tooling, runtime boot and the built package.

**Architecture:** Preserve existing save, pairing and recovery semantics. Track nested save captures and replacement navigation explicitly; index outstanding opener positions instead of repeated stack searches. Reuse the formatter's existing literal-element preservation for SVG.

**Constraints:** Follow CLAUDE.md; add regressions; run typecheck, formatting, full Vitest, browser tests, build and all three duplication checks. No blocked issues or existing open PR were found on GitHub.

## Tasks

- [x] #638: Reproduce nested and failed inner save-hook captures in `test/unit/load-pipeline.test.ts`; retain outer explicit writes and clean up captures on failure in `src/store.ts` and `src/saves/save-manager.ts`.
- [x] #639: Add an opener-name operation-count regression in `test/unit/pair-markup.test.ts`; index active macro/HTML frames in `src/markup/pair.ts`, retaining mismatch recovery.
- [x] #640: Reproduce unmatched bracket discovery in `test/unit/tooling-scaling.test.ts`; index active groups by bracket kind in `src/js-bindings.ts`, retaining recovery and discovery after malformed input.
- [x] #641: Add bounded scan and public validation regressions; skip impossible brace-end searches in `src/markup/code-attributes.ts`, preserving incomplete completion and later valid interpolation behavior.
- [x] #642: Reproduce companion-named widgets in DOM and text rendering; dispatch registered widgets before companion suppression in `src/markup/render.tsx` and `src/interpolation.ts`.
- [x] #643: Cover first-passage restart, same-length load and non-tail history load in `test/dom/passage-display-transition.test.tsx`; record replacement navigation identity in the store and consume it in `PassageDisplay.tsx`. Verify back/forward retain outgoing transitions.
- [x] #569: Cover standalone and embedded SVG text whitespace in `test/unit/format-passage.test.ts`; preserve SVG as literal elements through final cleanup.
- [x] Update changelog, run required checks, review complete diff, and prepare one PR listing `Closes #N` for each fixed issue. Publish the validated branch and PR as authorized.

## Review focus

- Nested capture writes before, during and after inner hooks, including failed hooks.
- Recovery with mixed HTML/macro names and mismatched bracket kinds.
- Code attributes with later valid braces and incomplete sigil expressions.
- Companion markers within native parents continue to work.
- Restart/load cancellation during transitions and ordinary history navigation.
- SVG whitespace survives injected Prettier and no-Prettier formatting.

Execution is authorized by the user's request to fix, verify, commit, push and open one PR; proceed inline without an additional approval handoff.

## Execution record

- Regression tests failed before the fixes for each reported defect.
- Review identified an incomplete last-brace guard for #641; expanded regressions with a trailing closer and a later valid interpolation failed, then passed with the conservative brace index. Parser syntax-error recovery and incomplete completion remain covered.
- Differential probes matched 30,946 brace-end decisions and 10,000 mixed bracket recovery inputs.
- All 4,958 runtime/integration/property tests pass with two workers and larger environment timeouts. TypeScript, formatting, build and all three duplication budgets pass.
- The original #593 browser assertion required an outgoing load snapshot, contrary to #643 and the documented contract. It now checks incoming-only restored values and controls; a new back-navigation case retains its departed-value snapshot coverage. The 12 tests in the affected browser files pass after this correction.
- GitHub re-check: six open issues, no blocked issues and no existing open pull request. Updated this branch to the current main merge commit without source changes.

Final browser verification: all 325 tests across 23 files pass with four workers. No issues require the blocked label.

#644 verification: source/tooling and runtime boot regressions failed before the fix; focused tests and independent review pass. All 4,964 runtime/integration/property tests, TypeScript, Prettier, documentation build and duplication checks pass with provenance-aware executable-body classification.
