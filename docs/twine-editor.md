# Twine Editor Extensions

Spindle works in Twine 2 as it is: add the format, pick it for a story, and publish. Twine 2.4 and later also let a story format extend the passage editor, and Spindle's `format.js` carries three such extensions:

- **Syntax highlighting** for Spindle markup in the passage text.
- **References**: dotted lines on the story map for passages named in macros.
- **A toolbar** above the passage text with snippet menus, **Check** and **Format**.

They apply to Twine 2.4 and later (web and desktop) once Spindle is added as a story format, and only to stories that use Spindle. Nothing here changes what a compiled story contains: the extensions live in the format's `format.js`, which Twine reads, and not in the `source` it puts into the published HTML.

## Highlighting

Passage text is highlighted as you type, with the colors of Twine's current theme:

| Markup                                    | Looks like                |
| ----------------------------------------- | ------------------------- |
| Macro names, `{/name}` and the braces     | keywords                  |
| `$story` and `%` variables                | variables                 |
| `_temp` and `@local` variables            | a second variable color   |
| Strings, numbers, `true`, `false`, `null` | strings, numbers, atoms   |
| `[[links]]` and their targets             | links                     |
| `.class#id` selectors                     | attributes                |
| HTML tags, attribute names and values     | tags, attributes, strings |
| HTML comments                             | comments                  |
| Malformed or unclosed markup (`{if $x`)   | error                     |

Plain prose and Markdown are left as they are. A macro whose arguments run over several lines, a `{do}` body and a comment are highlighted across their lines. The highlighter reads the passage with the tokenizer Spindle itself uses (see the [Tooling API](tooling.md)), so what it marks as an error is something the story would reject (a subset: a typo in a macro name, for instance, is not an error here, since the macro may be defined elsewhere in the story).

A construct left open for more than 200 lines (a `{if $x` at the top of a very long passage) is shown as unclosed until the line that closes it, so that a long passage stays quick to edit.

## References

Twine draws a line on the story map for each `[[link]]`. Spindle adds dotted lines for the passages its macros name:

- `{goto "B"}` and `{include "B"}`
- `{link "text" "B"}`
- the passage in a `{dialog "label"}B{/dialog}` body
- `{watch … goto "B"}` and `{watch … dialog "B"}`

`[[links]]` are not repeated (Twine draws those itself), and neither are targets that are expressions (`{goto $next}`): only names written in the passage are known.

## Toolbar

```
[Links ▾] [Logic ▾] [Variables ▾] [Inputs ▾] [UI ▾] [Check] [Format]
```

The five menus insert markup. With text selected, a block macro wraps the selection as its body (`{if }`, the selection, `{/if}`) and the cursor lands where you type next; with nothing selected, the template is inserted with the cursor in its first slot. A macro that has no body (`{goto}`, `{set}`, `{meter}`) is inserted before the selected text instead of wrapping it. Each insert is one undo step. **Check** and **Format** are disabled while the passage is empty.

| Menu      | Items                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| Links     | `[[…]]`, `{link}`, `{goto}`, `{include}`, `{back}`                                                          |
| Logic     | `{if}`, `{if}{else}`, `{for}`, `{switch}`, `{do}`, `{watch}`                                                |
| Variables | `{set}`, `{unset}`, `{print}`, `{$x}`, `{computed}`                                                         |
| Inputs    | `{textbox}`, `{numberbox}`, `{textarea}`, `{checkbox}`, `{radiobutton}`, `{listbox}`, `{cycle}`, `{button}` |
| UI        | `{dialog}`, `{repeat}`, `{timed}`, `{meter}`, `{nobr}`, `{widget}`                                          |

The templates follow the [macro reference](macros.md); every one passes the story-start validator.

### Check

**Check** looks for problems in the passage you are editing. Each problem is underlined in red; hover it to read the message. A summary (the count and the first messages, with line numbers) is shown in an alert, or "No problems found". The underlines are cleared when you edit the passage.

Check reads one passage, so it reports malformed, unclosed and mismatched tags, argument errors and JavaScript syntax errors in expressions. It does not report what needs the rest of the story: passage names that do not exist, undeclared story variables, and unknown macros. A macro or widget you define in another passage looks the same as a typo from here, so `{mycustom 1}` is not reported, and a `{/mycustom}` closer is taken to close it. The story still reports all of these when it starts.

### Format

**Format** formats the passage: bodies of block macros are indented, trailing whitespace is removed (Markdown hard breaks, and the indentation of lists and code fences, are kept), the text ends with one newline, and embedded `<script>`, `<style>` and HTML are formatted with a copy of [Prettier](https://prettier.io/) bundled in the format. A region Prettier would break (for example one with a macro in the middle of a JavaScript expression) is left as you wrote it, as is everything the runtime executes (macros, links, `{do}` bodies). The result replaces the passage as one undo step and the cursor stays on its line. If you keep typing while it runs, your text wins and nothing is replaced.

The same formatter is available to your own tools as `formatPassage` ([Tooling API](tooling.md#formatting-a-passage)).

## Limits

Twine hands an extension one passage at a time, so:

- Highlighting and references cannot see the rest of the story. Macros and widgets you define yourself are highlighted as macros of unknown name, and their passage parameters draw no lines.
- Check does not report what needs the whole story: passage names, undeclared story variables and unknown macros (it cannot tell a typo from a macro defined elsewhere).
- Twine's Story JavaScript and Story Stylesheet dialogs use Twine's own modes; the extensions do not touch them.

## Turning them off

No extension is required to use Spindle. To turn them off, open **Twine → Story Formats** and clear **Use Editor Extensions** on Spindle's card. The passage editor goes back to Twine's plain text, without the toolbar, highlighting or reference lines, and everything else works as before. The setting is per story format, so other formats keep theirs.

## Size

The extensions add about 1.1 MB to `format.js`, most of it Prettier. That is what Twine loads when it reads the format; compiled stories are not larger, and `dist/story.html` is unchanged.
