# Mixed-Type Widget Argument Splitting

**Issue:** [#106](https://github.com/rohal12/spindle/issues/106)
**Date:** 2026-03-23

## Problem

`splitArgs()` supports space-separated arguments only when all arguments are quoted strings. When arguments mix variables (`$var`, `@var`) with quoted strings or numbers, the parser silently treats the entire string as a single expression, which fails evaluation and passes `undefined` to widget parameters.

## Solution

Replace `trySplitAdjacentQuotes()` with `trySplitOnWhitespace()` — a depth-aware whitespace splitter that reuses the same nesting/string-tracking logic already in `splitArgs()` Phase 1, but splits on whitespace at depth 0 instead of commas.

After splitting, each piece is validated via `isStandaloneValue()`. If any piece fails (e.g., a bare operator like `+`), the split is rejected and the input is returned as a single expression (preserving backward compatibility for expressions like `"foo" + "bar"`).

### `trySplitOnWhitespace(raw: string): string[] | null`

1. Walk the string character by character, tracking `depth` (parens/brackets/braces) and `inString` (quote tracking).
2. At depth 0 and outside strings, whitespace splits tokens.
3. If fewer than 2 tokens result, return `null`.
4. Validate each token with `isStandaloneValue()`. If any fails, return `null`.

### `isStandaloneValue(token: string): boolean`

A token is standalone if its first character indicates a complete value:

| Pattern                           | Examples                                |
| --------------------------------- | --------------------------------------- |
| Quoted string (`"`, `'`, `` ` ``) | `"hello"`, `'world'`                    |
| Variable (`$`, `_`, `@`)          | `$var`, `_temp`, `@local`, `$obj.field` |
| Number (digit, or sign+digit)     | `42`, `3.14`, `-1`                      |
| Grouped (`(`, `[`, `{`)           | `($x + 1)`, `[1,2]`                     |
| Keywords                          | `true`, `false`, `null`, `undefined`    |
| Negation (`!` + more)             | `!$flag`, `!true`                       |

Anything else (operators, bare identifiers) → not standalone → reject the split.

## Behavior Changes

| Input                        | Before                                | After                               |
| ---------------------------- | ------------------------------------- | ----------------------------------- |
| `$myVar "world"`             | `['$myVar "world"']` (silent failure) | `['$myVar', '"world"']`             |
| `$x $y`                      | `['$x $y']`                           | `['$x', '$y']`                      |
| `$x 42`                      | `['$x 42']`                           | `['$x', '42']`                      |
| `"foo" + "bar"`              | `['"foo" + "bar"']`                   | `['"foo" + "bar"']` (preserved)     |
| `$obj.method("a b") "label"` | single expr                           | `['$obj.method("a b")', '"label"']` |
| `"a" "b"`                    | `['"a"', '"b"']`                      | `['"a"', '"b"']` (unchanged)        |
| Comma-separated args         | unchanged                             | unchanged (comma path has priority) |

## Test Plan

- Update existing `'$x "bar"'` test to expect successful split
- Add cases: `$var $var`, `$var 42`, `$var true`, `$obj.method("a b") "label"`, `!$flag "label"`, `($x+1) "label"`
- Keep `"foo" + "bar"` test (still single expression)
- Keep all existing comma-mode and edge-case tests
