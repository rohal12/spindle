# Tooling API

`@rohal12/spindle/tooling` is the entry point for editors, linters and build tools that work on Spindle stories from Node.js. It loads without Preact, zustand, immer or micromark: everything it exports is a plain string-to-data function.

Besides the macro registry (`defineMacro`, `getMacroRegistry`) and the checks ([`parseStoryVariables`](special-passages.md#checking-declarations-in-tests), [`validateMarkup`](special-passages.md#checking-markup-in-tests)), it exports the parsing rules Spindle itself reads passages with. Use them instead of copying the rules: the runtime calls the same functions, so tooling and runtime agree on where a string, template or regex literal ends, what a selector is, how a macro's arguments split, which closer closes which opener and which parts of a passage are code.

## Stability

The exports below are part of the package's public API and follow semver: a change to a signature, or to what a rule accepts, comes with a major version (while the package is at `0.x`, a minor version), and a new export with a minor one. Types are in `types/tooling.d.ts`. Offsets are UTF-16 code units, as in JavaScript strings.

The leaf rules take complete input and don't recover from half-typed text on their own. The tolerant functions (`tokenizeMarkupTolerant`, `pairMarkup`, `passagePieces`, `parseDeclarations`) never throw for malformed input: they return what they could read, and the errors.

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
- `tokenizeMarkupTolerant(source, { text? })` is `tokenizeMarkup` for half-typed markup. It never throws for malformed tags: it returns `{ tokens, errors }`, where `errors` holds a `MarkupError` for each malformed tag. The tokens before a malformed tag are kept, the character that started it is read as text, and tokenizing resumes after it, so every character of `source` is in exactly one token and all offsets are in `source`. For well-formed markup the tokens are `tokenizeMarkup`'s and `errors` is empty. A `MarkupError`'s `offset` is where the problem is: the start of the unclosed `{` or `[[`, or the opening quote of an unclosed attribute value. It also has `end` (where the offending text ends), a stable `code` and `data` (see [Diagnostics](#diagnostics)).
- Every token says where its parts are written, so an editor needn't scan the token's text again (all offsets are UTF-16 into the input, and the same for `tokenizeMarkup` and `tokenizeMarkupTolerant`):

  | Token                                     | Fields                                                                                                                                                                                                                                                                                                                           |
  | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `macro`                                   | `nameStart`/`nameEnd` (after `{`, `/` and the selectors); `argsStart`/`argsEnd` for `rawArgs`, without the whitespace around it (empty, at `nameEnd`, with no arguments)                                                                                                                                                         |
  | `link`                                    | `displayStart`/`displayEnd` for the label (`targetStart`/`targetEnd` for the target)                                                                                                                                                                                                                                             |
  | `variable`                                | `nameStart`/`nameEnd`, without the sigil                                                                                                                                                                                                                                                                                         |
  | `expression`                              | `expressionStart`/`expressionEnd`                                                                                                                                                                                                                                                                                                |
  | `html`                                    | `tagNameStart`/`tagNameEnd` (for closers too); `attributeSpans`, every attribute as written, in order, duplicates included: `{ name, nameStart, nameEnd, valueStart?, valueEnd?, quote? }` (a value is without its quotes; `quote` is `"` or `'`, absent for an unquoted value; `attributes` still has the first of equal names) |
  | `macro`, `link`, `variable`, `expression` | `selectorsStart`/`selectorsEnd` for the `.class#id` selectors, without the space after them; absent without selectors                                                                                                                                                                                                            |

  A `text` token that is a closed HTML comment has `comment: true`.

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
- `collectPassageReferences(source)` returns the passages the markup names, in source order (it is `passagePieces` less what names no passage, and reads the labels and attribute values that hold markup too), as `{ macro, target, start, end }`: `[[…]]` links (`macro` is `link`), the passage argument of `{goto}`, `{include}`, `{link}` and macros that declare one, the `goto` and `dialog` actions of `{watch}` (and the `string` and `text` arguments of macros that declare they [hold a passage name](custom-macros.md#what-a-string-holds)) and the body of `{dialog}`, one for each. `target` is a `passageTarget`; `start` and `end` span the name as written (quotes included), the target of a link (not its label). It uses the macros registered with `defineMacro`, and skips malformed tags, so it reads half-typed markup.

## Pairing tags

`pairMarkup(tokens, { isBlock?, isRaw?, source? })` pairs the flat tokens into a tree, as the runtime does (it builds its AST from the same pairing): which closer closes which opener, which `{else}`, `{case}`, `{default}`, `{elseif}` or `{next}` belongs to which macro, and which macros take a body. It returns `{ nodes, errors }` and never throws:

- A `PairedNode` is `{ token, body?, start, end }`. A token that stands alone (text, a link, a variable, an expression, a macro without a body, a self-closing element) has no `body`; the opening tag of a macro or element has `body: { children, branches, close? }`, where `branches` are `{ tag, children }` and `close` is the closing tag (absent if it is never closed). `start` and `end` span the whole thing, from the opening tag to the end of the closer.
- `errors` has a `PairingError` for each problem, in the order a parser reading from left to right notices them: `{ code, message, start, end, noticedAt, data }`, with `code` one of `unclosed-block` (`{if}` with no `{/if}`, `<div>` with no `</div>`), `mismatched-closer`, `stray-closer` and `misplaced-branch`. `start` and `end` are the offending tag.
- The tree is recovered around a problem. A closer closes the innermost open element, as the runtime reads it; when it names one further out, it closes that one, and what is open inside it stays unclosed. A closer with nothing open, and a branch outside its macro, are dropped from the tree.

Which macros take a body is `isBlock(name)`: by default the built-in ones (`isBlockMacro`, also exported). A story that defines other block macros passes them (the `block` of `defineMacro`'s macros, and the widgets it defines, which are blocks when their body uses `{@children}`). `source` lets a message say at which line and column an element was opened. `tokenizeMarkupTolerant` then `pairMarkup` reads half-typed markup:

```js
const { tokens } = tokenizeMarkupTolerant(source);
const { nodes, errors } = pairMarkup(tokens, { source });
```

## Pieces of a passage

`passagePieces(source, macros?)` says which parts of a passage are code, which are passage names, and which are text with markup of its own, and where each is: the answer the story-start check and `collectPassageReferences` read, so an editor needn't reconstruct it for variable references (rename, find references, undeclared-variable diagnostics, semantic tokens, hover), syntax checking and passage-name references. It reads half-typed markup, and returns, in source order, with `offset` in UTF-16 units into `source`:

- `{ kind: 'code', code, goal, label, passage?, inString?, macro? }`: `{$expr}` displays, `{do}` bodies, the conditions of `{if}`, `{elseif}` and `{case}`, macro arguments of an `expression`, `statements` or `passage` parameter, strings that [hold code](custom-macros.md#what-a-string-holds) (`goal` is `'expression'` or `'statements'`), and the `{…}` of attributes that hold code (`onclick`). `passage: true` marks a `passage` argument that is an expression.
- `{ kind: 'passage', name, length, macro, label }`: a passage name written out: `[[…]]` links (`macro` is `link`), quoted `passage` arguments, strings that hold a passage name, the body of `{dialog}`. `length` is how much of the markup it is, quotes included.
- `{ kind: 'text', text, where, tokens, errors }`: text that holds markup of its own (labels, attribute values). Its `tokens` and `errors` (a `MarkupError` for each malformed tag and unpaired tag, the first being what the story-start check reports) have offsets into `source`. **The pieces of that markup follow it**, with `nested: true` and `where` (the text's description, as in an error message), also with offsets into `source`: no caller needs to tokenize again and add offsets.
- `{ kind: 'argument-error', message, length, macro, label }`: macro arguments that don't have their parameters' forms.

`macros` are those the markup may use (`builtinMacros` and your own, as for `validateStoryMarkup`): their declared parameters tell which arguments are code. In a quoted string with escapes (`"say \"hi\" {$x + }"`), the text is the unescaped value, so a character is not at `offset + index`: such a piece has `sourceOffsets`, and `pieceOffset(piece, index)` gives where character `index` of its `code` or `text` is in `source` (it is `offset + index` when there is no `sourceOffsets`). A nested piece's `length` and `sourceOffsets` count the source's characters.

## Stateless checks and the built-in macros

`validateMarkup(passages, options)` and `collectPassageReferences(source)` read the process-global registry, which only `defineMacro` can add to. A host that analyses several projects in one process (a language server with workspace folders) would leak macros between them. For that, use the functions that take the macros and keep no state:

- `validateStoryMarkup(passages, macros, options?)` is `validateMarkup` against `macros`.
- `collectStoryPassageReferences(source, macros)` is `collectPassageReferences` against `macros`.
- `passagePieces(source, macros?)` as above.
- `builtinMacros` is the list of built-in macros (a frozen array of the metadata `getMacroRegistry()` starts with), loaded without `fs`: a bundler (esbuild, rollup) inlines it. A macro is `{ name, block, subMacros, parameters?, interpolate? }` (`ToolingMacro`); the metadata `getMacroRegistry()` returns has all of it.

```js
import { builtinMacros, validateStoryMarkup } from '@rohal12/spindle/tooling';

const mine = { name: 'alert', block: true, subMacros: [] };
validateStoryMarkup(passages, [...builtinMacros, mine]);
validateStoryMarkup(otherProjectsPassages, builtinMacros); // no `alert` here
```

## Widget definitions

`widgetDefinitions(passages, macros?)` lists the widgets a story defines as the runtime registers them: those of `StoryInit` and of the passages tagged `widget`, in source order. Each is a `WidgetDefinition`:

- `name`, `params` (the `@` parameters, as `{widget "Name" @a @b}` declares them) and `block`: whether its body renders `{@children}`. It is decided on tokens, so a `{@children}` in an HTML comment or a `{do}` body does not count, while one in an attribute value or a label does. In nested definitions it belongs to the innermost.
- `passage`, and as `[start, end)` UTF-16 offsets into its content: the opening `{widget …}` tag (`start`, `end`), the name as written without quotes (`nameStart`, `nameEnd`) and the `{/widget}` closer (`closeStart`, absent while the definition is not closed).

It is tolerant: a half-typed definition is reported without `closeStart`, one whose arguments cannot be read is left out. `macros` is the list `validateStoryMarkup` takes, for the parameters that hold markup. `parseWidgetDef(rawArgs)` reads the arguments alone (`{ name, params }`). The runtime's startup, `validateStoryMarkup` and these exports read definitions with the same code.

```js
import { widgetDefinitions, builtinMacros } from '@rohal12/spindle/tooling';

const [def] = widgetDefinitions(
  [
    {
      name: 'W',
      tags: ['widget'],
      content: '{widget "Box" @tone}<b>{@children}</b>{/widget}',
    },
  ],
  builtinMacros,
);
// { name: 'Box', params: ['@tone'], block: true, passage: 'W', start: 0, … }
```

## Variable references

`variableReferences(source, macros?)` returns every `$` and `%` variable reference a passage's markup evaluates, in source order, as `{ sigil, name, path, start, end }`: `$a.b.c` is `name: 'a'`, `path: ['b', 'c']`, and `[start, end)` are UTF-16 offsets into `source`. They are found where the story start looks for them: `{$var}` displays, expressions, conditions, `{do}` bodies and the code arguments of macros (by their declared parameters, so `{set}` targets count), the quoted names input macros bind (`{textbox "$name"}`; pass the macros with `storeVar`), and the markup in labels, selectors and HTML attributes. Strings, comments, property names and prose hold none; `_` and `@` locals are never variables. The path is the dotted part only: `$a?.b` and `$a["b"]` give `$a`. The target of `{unset}` is not a reference, as the story start does not check it. Malformed tags are skipped.

`validateVariableReferences(passages, declarations, macros?)` checks them, as the story start does, and returns `VariableDiagnostic`s: `{ passage, code, name, path?, start, end, message }`, with offsets into the passage's content and the story start's `message`.

- `declarations` is `{ variables, transients? }`, maps from name to schema: from `parseDeclarations`, `new Map(declarations.map((d) => [d.name, d.schema]))`. A variable with no `schema` (a non-static initializer) is declared and its fields are not checked. `transients` is checked only when given.
- `undeclared-variable` and `undeclared-transient`: the variable is not declared. `primitive-field`: a field a number, string or boolean has no member of (`$hp.nope`; `$hp.toFixed` and `$name.length` are fine). `reserved-name`: `$__proto__`.
- Not errors, as at story start: an unknown field of an object (a registered class can add members), any field of an array or of a `null` default.
- Passages tagged `script` or `stylesheet`, and the declaration passages, are skipped.

```js
import {
  builtinMacros,
  parseDeclarations,
  validateVariableReferences,
} from '@rohal12/spindle/tooling';

const { declarations } = parseDeclarations('$hp = 10\n');
const variables = new Map(declarations.map((d) => [d.name, d.schema]));
validateVariableReferences(
  [{ name: 'Start', content: 'HP {$hp} of {$maxHp}' }],
  { variables },
  builtinMacros,
);
// [{ passage: 'Start', code: 'undeclared-variable', name: 'maxHp', start: 13, end: 19, message: 'Undeclared variable: $maxHp' }]
```

## Diagnostics

A `MarkupDiagnostic` from `validateMarkup` and `validateStoryMarkup` has, besides `passage`, `line`, `column`, `message` and the `file` and `fileLine` of its passage:

- `code`, the kind of error. It stays the same where the wording of `message` changes, and is covered by semver with the `data` it carries, so editors map codes to severities and quick-fixes without parsing messages.
- `start` and `end`, UTF-16 offsets into `passage.content`: the offending text. `line` and `column` are those of `start`.
- `data`, what the diagnostic names.

| `code`                                                                                               | What                                                                                                          | `data`                                                                                          |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `unclosed-link`, `unclosed-expression`, `unclosed-macro`, `unclosed-tag`, `unclosed-attribute`       | `[[` with no `]]`; `{$…` with no `}`; `{name…` with no `}`; `<div` with no `>`; a value with no closing quote | none                                                                                            |
| `invalid-closer`, `closer-with-selectors`, `closer-with-arguments`, `unexpected-character`, `syntax` | `{/` and no name; a closer with selectors or with arguments; a character a tag can't have; any other          | none                                                                                            |
| `unclosed-block`                                                                                     | `{if}` with no `{/if}`; `<div>` with no `</div>`                                                              | `name`                                                                                          |
| `mismatched-closer`                                                                                  | `{/if}` where `{/for}` should close the `{for}`                                                               | `name` (the opener), `closer`                                                                   |
| `stray-closer`                                                                                       | a closer with nothing to close                                                                                | `name`                                                                                          |
| `misplaced-branch`                                                                                   | `{else}` outside `{if}`                                                                                       | `name`, `parent`, `inside` (for a branch inside another element)                                |
| `unknown-macro`                                                                                      | a macro that is not defined                                                                                   | `name`, `suggestions` (the closest known macro, if one is close)                                |
| `argument-error`                                                                                     | arguments that don't have their parameters' forms                                                             | `macro`                                                                                         |
| `code-syntax`                                                                                        | a syntax error in code                                                                                        | `macro` for a macro argument                                                                    |
| `unknown-passage`                                                                                    | a passage name that names no passage                                                                          | `name`, `macro` (`link` for `[[…]]`), `suggestions` (the closest passage name, if one is close) |
| `unquoted-passage-name`                                                                              | `{goto Kitchen}`                                                                                              | `name`, `macro`                                                                                 |

`message` and `formatDiagnostic` are unchanged. The codes of malformed markup are also on the `MarkupError`s of the tolerant functions, with the same `data`.

## Declarations

`parseDeclarations(content, sigil?)` reads a `StoryVariables` (or, with `'%'`, `StoryTransients`) passage without evaluating the initializers and without throwing: `{ declarations, errors }`. `parseStoryVariables` reads with the same grammar, and then evaluates.

- A `Declaration` is `{ name, nameStart, nameEnd, valueStart, valueEnd, schema? }`: the name (without the sigil) and the initializer expression (without the space around it) as `[start, end)` UTF-16 offsets into `content`. One bad line doesn't hide the rest.
- `schema` (`{ type, fields? }`) is there when the initializer is static: a `number` (also signed, hex, `NaN`, `Infinity`), `string` (also a template without `${}`), `boolean` or `null` literal, an array literal (`{ type: 'array' }`, as `parseStoryVariables` makes it), or an object literal, whose `fields` are its members with an identifier, string or number key and a static value (a spread, a computed key, a shorthand member or a member that is not static is left out). Anything else (`Math.PI`, `new Date()`, `1 + 2`, a reference) has no `schema`, and is no error: its value is only known by running it.
- An error is `{ code, offset, end, message }`: `invalid-declaration` (a line that is not `$name = value`), `invalid-name` (a name no variable can have), `duplicate-declaration` (both declarations are returned; the later wins when evaluated) and `unsupported-value` (an initializer that is a literal no variable can hold: a function, `undefined`, a BigInt).

```js
import { parseDeclarations } from '@rohal12/spindle/tooling';

const { declarations, errors } = parseDeclarations('$hp = 100\n$f = () => 1\n');
// declarations: hp (schema: number), f (no schema)
// errors: one `unsupported-value`, at `() => 1`
```

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
