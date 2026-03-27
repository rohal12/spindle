export interface TextToken {
  type: 'text';
  value: string;
  start: number;
  end: number;
}

export interface LinkToken {
  type: 'link';
  display: string;
  target: string;
  className?: string;
  id?: string;
  start: number;
  end: number;
}

export interface MacroToken {
  type: 'macro';
  name: string;
  rawArgs: string;
  isClose: boolean;
  className?: string;
  id?: string;
  start: number;
  end: number;
}

export interface VariableToken {
  type: 'variable';
  name: string;
  scope: 'variable' | 'temporary' | 'local' | 'transient';
  className?: string;
  id?: string;
  start: number;
  end: number;
}

export interface ExpressionToken {
  type: 'expression';
  expression: string;
  className?: string;
  id?: string;
  start: number;
  end: number;
}

export interface HtmlToken {
  type: 'html';
  tag: string;
  attributes: Record<string, string>;
  isClose: boolean;
  isSelfClose: boolean;
  start: number;
  end: number;
}

export type Token =
  | TextToken
  | LinkToken
  | MacroToken
  | VariableToken
  | ExpressionToken
  | HtmlToken;

/** Tag name must start with a letter (covers standard and custom elements). */
const VALID_TAG_START = /[a-zA-Z]/;

const HTML_VOID_TAGS = new Set(['br', 'col', 'hr', 'img', 'wbr']);

/**
 * Parse a Twine link interior into display and target.
 * Supports: display|target, display->target, target<-display, plain
 */
function parseLink(inner: string): { display: string; target: string } {
  // Pipe syntax: display|target
  const pipeIdx = inner.indexOf('|');
  if (pipeIdx !== -1) {
    return {
      display: inner.slice(0, pipeIdx).trim(),
      target: inner.slice(pipeIdx + 1).trim(),
    };
  }

  // Arrow syntax: display->target
  const arrowIdx = inner.indexOf('->');
  if (arrowIdx !== -1) {
    return {
      display: inner.slice(0, arrowIdx).trim(),
      target: inner.slice(arrowIdx + 2).trim(),
    };
  }

  // Reverse arrow: target<-display
  const revIdx = inner.indexOf('<-');
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
  const isClose = trimmed.startsWith('/');
  const rest = isClose ? trimmed.slice(1) : trimmed;

  const spaceIdx = rest.search(/\s/);
  if (spaceIdx === -1) {
    return { name: rest, rawArgs: '', isClose };
  }

  return {
    name: rest.slice(0, spaceIdx),
    rawArgs: rest.slice(spaceIdx + 1).trim(),
    isClose,
  };
}

/**
 * Parse CSS selectors: .foo.bar#baz → { className: "foo bar", id: "baz" }
 * Scans .[a-zA-Z0-9_-]+ and #[a-zA-Z0-9_-]+ segments in any order.
 * Returns space-joined class string, last id wins, and position after last segment.
 */
function parseSelectors(
  input: string,
  startIdx: number,
): { className: string; id: string; endIdx: number } {
  const classes: string[] = [];
  let id = '';
  let i = startIdx;

  while (i < input.length && (input[i] === '.' || input[i] === '#')) {
    const prefix = input[i]!;
    i++; // skip the . or #
    let name = '';
    while (i < input.length) {
      if (/[a-zA-Z0-9_-]/.test(input[i]!)) {
        name += input[i];
        i++;
      } else if (
        input[i] === '{' &&
        (input[i + 1] === '$' || input[i + 1] === '_' || input[i + 1] === '@')
      ) {
        // Consume interpolation: {$var}, {_var}, {@var} (with optional dot paths)
        const braceStart = i;
        i += 2; // skip { and prefix
        while (i < input.length && /[\w.]/.test(input[i]!)) i++;
        if (i < input.length && input[i] === '}') {
          i++; // skip }
          name += input.slice(braceStart, i);
        } else {
          // Not a valid interpolation — stop
          i = braceStart;
          break;
        }
      } else {
        break;
      }
    }
    if (name) {
      if (prefix === '.') {
        classes.push(name);
      } else {
        id = name;
      }
    }
  }

  return { className: classes.join(' '), id, endIdx: i };
}

/**
 * Parse HTML attributes from a string starting at position j.
 * Returns the attributes and the position after the last attribute.
 */
function parseHtmlAttributes(
  input: string,
  j: number,
): { attributes: Record<string, string>; endIdx: number } {
  const attributes: Record<string, string> = {};

  while (j < input.length) {
    // Skip whitespace
    while (j < input.length && /\s/.test(input[j]!)) j++;
    // End of tag?
    if (
      j >= input.length ||
      input[j] === '>' ||
      (input[j] === '/' && input[j + 1] === '>')
    )
      break;

    // Read attribute name
    const attrStart = j;
    while (j < input.length && /[a-zA-Z0-9_\-:@]/.test(input[j]!)) j++;
    const attrName = input.slice(attrStart, j);
    if (!attrName) break;

    // Check for = value
    if (input[j] === '=') {
      j++; // skip =
      if (input[j] === '"' || input[j] === "'") {
        const quote = input[j]!;
        j++; // skip opening quote
        const valStart = j;
        let braceDepth = 0;
        while (j < input.length) {
          if (input[j] === '{') braceDepth++;
          else if (input[j] === '}') braceDepth--;
          else if (input[j] === quote && braceDepth <= 0) break;
          j++;
        }
        attributes[attrName] = input.slice(valStart, j);
        if (j < input.length) j++; // skip closing quote
      } else {
        // Unquoted value
        const valStart = j;
        while (j < input.length && /[^\s>]/.test(input[j]!)) j++;
        attributes[attrName] = input.slice(valStart, j);
      }
    } else {
      // Boolean attribute
      attributes[attrName] = '';
    }
  }

  return { attributes, endIdx: j };
}

/**
 * Scan for the balanced closing } starting at position i (just past the {).
 * Returns the index of the closing } or -1 if unbalanced.
 */
function scanBalancedBrace(input: string, i: number): number {
  let depth = 1;
  while (i < input.length && depth > 0) {
    if (input[i] === '{') depth++;
    else if (input[i] === '}') depth--;
    if (depth > 0) i++;
  }
  return depth === 0 ? i : -1;
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
        type: 'text',
        value: input.slice(textStart, end),
        start: textStart,
        end,
      });
    }
  }

  while (i < input.length) {
    // Handle escaped braces: \{ and \}
    if (input[i] === '\\' && (input[i + 1] === '{' || input[i + 1] === '}')) {
      flushText(i);
      tokens.push({ type: 'text', value: input[i + 1]!, start: i, end: i + 2 });
      i += 2;
      textStart = i;
      continue;
    }

    // Check for [[ link
    if (input[i] === '[' && input[i + 1] === '[') {
      flushText(i);
      const start = i;
      i += 2;

      // Check for .class or #id syntax after [[
      let className: string | undefined;
      let id: string | undefined;
      if (input[i] === '.' || input[i] === '#') {
        const parsed = parseSelectors(input, i);
        className = parsed.className || undefined;
        id = parsed.id || undefined;
        i = parsed.endIdx;
        // Consume trailing space after selectors
        if (input[i] === ' ') i++;
      }

      // Find closing ]]
      let depth = 1;
      const innerStart = i;
      while (i < input.length && depth > 0) {
        if (input[i] === '[' && input[i + 1] === '[') {
          depth++;
          i += 2;
        } else if (input[i] === ']' && input[i + 1] === ']') {
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
      const linkToken: LinkToken = {
        type: 'link',
        display,
        target,
        start,
        end: i,
      };
      if (className) linkToken.className = className;
      if (id) linkToken.id = id;
      tokens.push(linkToken);
      textStart = i;
      continue;
    }

    // Check for { — macro or variable (with optional .class prefix)
    if (input[i] === '{') {
      const start = i;
      let nextChar = input[i + 1];

      // Check for .class/#id prefix: {.foo#bar $var} or {#id.foo macroName ...}
      let className: string | undefined;
      let id: string | undefined;
      if (nextChar === '.' || nextChar === '#') {
        flushText(i);
        const parsed = parseSelectors(input, i + 1);
        className = parsed.className || undefined;
        id = parsed.id || undefined;
        // After selectors, check what follows (space then $ or _ or letter)
        let afterSelectors = parsed.endIdx;
        if (input[afterSelectors] === ' ') afterSelectors++;
        const charAfter = input[afterSelectors];

        if (charAfter === '$') {
          // {.class#id $variable.field} or {.class $expr[...]}
          i = afterSelectors + 1;
          const nameStart = i;
          while (i < input.length && /[\w.]/.test(input[i]!)) i++;
          const name = input.slice(nameStart, i);

          if (input[i] === '}') {
            i++; // skip }
            const token: VariableToken = {
              type: 'variable',
              name,
              scope: 'variable',
              start,
              end: i,
            };
            if (className) token.className = className;
            if (id) token.id = id;
            tokens.push(token);
            textStart = i;
            continue;
          }
          // Complex expression — scan for balanced closing }
          const closeIdx$ = scanBalancedBrace(input, nameStart);
          if (closeIdx$ !== -1) {
            const expression = input.slice(afterSelectors, closeIdx$);
            i = closeIdx$ + 1;
            const token: ExpressionToken = {
              type: 'expression',
              expression,
              start,
              end: i,
            };
            if (className) token.className = className;
            if (id) token.id = id;
            tokens.push(token);
            textStart = i;
            continue;
          }
          // Unbalanced — treat as text
          i = start + 1;
          textStart = start;
          continue;
        }

        if (charAfter === '_') {
          // {.class#id _temporary.field} or {.class _expr[...]}
          i = afterSelectors + 1;
          const nameStart = i;
          while (i < input.length && /[\w.]/.test(input[i]!)) i++;
          const name = input.slice(nameStart, i);

          if (input[i] === '}') {
            i++; // skip }
            const token: VariableToken = {
              type: 'variable',
              name,
              scope: 'temporary',
              start,
              end: i,
            };
            if (className) token.className = className;
            if (id) token.id = id;
            tokens.push(token);
            textStart = i;
            continue;
          }
          // Complex expression — scan for balanced closing }
          const closeIdx_ = scanBalancedBrace(input, nameStart);
          if (closeIdx_ !== -1) {
            const expression = input.slice(afterSelectors, closeIdx_);
            i = closeIdx_ + 1;
            const token: ExpressionToken = {
              type: 'expression',
              expression,
              start,
              end: i,
            };
            if (className) token.className = className;
            if (id) token.id = id;
            tokens.push(token);
            textStart = i;
            continue;
          }
          // Unbalanced — treat as text
          i = start + 1;
          textStart = start;
          continue;
        }

        if (charAfter === '@') {
          // {.class#id @local.field} or {.class @expr[...]}
          i = afterSelectors + 1;
          const nameStart = i;
          while (i < input.length && /[\w.]/.test(input[i]!)) i++;
          const name = input.slice(nameStart, i);

          if (input[i] === '}') {
            i++; // skip }
            const token: VariableToken = {
              type: 'variable',
              name,
              scope: 'local',
              start,
              end: i,
            };
            if (className) token.className = className;
            if (id) token.id = id;
            tokens.push(token);
            textStart = i;
            continue;
          }
          // Complex expression — scan for balanced closing }
          const closeIdx_at = scanBalancedBrace(input, nameStart);
          if (closeIdx_at !== -1) {
            const expression = input.slice(afterSelectors, closeIdx_at);
            i = closeIdx_at + 1;
            const token: ExpressionToken = {
              type: 'expression',
              expression,
              start,
              end: i,
            };
            if (className) token.className = className;
            if (id) token.id = id;
            tokens.push(token);
            textStart = i;
            continue;
          }
          // Unbalanced — treat as text
          i = start + 1;
          textStart = start;
          continue;
        }

        if (charAfter === '%') {
          // {.class#id %transient.field} or {.class %expr[...]}
          i = afterSelectors + 1;
          const nameStart = i;
          while (i < input.length && /[\w.]/.test(input[i]!)) i++;
          const name = input.slice(nameStart, i);

          if (input[i] === '}') {
            i++; // skip }
            const token: VariableToken = {
              type: 'variable',
              name,
              scope: 'transient',
              start,
              end: i,
            };
            if (className) token.className = className;
            if (id) token.id = id;
            tokens.push(token);
            textStart = i;
            continue;
          }
          // Complex expression — scan for balanced closing }
          const closeIdx_pct = scanBalancedBrace(input, nameStart);
          if (closeIdx_pct !== -1) {
            const expression = input.slice(afterSelectors, closeIdx_pct);
            i = closeIdx_pct + 1;
            const token: ExpressionToken = {
              type: 'expression',
              expression,
              start,
              end: i,
            };
            if (className) token.className = className;
            if (id) token.id = id;
            tokens.push(token);
            textStart = i;
            continue;
          }
          // Unbalanced — treat as text
          i = start + 1;
          textStart = start;
          continue;
        }

        if (charAfter !== undefined && /[a-zA-Z]/.test(charAfter)) {
          // {.class#id macroName args}
          i = afterSelectors;

          // Scan to closing }, tracking brace nesting
          let depth = 1;
          const contentStart = i;
          while (i < input.length && depth > 0) {
            if (input[i] === '{') depth++;
            else if (input[i] === '}') depth--;
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
            type: 'macro',
            name,
            rawArgs,
            isClose,
            start,
            end: i,
          };
          if (className) token.className = className;
          if (id) token.id = id;
          tokens.push(token);
          textStart = i;
          continue;
        }

        // Selector prefix after { but nothing valid follows — treat as text
        i = start + 1;
        textStart = start;
        continue;
      }

      // {$variable} or {$variable.field.subfield} or {$expr[...]}
      if (nextChar === '$') {
        flushText(i);
        i += 2;
        const nameStart = i;
        while (i < input.length && /[\w.]/.test(input[i]!)) i++;
        const name = input.slice(nameStart, i);

        if (input[i] === '}') {
          i++; // skip }
          tokens.push({
            type: 'variable',
            name,
            scope: 'variable',
            start,
            end: i,
          });
          textStart = i;
          continue;
        }
        // Complex expression — scan for balanced closing }
        const closeIdx = scanBalancedBrace(input, nameStart);
        if (closeIdx !== -1) {
          const expression = input.slice(start + 1, closeIdx);
          i = closeIdx + 1;
          tokens.push({
            type: 'expression',
            expression,
            start,
            end: i,
          });
          textStart = i;
          continue;
        }
        // Unbalanced — treat as text
        i = start + 1;
        textStart = start;
        continue;
      }

      // {_temporary.field} or {_expr[...]}
      if (nextChar === '_') {
        flushText(i);
        i += 2;
        const nameStart = i;
        while (i < input.length && /[\w.]/.test(input[i]!)) i++;
        const name = input.slice(nameStart, i);

        if (input[i] === '}') {
          i++; // skip }
          tokens.push({
            type: 'variable',
            name,
            scope: 'temporary',
            start,
            end: i,
          });
          textStart = i;
          continue;
        }
        // Complex expression — scan for balanced closing }
        const closeIdx = scanBalancedBrace(input, nameStart);
        if (closeIdx !== -1) {
          const expression = input.slice(start + 1, closeIdx);
          i = closeIdx + 1;
          tokens.push({
            type: 'expression',
            expression,
            start,
            end: i,
          });
          textStart = i;
          continue;
        }
        // Unbalanced — treat as text
        i = start + 1;
        textStart = start;
        continue;
      }

      // {@local.field} or {@expr[...]}
      if (nextChar === '@') {
        flushText(i);
        i += 2;
        const nameStart = i;
        while (i < input.length && /[\w.]/.test(input[i]!)) i++;
        const name = input.slice(nameStart, i);

        if (input[i] === '}') {
          i++; // skip }
          tokens.push({
            type: 'variable',
            name,
            scope: 'local',
            start,
            end: i,
          });
          textStart = i;
          continue;
        }
        // Complex expression — scan for balanced closing }
        const closeIdx = scanBalancedBrace(input, nameStart);
        if (closeIdx !== -1) {
          const expression = input.slice(start + 1, closeIdx);
          i = closeIdx + 1;
          tokens.push({
            type: 'expression',
            expression,
            start,
            end: i,
          });
          textStart = i;
          continue;
        }
        // Unbalanced — treat as text
        i = start + 1;
        textStart = start;
        continue;
      }

      // {%transient.field} or {%expr[...]}
      if (nextChar === '%') {
        flushText(i);
        i += 2;
        const nameStart = i;
        while (i < input.length && /[\w.]/.test(input[i]!)) i++;
        const name = input.slice(nameStart, i);

        if (input[i] === '}') {
          i++; // skip }
          tokens.push({
            type: 'variable',
            name,
            scope: 'transient',
            start,
            end: i,
          });
          textStart = i;
          continue;
        }
        // Complex expression — scan for balanced closing }
        const closeIdx = scanBalancedBrace(input, nameStart);
        if (closeIdx !== -1) {
          const expression = input.slice(start + 1, closeIdx);
          i = closeIdx + 1;
          tokens.push({
            type: 'expression',
            expression,
            start,
            end: i,
          });
          textStart = i;
          continue;
        }
        // Unbalanced — treat as text
        i = start + 1;
        textStart = start;
        continue;
      }

      // {macro ...} or {/macro} — but not bare { that's just text
      // Must start with a letter or /
      if (
        nextChar !== undefined &&
        (nextChar === '/' || /[a-zA-Z]/.test(nextChar))
      ) {
        flushText(i);
        i++; // skip {

        // Scan to closing }, tracking brace nesting for object literals
        let depth = 1;
        const contentStart = i;
        while (i < input.length && depth > 0) {
          if (input[i] === '{') depth++;
          else if (input[i] === '}') depth--;
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
          type: 'macro',
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

    // Check for < — HTML tag
    if (input[i] === '<') {
      const start = i;
      let j = i + 1;

      // Closing tag?
      const isClose = input[j] === '/';
      if (isClose) j++;

      // Read tag name (letters, digits, hyphens for custom elements)
      const tagStart = j;
      while (j < input.length && /[a-zA-Z0-9-]/.test(input[j]!)) j++;
      const tag = input.slice(tagStart, j);
      const tagLower = tag.toLowerCase();

      // Valid tag name must start with a letter
      if (tag && VALID_TAG_START.test(tag[0]!)) {
        if (isClose) {
          // Closing tag: skip whitespace, expect >
          while (j < input.length && /\s/.test(input[j]!)) j++;
          if (input[j] === '>') {
            j++;
            flushText(start);
            tokens.push({
              type: 'html',
              tag,
              attributes: {},
              isClose: true,
              isSelfClose: false,
              start,
              end: j,
            });
            textStart = j;
            i = j;
            continue;
          }
        } else {
          // Opening or self-closing tag: parse attributes
          const parsed = parseHtmlAttributes(input, j);
          j = parsed.endIdx;

          let isSelfClose = HTML_VOID_TAGS.has(tagLower);
          if (input[j] === '/') {
            isSelfClose = true;
            j++;
          }

          if (input[j] === '>') {
            j++;
            flushText(start);
            tokens.push({
              type: 'html',
              tag,
              attributes: parsed.attributes,
              isClose: false,
              isSelfClose,
              start,
              end: j,
            });
            textStart = j;
            i = j;
            continue;
          }
        }
      }

      // Not a valid HTML tag — treat as text
      i++;
      continue;
    }

    i++;
  }

  flushText(input.length);
  return tokens;
}
