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

Inline a variable's value using `{$name}` or `{_name}`:

```
Your health is {$health}.
Temporary result: {_result}.
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

{.danger button $health = 0}Die{/button}
```

Multiple classes are space-joined: `{.red.bold print $x}` produces `class="red bold"`.

## HTML Tags

A curated set of HTML tags is supported directly in passage content:

`a`, `article`, `aside`, `b`, `blockquote`, `br`, `caption`, `code`, `col`, `colgroup`, `dd`, `del`, `details`, `dfn`, `div`, `dl`, `dt`, `em`, `figcaption`, `figure`, `footer`, `h1`-`h6`, `header`, `hr`, `i`, `img`, `ins`, `kbd`, `li`, `main`, `mark`, `nav`, `ol`, `p`, `pre`, `q`, `s`, `samp`, `section`, `small`, `span`, `strong`, `sub`, `summary`, `sup`, `table`, `tbody`, `td`, `tfoot`, `th`, `thead`, `tr`, `u`, `ul`, `wbr`

Void tags (`br`, `col`, `hr`, `img`, `wbr`) are self-closing. All other tags require a closing tag.

```
<div class="box">
  <strong>Bold text</strong> and <em>emphasis</em>.
  <br>
  <img src="icon.png">
</div>
```

Tags not in the supported set are treated as plain text.

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

## Line Breaks

End a line with two trailing spaces to insert a `<br>`:

```
Line one
Line two
```

Without trailing spaces, adjacent lines are joined into a single paragraph.
