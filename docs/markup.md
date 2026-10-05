# Markup

Spindle passage content is processed through a single-pass tokenizer that recognizes links, variables, macros, and HTML tags. Text content is then run through CommonMark markdown.

## Links

Navigate to another passage using double-bracket syntax:

```
[[Target]]
[[Display|Target]]
[[Display->Target]]
[[Target<-Display]]
```

All four forms navigate to `Target` when clicked. The first form uses the passage name as the display text.

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

## Macros

Macros use curly braces. Self-closing macros have no closing tag; block macros wrap content:

```
{set $x = 5}

{if $x > 3}
  Big number.
{/if}
```

Close a block macro with `{/macroName}`.

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

A backslash before a link or an HTML tag is shown as it is: `C:\[[Start]]` renders `C:\` followed by the link.

Braces inside quoted strings or template literals in macro arguments, `{…}` expressions and attribute values need no escaping: `{set $x = "}"}` stores `}`.

The same rule escapes braces in [attribute values](#markup-in-attribute-values), where the backslashes before a brace pair up the same way.

## HTML Tags

A curated set of HTML tags is supported directly in passage content:

`a`, `article`, `aside`, `b`, `blockquote`, `br`, `caption`, `code`, `col`, `colgroup`, `dd`, `del`, `details`, `dfn`, `div`, `dl`, `dt`, `em`, `figcaption`, `figure`, `footer`, `h1`-`h6`, `header`, `hr`, `i`, `img`, `ins`, `kbd`, `li`, `main`, `mark`, `nav`, `ol`, `p`, `pre`, `q`, `s`, `samp`, `section`, `small`, `span`, `strong`, `sub`, `summary`, `sup`, `table`, `tbody`, `td`, `tfoot`, `th`, `thead`, `tr`, `u`, `ul`, `wbr`

Void tags (`area`, `base`, `br`, `col`, `embed`, `hr`, `img`, `input`, `link`, `meta`, `param`, `source`, `track`, `wbr`) are self-closing and need no closing tag (a redundant one such as `</input>` is ignored). All other tags require a closing tag.

```
<div class="box">
  <strong>Bold text</strong> and <em>emphasis</em>.
  <br>
  <img src="icon.png">
</div>
```

Tags not in the supported set are treated as plain text.

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

Macros that do something rather than produce text (`{set}`, `{do}`, `{goto}`, `{button}`, `{link}`, input macros, ...) can't be used in an attribute value. They don't run; an error is shown in front of the element instead, as are unknown macros, failing expressions and unclosed macros (an unclosed macro leaves the value as written). A boolean attribute whose markup yields nothing, such as `disabled="{if $locked}disabled{/if}"`, is left out.

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

Variables and expressions work in link text, image alt text and link titles, and update with the variable: `![Portrait of {$name}](portrait.png "{$name}")`. In alt text and titles, macros count as their text, as in [attribute values](#markup-in-attribute-values): `![{if $lit}A lit{else}A dark{/if} room](room.png)`.

## Line Breaks

End a line with two trailing spaces to insert a `<br>`:

```
Line one
Line two
```

Without trailing spaces, adjacent lines are joined into a single paragraph.
