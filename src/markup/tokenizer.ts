export interface TextToken {
  type: "text";
  value: string;
  start: number;
  end: number;
}

export interface LinkToken {
  type: "link";
  display: string;
  target: string;
  className?: string;
  start: number;
  end: number;
}

export interface MacroToken {
  type: "macro";
  name: string;
  rawArgs: string;
  isClose: boolean;
  className?: string;
  start: number;
  end: number;
}

export interface VariableToken {
  type: "variable";
  name: string;
  scope: "variable" | "temporary";
  className?: string;
  start: number;
  end: number;
}

export type Token = TextToken | LinkToken | MacroToken | VariableToken;

/**
 * Parse a Twine link interior into display and target.
 * Supports: display|target, display->target, target<-display, plain
 */
function parseLink(inner: string): { display: string; target: string } {
  // Pipe syntax: display|target
  const pipeIdx = inner.indexOf("|");
  if (pipeIdx !== -1) {
    return {
      display: inner.slice(0, pipeIdx).trim(),
      target: inner.slice(pipeIdx + 1).trim(),
    };
  }

  // Arrow syntax: display->target
  const arrowIdx = inner.indexOf("->");
  if (arrowIdx !== -1) {
    return {
      display: inner.slice(0, arrowIdx).trim(),
      target: inner.slice(arrowIdx + 2).trim(),
    };
  }

  // Reverse arrow: target<-display
  const revIdx = inner.indexOf("<-");
  if (revIdx !== -1) {
    return {
      target: inner.slice(0, revIdx).trim(),
      display: inner.slice(revIdx + 2).trim(),
    };
  }

  // Plain: [[passage]]
  const trimmed = inner.trim();
  return { display: trimmed, target: trimmed };
}

/**
 * Parse a macro opening: extract name and rawArgs.
 * e.g. "set $x = 5" → { name: "set", rawArgs: "$x = 5" }
 * e.g. "/if" → { name: "if", rawArgs: "", isClose: true }
 * e.g. "elseif $x > 3" → { name: "elseif", rawArgs: "$x > 3" }
 */
function parseMacroContent(content: string): {
  name: string;
  rawArgs: string;
  isClose: boolean;
} {
  const trimmed = content.trim();
  const isClose = trimmed.startsWith("/");
  const rest = isClose ? trimmed.slice(1) : trimmed;

  const spaceIdx = rest.search(/\s/);
  if (spaceIdx === -1) {
    return { name: rest, rawArgs: "", isClose };
  }

  return {
    name: rest.slice(0, spaceIdx),
    rawArgs: rest.slice(spaceIdx + 1).trim(),
    isClose,
  };
}

/**
 * Parse dot-prefixed CSS class names: .foo.bar → "foo bar"
 * Starts at a '.' char, scans .[a-zA-Z0-9_-]+ segments.
 * Returns space-joined class string and position after last class.
 */
function parseClasses(
  input: string,
  startIdx: number
): { className: string; endIdx: number } {
  const classes: string[] = [];
  let i = startIdx;

  while (i < input.length && input[i] === ".") {
    i++; // skip the dot
    const nameStart = i;
    while (i < input.length && /[a-zA-Z0-9_-]/.test(input[i])) i++;
    if (i > nameStart) {
      classes.push(input.slice(nameStart, i));
    }
  }

  return { className: classes.join(" "), endIdx: i };
}

/**
 * Single-pass tokenizer for Twine passage content.
 * Recognizes: [[links]], {$variable}, {_temporary}, {macroName args}
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let textStart = 0;

  function flushText(end: number) {
    if (end > textStart) {
      tokens.push({
        type: "text",
        value: input.slice(textStart, end),
        start: textStart,
        end,
      });
    }
  }

  while (i < input.length) {
    // Check for [[ link
    if (input[i] === "[" && input[i + 1] === "[") {
      flushText(i);
      const start = i;
      i += 2;

      // Check for .class syntax after [[
      let className: string | undefined;
      if (input[i] === ".") {
        const parsed = parseClasses(input, i);
        className = parsed.className || undefined;
        i = parsed.endIdx;
        // Consume trailing space after classes
        if (input[i] === " ") i++;
      }

      // Find closing ]]
      let depth = 1;
      const innerStart = i;
      while (i < input.length && depth > 0) {
        if (input[i] === "[" && input[i + 1] === "[") {
          depth++;
          i += 2;
        } else if (input[i] === "]" && input[i + 1] === "]") {
          depth--;
          if (depth === 0) break;
          i += 2;
        } else {
          i++;
        }
      }

      if (depth !== 0) {
        // Unclosed link — treat as text
        i = start + 2;
        textStart = start;
        continue;
      }

      const inner = input.slice(innerStart, i);
      i += 2; // skip ]]

      const { display, target } = parseLink(inner);
      const linkToken: LinkToken = { type: "link", display, target, start, end: i };
      if (className) linkToken.className = className;
      tokens.push(linkToken);
      textStart = i;
      continue;
    }

    // Check for { — macro or variable (with optional .class prefix)
    if (input[i] === "{") {
      const start = i;
      let nextChar = input[i + 1];

      // Check for .class prefix: {.foo.bar $var} or {.foo.bar macroName ...}
      let className: string | undefined;
      if (nextChar === ".") {
        flushText(i);
        const parsed = parseClasses(input, i + 1);
        className = parsed.className || undefined;
        // After classes, check what follows (space then $ or _ or letter)
        let afterClasses = parsed.endIdx;
        if (input[afterClasses] === " ") afterClasses++;
        const charAfter = input[afterClasses];

        if (charAfter === "$") {
          // {.class $variable}
          i = afterClasses + 1;
          const nameStart = i;
          while (i < input.length && /\w/.test(input[i])) i++;
          const name = input.slice(nameStart, i);

          if (input[i] === "}") {
            i++; // skip }
            const token: VariableToken = {
              type: "variable",
              name,
              scope: "variable",
              start,
              end: i,
            };
            if (className) token.className = className;
            tokens.push(token);
            textStart = i;
            continue;
          }
          // Not valid — treat as text
          i = start + 1;
          textStart = start;
          continue;
        }

        if (charAfter === "_") {
          // {.class _temporary}
          i = afterClasses + 1;
          const nameStart = i;
          while (i < input.length && /\w/.test(input[i])) i++;
          const name = input.slice(nameStart, i);

          if (input[i] === "}") {
            i++; // skip }
            const token: VariableToken = {
              type: "variable",
              name,
              scope: "temporary",
              start,
              end: i,
            };
            if (className) token.className = className;
            tokens.push(token);
            textStart = i;
            continue;
          }
          // Not valid — treat as text
          i = start + 1;
          textStart = start;
          continue;
        }

        if (charAfter !== undefined && /[a-zA-Z]/.test(charAfter)) {
          // {.class macroName args}
          i = afterClasses;

          // Scan to closing }, tracking brace nesting
          let depth = 1;
          const contentStart = i;
          while (i < input.length && depth > 0) {
            if (input[i] === "{") depth++;
            else if (input[i] === "}") depth--;
            if (depth > 0) i++;
          }

          if (depth !== 0) {
            i = start + 1;
            textStart = start;
            continue;
          }

          const content = input.slice(contentStart, i);
          i++; // skip closing }

          const { name, rawArgs, isClose } = parseMacroContent(content);
          const token: MacroToken = {
            type: "macro",
            name,
            rawArgs,
            isClose,
            start,
            end: i,
          };
          if (className) token.className = className;
          tokens.push(token);
          textStart = i;
          continue;
        }

        // Dot after { but nothing valid follows — treat as text
        i = start + 1;
        textStart = start;
        continue;
      }

      // {$variable}
      if (nextChar === "$") {
        flushText(i);
        i += 2;
        const nameStart = i;
        while (i < input.length && /\w/.test(input[i])) i++;
        const name = input.slice(nameStart, i);

        if (input[i] === "}") {
          i++; // skip }
          tokens.push({
            type: "variable",
            name,
            scope: "variable",
            start,
            end: i,
          });
          textStart = i;
          continue;
        }
        // Not a valid variable token — treat as text
        i = start + 1;
        textStart = start;
        continue;
      }

      // {_temporary}
      if (nextChar === "_") {
        flushText(i);
        i += 2;
        const nameStart = i;
        while (i < input.length && /\w/.test(input[i])) i++;
        const name = input.slice(nameStart, i);

        if (input[i] === "}") {
          i++; // skip }
          tokens.push({
            type: "variable",
            name,
            scope: "temporary",
            start,
            end: i,
          });
          textStart = i;
          continue;
        }
        // Not a valid temporary token — treat as text
        i = start + 1;
        textStart = start;
        continue;
      }

      // {macro ...} or {/macro} — but not bare { that's just text
      // Must start with a letter or /
      if (
        nextChar !== undefined &&
        (nextChar === "/" || /[a-zA-Z]/.test(nextChar))
      ) {
        flushText(i);
        i++; // skip {

        // Scan to closing }, tracking brace nesting for object literals
        let depth = 1;
        const contentStart = i;
        while (i < input.length && depth > 0) {
          if (input[i] === "{") depth++;
          else if (input[i] === "}") depth--;
          if (depth > 0) i++;
        }

        if (depth !== 0) {
          // Unclosed macro — treat as text
          i = start + 1;
          textStart = start;
          continue;
        }

        const content = input.slice(contentStart, i);
        i++; // skip closing }

        const { name, rawArgs, isClose } = parseMacroContent(content);
        tokens.push({
          type: "macro",
          name,
          rawArgs,
          isClose,
          start,
          end: i,
        });
        textStart = i;
        continue;
      }

      // Just a bare { — treat as regular text
      i++;
      continue;
    }

    i++;
  }

  flushText(input.length);
  return tokens;
}
