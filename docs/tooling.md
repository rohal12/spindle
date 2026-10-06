# Tooling API

`@rohal12/spindle/tooling` is the entry point for editors, linters and build tools that work on Spindle stories from Node.js. It loads without Preact, zustand, immer or micromark: everything it exports is a plain string-to-data function.

Besides the macro registry (`defineMacro`, `getMacroRegistry`) and the checks ([`parseStoryVariables`](special-passages.md#checking-declarations-in-tests), [`validateMarkup`](special-passages.md#checking-markup-in-tests)), it exports the parsing rules Spindle itself reads passages with. Use them instead of copying the rules: the runtime calls the same functions, so tooling and runtime agree on where a string, template or regex literal ends, what a selector is and how a macro's arguments split.

## Stability

The exports below are part of the package's public API and follow semver: a change to a signature, or to what a rule accepts, comes with a major version (while the package is at `0.x`, a minor version), and a new export with a minor one. Types are in `types/tooling.d.ts`. Offsets are UTF-16 code units, as in JavaScript strings.

They are leaf rules, not an AST: they take complete input and don't recover from half-typed text on their own, so an editor keeps its own error-tolerant control flow around them.

## JavaScript lexer

| Export                                  | What it does                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lexJs(src, handlers, goal?)`           | Walks `src` as JavaScript, calling `code`, `literal` and `variable` handlers in source order, every character once. Lenient: an unterminated literal runs on. |
| `lexTemplate(src, start, handlers?, n)` | `lexJs` for the template literal opening at `start`; returns the index past its closing backtick.                                                             |
| `findCodeEnd(src, start, options?)`     | Where the code starting at `start` ends: the `}` that closes the code (or, with `stop`, the first `{` for which it holds); `-1` if there is none.             |
| `scanStringLiteral(src, start)`         | The end of the `"…"` or `'…'` literal at `start`, and whether it is closed.                                                                                   |

`goal` is `'expression'` (the default, a macro argument) or `'statements'` (a `{do}` body); it decides whether `/` starts a regex or divides. A `Sigil` is `$`, `_`, `@` or `%`; `variable` handlers get the sigil and name of each reference such as `$gold` (not a property name, nor text in a literal).

## Markup tokens and selectors

- `tokenizeMarkup(source, { text? })` returns the flat `Token[]` (`text`, `link`, `macro`, `variable`, `expression` and `html` tokens, each with `start` and `end`), and throws a `MarkupError` (with `reason`, `offset`, `line`, `column`) for a malformed tag.
- `parseSelectors(source, at?)` reads the `.class#id` selectors that start `source` at `at`, and returns `{ className?, id?, end }`, where `end` is the index past them and the one space that may follow. Names may contain `{$name}` interpolations.
- `SIGIL_SCOPES` maps each sigil to its scope (`variable`, `temporary`, `local`, `transient`), and `isSigil(c)` tests a character.

## Macro arguments

- `splitArgs(raw)` splits at top-level commas, or, with none, adjacent standalone values (`"Label" "target"`).
- `splitTopLevel(src, isSeparator)` splits at every separator character outside literals, comments and brackets.
- `readQuoted(src, start)`, `unescapeQuoted(body)` and `stripLooseQuotes(src)` read quoted arguments: `\"`, `\'` and `\\` are unescaped, other backslashes kept.
- `endsWithOperator(src)` tells whether code ends in an operator that still needs an operand.
- `splitIncludeFlag(rawArgs)` returns `{ inline, passage }` for the arguments of `{include}`: the `inline` flag only counts as the first or last word outside quotes and brackets.

```js
import {
  tokenizeMarkup,
  splitArgs,
  parseSelectors,
} from '@rohal12/spindle/tooling';

for (const token of tokenizeMarkup('{.hint link "Go, now" "Hall"}')) {
  if (token.type === 'macro') console.log(token.name, splitArgs(token.rawArgs));
}
```
