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

- `tokenizeMarkup(source, { text? })` returns the flat `Token[]` (`text`, `link`, `macro`, `variable`, `expression` and `html` tokens, each with `start` and `end`; a `link` token also has `targetStart` and `targetEnd`, where its target is written), and throws a `MarkupError` (with `reason`, `offset`, `line`, `column`) for a malformed tag.
- `tokenizeMarkupTolerant(source, { text? })` is `tokenizeMarkup` for half-typed markup. It never throws for malformed tags: it returns `{ tokens, errors }`, where `errors` holds a `MarkupError` for each malformed tag. The tokens before a malformed tag are kept, the character that started it is read as text, and tokenizing resumes after it, so every character of `source` is in exactly one token and all offsets are in `source`. For well-formed markup the tokens are `tokenizeMarkup`'s and `errors` is empty. A `MarkupError`'s `offset` is where the problem is: the start of the unclosed `{` or `[[`, or the opening quote of an unclosed attribute value.
- `parseSelectors(source, at?)` reads the `.class#id` selectors that start `source` at `at`, and returns `{ className?, id?, end }`, where `end` is the index past them and the one space that may follow. Names may contain `{$name}` interpolations.
- `SIGIL_SCOPES` maps each sigil to its scope (`variable`, `temporary`, `local`, `transient`), and `isSigil(c)` tests a character.

## Macro arguments

- `splitArgs(raw)` splits at top-level commas, or, with none, adjacent standalone values (`"Label" "target"`).
- `splitTopLevel(src, isSeparator)` splits at every separator character outside literals, comments and brackets.
- `readQuoted(src, start)`, `unescapeQuoted(body)` and `stripLooseQuotes(src)` read quoted arguments: `\"`, `\'` and `\\` are unescaped, other backslashes kept.
- `endsWithOperator(src)` tells whether code ends in an operator that still needs an operand.
- `splitIncludeFlag(rawArgs)` returns `{ inline, passage }` for the arguments of `{include}`: the `inline` flag only counts as the first or last word outside quotes and brackets.

## Code and passage names

- `transform(expr, goal?)` is the sigil transform: it returns the JavaScript Spindle runs for `expr`, with `$var`, `_var`, `@var` and `%var` turned into `variables["var"]`, `temporary["var"]`, `locals["var"]` and `transient["var"]`. References in string, template and regex literals and in comments are untouched. Pass `'statements'` for a `{do}` body. It throws a `SyntaxError` for code that is not well-formed.
- `passageTarget(arg)` reads the `passage` argument of `{goto}`, `{include}` or `{link}`: a string literal is a name (`{ kind: 'name', name }`, its value as JavaScript reads it: `"\u0048all"` is `Hall`), anything else (a literal JavaScript rejects too) an expression (`{ kind: 'expression', expression }`) whose value names the passage when it runs.
- `evaluatePassageName(expr, evaluate, { storyData, currentPassage })` is how the macros find the passage: `String(evaluate(expr))`, throwing what `evaluate` throws and an error naming the current passage if no passage has that name. Give it your own `evaluate`.
- `collectPassageReferences(source)` returns the passages the markup names, in source order, as `{ macro, target, start, end }`: `[[…]]` links (`macro` is `link`), the passage argument of `{goto}`, `{include}`, `{link}` and macros that declare one, the `goto` and `dialog` actions of `{watch}` (and the `string` and `text` arguments of macros that declare they [hold a passage name](custom-macros.md#what-a-string-holds)) and the body of `{dialog}`, one for each. `target` is a `passageTarget`; `start` and `end` span the name as written (quotes included), the target of a link (not its label). It uses the macros registered with `defineMacro`, and skips malformed tags, so it reads half-typed markup.

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
