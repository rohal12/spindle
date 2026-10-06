# Markup

Spindle parses passage content into links, variables, macros and HTML tags, and runs the text around them through CommonMark markdown.

Every passage is checked when the story starts, including passages the player never sees. Malformed markup and unknown macros stop the story there, with a list of what is wrong and where. See [Markup errors](#markup-errors).

## Links

Navigate to another passage using double-bracket syntax:

```
[[Target]]
[[Display|Target]]
[[Display->Target]]
[[Target<-Display]]
```

All four forms navigate to `Target` when clicked. The first form uses the passage name as the display text.

A link ends at the first `]]`, so its text can't contain `[[`. A `[[` without a `]]` after it is an error.

### Links with CSS classes

```
[[.highlight Go north|North]]
[[#main-link.fancy Target]]
```

## Variable Display

Inline a variable's value using `{$name}`, `{_name}`, or `{%name}`:

```
Your health is {$health}.
Temporary result: {_result}.
NPC count: {%npcList.length}.
```

Dot notation accesses nested fields:

```
{$character.name} has {$character.strength} strength.
{$inventory.0}
```

### Variable display with CSS

```
{.bold $health}
{#score.large $points}
```

### Expressions

A block that starts with a variable can hold a whole JavaScript expression, whose result is displayed:

```
{$gold * 2} coins
{$health > 50 ? "strong" : "weak"}
```

An expression that doesn't start with a variable starts with `(` or `!`:

```
{!$door.open ? "The door is closed." : ""}
{(Math.max($gold, 0))}
{("Hello, " + $name)}
```

Any other `{` followed by something that isn't a variable, a macro name or `.`/`#` selectors is literal text: `{3}`, `{ x }` and `{"a": 1}` show as written. `{print …}` displays any expression too.

A `{` followed by a sigil (`$`, `_`, `@`, `%`), `(`, `!`, a letter or `/`, after any selectors, starts markup, which must end with its `}`. Without one it is an error. To show such a brace as text, [escape it](#escaped-braces): `\{`.

## Macros

Macros use curly braces. Self-closing macros have no closing tag; block macros wrap content:

```
{set $x = 5}

{if $x > 3}
  Big number.
{/if}
```

Close a block macro with `{/macroName}`. A closing tag takes no arguments or selectors. Branches such as `{else}` and `{case}` go directly inside their own macro, not inside an HTML element or another macro within it.

Spindle knows which macros take a body from the built-in macros, the custom macros defined before the story starts (see [Custom Macros](custom-macros.md#block-macros-children)) and the widgets whose body uses `{@children}`. A closing tag for any other macro is an error.

### Macros with CSS selectors

Prefix `.class` or `#id` selectors inside the opening brace:

```
{.red if $health < 20}
  Danger!
{/if}

{.large#title print $name}

{.danger button "Die"}{set $health = 0}{/button}
```

Multiple classes are space-joined: `{.red.bold print $x}` produces `class="red bold"`.

Selectors can include variable interpolations for dynamic class names and IDs:

```
{set $theme = "dark"}
{.{$theme} if $health > 0}
  Content styled with the current theme class.
{/if}

{.status-{$level} print $message}
```

## Escaped Braces

Since `{` and `}` are used for macros and variable display, use a backslash to display literal braces:

```
The set macro syntax is \{set $x = 5\}.
Object notation: \{ key: "value" \}
```

This renders as: `The set macro syntax is {set $x = 5}.`

Backslashes before a brace pair up as in markdown, where `\\` displays one backslash. An odd number of backslashes escapes the brace. An even number doesn't, so the brace starts a variable or macro as usual:

| You write     | Renders as                            |
| ------------- | ------------------------------------- |
| `\{$dir}`     | `{$dir}`                              |
| `C:\\{$dir}`  | `C:\` followed by the value of `$dir` |
| `C:\\\{$dir}` | `C:\{$dir}`                           |

A backslash before a link or an HTML tag is shown as it is: `C:\[[Start]]` renders `C:\` followed by the link. To show `<` before a letter, write `&lt;` (see [HTML Tags](#html-tags)).

Backslashes escape braces the same way in [attribute values](#markup-in-attribute-values).

Macro arguments, `{…}` expressions and the expressions in attribute values are read as JavaScript, so braces, quotes and backticks inside strings, template literals, regex literals and comments need no escaping. Only a `}` in the code itself, outside any brackets the code opened, ends the macro:

```
{set $x = "}"}
{if /}/.test($s)}has a brace{/if}
{set $y = 1 /* } */}
{print $s.replace(/["']/g, "")}
{$a /2/ $b}
```

The last line divides: `/` after a value is division, not the start of a regex. A `//` comment runs to the end of the line, so the `}` closing its macro goes on the next line.

Arguments that are not valid JavaScript, such as `{goto Bob's room}`, are read as before: an apostrophe after a letter is text, and a quote that is not closed on the same line is a plain character.

## HTML Tags

HTML tags work directly in passage content. A tag is `<` followed by a name (a letter, then letters, digits or `-`), its attributes and `>`. Any name makes an element, custom elements included: an unknown or misspelt one such as `<sapn>` renders as an element the browser doesn't know, not as text.

Void tags (`area`, `base`, `br`, `col`, `embed`, `hr`, `img`, `input`, `link`, `meta`, `param`, `source`, `track`, `wbr`) are self-closing and need no closing tag (a redundant one such as `</input>` is ignored). A tag ending in `/>` closes itself too. All other tags require a closing tag, and elements must nest: `<b><i>x</b></i>` is an error.

```
<div class="box">
  <strong>Bold text</strong> and <em>emphasis</em>.
  <br>
  <img src="icon.png">
</div>
```

Attribute names are as in HTML: any characters except whitespace, quotes, `>`, `/` and `=`, and in Spindle also `<`, `{` and `}`. So `a.b`, `x:y` and `@click` are names. A value is quoted with `"` or `'`, or unquoted up to whitespace or `>`. A quoted value must be closed.

`<` directly before a letter always starts a tag, which must end with its `>`. Write `&lt;` for a `<` that starts no tag: `x&lt;y` shows `x<y`. Prose such as `if x<y and y>z` is read as a tag `<y and y>`, and `a<b` (no `>`) is an error. A `<` before anything else, as in `3 < 4` or `<3`, is text.

### Markup in attribute values

HTML attribute values take the same `{…}` markup as passage text: variables, expressions, and macros that produce text. The value updates when the variables it uses change. Event handlers, `pattern` and `srcdoc` are the exception: they hold code, see [Attributes holding code](#attributes-holding-code).

```
{set $color = "red"}
<div class="{$color}">This div has the "red" class.</div>
<span data-name="{$character.name}">Named span</span>
<span class="{$hp > 0 ? 'alive' : 'dead'}">Status</span>
<span class="{!$door.open ? 'closed' : 'open'}">Door</span>
<div class="card {if $selected}active{/if}">Card</div>
<span class="mood {switch $mood}{case "happy"}smile{default}flat{/switch}">:)</span>
<span title="{for @item of $bag}{@item} {/for}">Bag</span>
```

These macros have a text form and work in attribute values: `{if}`/`{elseif}`/`{else}`, `{switch}`/`{case}`/`{default}`, `{for}` (with its `@locals`), `{print}`, `{nobr}`, `{span}` and `{story-title}`, plus widgets, which stand for the text of their body (`{@children}` included). Custom macros take part when they define a [text form](custom-macros.md#text-form-macros-in-attribute-values). Attributes inside a `{for}` loop or a widget body see its `@locals`.

The value is plain text: no markdown, links or HTML tags, and line breaks are kept. Character references (`&amp;`, `&#123;`) in the attribute's own text are decoded, as in HTML; in a variable's value they are not, and a decoded `{` never starts markup.

Macros that do something rather than produce text (`{set}`, `{do}`, `{goto}`, `{button}`, `{link}`, input macros, ...) can't be used in an attribute value. They don't run; an error is shown in front of the element instead, as it is for expressions that fail. Unknown macros and malformed markup in an attribute value (an unclosed macro or expression, say) stop the story when it starts, like those in passage text. A boolean attribute whose markup yields nothing, such as `disabled="{if $locked}disabled{/if}"`, is left out.

For literal braces in an attribute value, escape them as in passage text: `title="\{$x}"` shows `{$x}`. A backslash run before a brace pairs up (`\\` shows one backslash); other backslashes are kept as written. Braces that start no markup, such as JSON in `data-config='{"a": 1}'`, need no escaping.

#### Attributes holding code

Event handler attributes (`onclick`, `onmouseover`, any name starting with `on`, in any case), `pattern` (a regular expression) and `srcdoc` (an HTML document, with its own scripts and styles) hold code whose braces are its own. Their values are not read as markup: only variable references are resolved, `{$var}`, `{_var}`, `{@var}`, `{%var}` and expressions starting with one (`{$count + 1}`). Every other brace, and every backslash, is kept as written, and no macro runs there:

```
<button onclick="if (ready) {start('{$level}')}">Go</button>
<input pattern="\p{L}{2,{$maxLength}}">
```

A failing reference shows an error in front of the element and leaves its part of the value empty. `style` is not among them: an inline style holds only declarations, without braces, so it takes markup like other attributes (`style="color: {if $hurt}red{else}inherit{/if}"`).

Button and dialog labels (`{button "Count: {$count}"}`) and selector-based classes and ids (`{.item-{$type} print $name}`) are resolved the same way; errors there are logged to the browser console. A selector can only hold variable references, since a selector is part of the macro's own `{…}`.

The content of `<pre>`, `<textarea>` and `<svg>` is not processed as markdown: indentation and characters such as `#`, `*` and `-` are kept as written. Variables and macros still work inside them.

```
<pre>
Inventory:
    {$gold} gold
    * {$item}
</pre>
```

## Markdown

All passage text is processed through CommonMark with GFM extensions for tables and strikethrough.

### Headings

```
# Heading 1
## Heading 2
### Heading 3
```

### Emphasis

```
*italic* or _italic_
**bold** or __bold__
~~strikethrough~~
```

### Lists

```
- Item one
- Item two
- Item three

1. First
2. Second
3. Third
```

### Tables (GFM)

```
| Name   | Value |
|--------|-------|
| Health | {$health} |
| Mana   | {$mana}   |
```

Variables and macros work inside table cells.

### Code

````
Inline `code` and fenced blocks:

```
code block
```
````

### Links and images

Standard markdown links and images work alongside Twine link syntax:

```
[External link](https://example.com)
![Alt text](image.png)
```

Variables and expressions work in link text, image alt text and link titles, and update with the variable: `![Portrait of {$name}](portrait.png "{$name}")`. In alt text and titles, macros count as their text, as in [attribute values](#markup-in-attribute-values): `![{if $lit}A lit{else}A dark{/if} room](room.png)`. A macro without a text form has nothing to put there, and that includes Twine links: `[[…]]`, `{link}`, `{button}` or an input macro in alt text or a title doesn't run, and an error is shown in front of the image or link instead. Markdown links and images inside an image's alt text count as their text; their own titles are not shown, as in CommonMark.

## Line Breaks

End a line with two trailing spaces to insert a `<br>`:

```
Line one
Line two
```

Without trailing spaces, adjacent lines are joined into a single paragraph.

## Markup errors

Spindle checks the markup of every passage when the story starts, before it shows anything: `StoryInit` before it runs, and every other passage after `StoryInit` has run, so the macros it defines are known. If any passage has an error, the story doesn't start. The page lists every error instead, with its passage, line and column:

```
Passage "Shop", line 2, column 1 (story.twee:14): Unknown macro {sett}. Did you mean {set}?
Passage "Hall", line 5, column 37: {/if} found where {/for} should close the {for} opened at line 5, column 10
```

Lines and columns count from 1 within the passage's text. The `(file:line)` part appears when the story was compiled with source information (for example by twee-ts with `sourceInfo`), and gives the line in the source file. Each passage reports its first malformed markup; fix it and the next one, if any, shows.

These are errors:

| Mistake                                                      | Example                            |
| ------------------------------------------------------------ | ---------------------------------- |
| A block macro without its closing tag                        | `{if $x}yes`                       |
| A closing tag for another macro or element                   | `{if $x}{for @i of $l}{/if}{/for}` |
| A closing tag with nothing to close                          | `text{/if}`                        |
| A branch outside its macro                                   | `{for @i of $l}{else}{/for}`       |
| A closing tag with arguments or selectors                    | `{/if $x}`, `{.c /if}`             |
| An unknown macro                                             | `{sett $x = 1}`                    |
| A macro, variable or expression without its `}`              | `{print $name`, `{$hp`, `{(1 + 2`  |
| A link without its `]]`                                      | `[[North`                          |
| An HTML element without its closing tag, or misnested        | `<div>text`, `<b><i>x</b></i>`     |
| A tag without its `>`, or with something no attribute can be | `<span class="x" {$hp}</span>`     |
| An attribute value without its closing quote                 | `<img src="a.png alt="map">`       |
| Any of these inside an attribute value or a quoted label     | `<b title="{if $x}hi">`            |
| Code that is not valid JavaScript                            | `{print $a +}`, `{do}if (x {{/do}` |

Errors in code name what is wrong and the open bracket that is likely missing its closer: see [Code in passages](variables.md#code-in-passages).

Text that only looks like markup is not an error: `{3}`, `{ x }`, `{"a": 1}`, `3 < 4` and a lone `]]` or `}` show as written. To show the rest as text, escape it: `\{` for a brace (see [Escaped Braces](#escaped-braces)) and `&lt;` for a `<` before a letter.

Input built only to break parsing, such as hundreds of unclosed `{` or `[[` in a row, may make the check slow. Escape such text or leave it out.

Errors that depend on the story's state, such as an expression that throws, still show where they happen while the story runs.
