// Spindle passage markup, as a Peggy grammar. Imported as a module, it is
// compiled to its parser on load (scripts/peggy.ts); parse.ts wraps it.
//
// Start rules:
//   Tokens  the flat token stream (tokens.ts Token), without nesting. The
//           nesting (which closer closes which opener) is pair.ts; the AST
//           is built from the paired tokens (ast.ts).
//   SelectorsPrefix  the selectors that start the input.
//
// options.text selects text mode (HTML attribute values, labels): no links
// or HTML, and a backslash run before a brace is paired up.
//
// options.hooks decides what the grammar leaves to code:
//   closeBrace(input, codeStart, lenientStart)  index of the } ending the
//       JavaScript that starts at codeStart, or -1 (pluggable code end)
//   rawBodyEnd(input, bodyStart, name)  index of the { of the {/name} that
//       ends a raw (JavaScript) body, or -1
//   isBlock(name), isRaw(name)  whether a macro takes a body / a raw body
//   isCodeAttribute(name)  whether an attribute value is code (onclick)
//
// SIGIL_SCOPES and withSelectors come from tokens.ts (see grammar-shared.ts)
// Note: Peggy's code blocks count braces without reading JavaScript strings,
// so the code here writes literal braces as LB and RB.

{{
const LB = String.fromCharCode(123);
const RB = String.fromCharCode(125);
const { SIGIL_SCOPES, withSelectors } = shared;
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const BRANCH_PARENT = { elseif: 'if', else: 'if', case: 'switch', default: 'switch', next: 'timed' };
const LINK_SEPARATORS = [['|', false], ['->', false], ['<-', true]];
const NO_SELECTORS = {};
/**
 * A CommonMark email autolink, `<` an address `>` (without braces, which
 * are markup), as markdown reads one.
 */
const EMAIL_AUTOLINK = /^<[a-zA-Z0-9.!#$%&'*+/=?^_`|~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*>$/;

/**
 * A link's display text and target, from its text `inner` (at `at` in the
 * input), with where the target is written. `indexOf(separator)` finds a
 * separator that is written outside markup (see linkSeparatorIndex).
 */
function parseLink(inner, at, indexOf) {
  /** The trimmed text from `start` to `end` of inner, and where it is. */
  const part = (start, end) => {
    const raw = inner.slice(start, end);
    const value = raw.trim();
    const from = at + start + (value ? raw.indexOf(value) : 0);
    return { value, start: from, end: from + value.length };
  };
  for (const [separator, targetFirst] of LINK_SEPARATORS) {
    const idx = indexOf(separator);
    if (idx === -1) continue;
    const before = part(0, idx);
    const after = part(idx + separator.length, inner.length);
    const [display, target] = targetFirst ? [after, before] : [before, after];
    return { display: display.value, displayStart: display.start, displayEnd: display.end, target: target.value, targetStart: target.start, targetEnd: target.end };
  }
  const whole = part(0, inner.length);
  return { display: whole.value, displayStart: whole.start, displayEnd: whole.end, target: whole.value, targetStart: whole.start, targetEnd: whole.end };
}

function selectorsOf(parts) {
  const classes = [];
  let id = '';
  for (const [prefix, name] of parts) {
    if (!name) continue;
    if (prefix === '.') classes.push(name);
    else id = name;
  }
  return withSelectors({}, { className: classes.join(' '), id });
}

/** How a tag reads in an error message. */
function label(tag) {
  if (tag.lex === 'html') return (tag.isClose ? '</' : '<') + tag.tag + '>';
  return LB + (tag.isClose ? '/' : '') + tag.name + RB;
}
/** A lexeme: what one token of the flat stream holds, with its span. */
function lexeme(lex, loc, fields) {
  fields.lex = lex;
  fields.start = loc.start.offset;
  fields.end = loc.end.offset;
  fields.loc = loc;
  return fields;
}

/** The token of a lexeme (tokens.ts Token). */
function tokenOf(x) {
  const span = { start: x.start, end: x.end };
  switch (x.lex) {
    case 'text':
      return x.comment ? { type: 'text', value: x.value, comment: true, ...span } : { type: 'text', value: x.value, ...span };
    case 'link':
      return withSelectors({ type: 'link', display: x.display, displayStart: x.displayStart, displayEnd: x.displayEnd, target: x.target, targetStart: x.targetStart, targetEnd: x.targetEnd, ...x.selectorSpan, ...span }, x);
    case 'variable':
      return withSelectors({ type: 'variable', name: x.name, nameStart: x.nameStart, nameEnd: x.nameEnd, scope: x.scope, ...x.selectorSpan, ...span }, x);
    case 'expression':
      return withSelectors({ type: 'expression', expression: x.expression, expressionStart: x.expressionStart, expressionEnd: x.expressionEnd, ...x.selectorSpan, ...span }, x);
    case 'macro':
      return withSelectors({ type: 'macro', name: x.name, nameStart: x.nameStart, nameEnd: x.nameEnd, rawArgs: x.rawArgs, argsStart: x.argsStart, argsEnd: x.argsEnd, isClose: x.isClose, ...x.selectorSpan, ...span }, x);
    case 'html':
      return { type: 'html', tag: x.tag, tagNameStart: x.tagNameStart, tagNameEnd: x.tagNameEnd, attributes: x.attributes, attributeSpans: x.attributeSpans, isClose: x.isClose, isSelfClose: x.isSelfClose, ...span };
  }
}

/**
 * Flatten items (lexemes, nodes, arrays of them, nulls) and join adjacent
 * text, except escaped braces and comments, which stay a text item of their own.
 */
function joinText(items) {
  const out = [];
  let last = null;
  const add = (item) => {
    if (item === null || item === undefined) return;
    if (Array.isArray(item)) return item.forEach(add);
    if (item.lex === 'text' && !item.escape && !item.comment && last && last.lex === 'text' && !last.escape && !last.comment && last.end === item.start) {
      last.value += item.value;
      last.end = item.end;
      return;
    }
    out.push(item);
    last = item;
  };
  add(items);
  return out.map(tokenOf);
}
}}

{
const textMode = options.text === true;
const hooks = options.hooks;
/** End of the stretch a `.|n|` repetition consumes (see skipTo). */
let skipEnd = -1;
/** Whether the attribute whose value is being read holds code. */
let attrCode = false;
/** The macro whose raw body is being read. */
let rawName = '';

/**
 * The index in `inner` (at `at` in the input) of the first `separator` that
 * is not inside a {…} of the label: its code (`{if $a || $b}`, a string with
 * a pipe) belongs to the label, not to the link's syntax.
 */
function linkSeparatorIndex(inner, at, separator) {
  for (let i = 0; i < inner.length; i++) {
    const c = inner.charAt(i);
    if (c === '\\' && /[{}]/.test(inner.charAt(i + 1))) {
      i++;
    } else if (c === LB) {
      // Selectors, then a macro name or the sigil of a variable or expression
      const head = /^(?:[.#][\w-]*)* ?(\/?[a-zA-Z][\w-]*|(?=[$_@%(!]))/.exec(inner.slice(i + 1));
      if (!head) continue;
      const close = hooks.closeBrace(input, at + i + 1 + head[0].length, at + i + 1);
      // One that does not end inside the label is no markup of it
      if (close !== -1 && close < at + inner.length) i = close - at;
    } else if (inner.startsWith(separator, i)) {
      return i;
    }
  }
  return -1;
}
/**
 * Where the selectors `s` are written, from `start` up to `after`, the end of
 * what Selectors consumed (the one space that may follow them is not part of
 * them): the fields of a token; none without selectors.
 */
function selectorSpan(s, start, after) {
  if (s === NO_SELECTORS) return {};
  return { selectorsStart: start, selectorsEnd: input.charAt(after - 1) === ' ' ? after - 1 : after };
}
function skipTo(end) {
  skipEnd = end;
  return end >= 0;
}
/** Fail with `message` at `loc`; `code` tells the kind of error apart (MarkupError). */
function fail(message, loc, code) {
  try {
    error(message, loc);
  } catch (e) {
    e.code = code;
    throw e;
  }
}
function attrs(list) {
  const attributes = {};
  const seen = new Set();
  for (const { name, value } of list) {
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    Object.defineProperty(attributes, name, { value, enumerable: true, writable: true, configurable: true });
  }
  return attributes;
}
}

// ------------------------------------------------------------- flat tokens

Tokens
  = items:TokenItem* { return joinText(items); }

TokenItem
  = TextRun
  / Escape
  / Comment
  / LinkLexeme
  / EmailAutolink
  / &{ return !textMode; } tag:HtmlOpen { return tag; }
  / &{ return !textMode; } tag:HtmlClose { return VOID_TAGS.has(tag.lower) ? null : tag; }
  / Value
  / tag:MacroTag
    body:( &{ rawName = tag.lower; return tag.kind === 'open' && hooks.isRaw(rawName); } b:RawTokens { return b; } )?
    { return body ? [tag, body] : tag; }
  / Literal

/** The closing tag that ends a raw body. */
CloseTag
  = tag:MacroTag &{ return tag.kind === 'close'; } { return tag; }
  / &{ return !textMode; } tag:HtmlClose { return tag; }

/** A raw body and its closer, as tokens; nothing if it is unclosed. */
RawTokens
  = start:Here &{ return skipTo(hooks.rawBodyEnd(input, start, rawName)); }
    body:$(.|{ return skipEnd - offset(); }|) end:CloseTag
    {
      const loc = { start: { offset: start }, end: { offset: start + body.length } };
      return [body ? lexeme('text', loc, { value: body }) : null, end];
    }

// ----------------------------------------------------------------- lexemes

Here
  = "" { return offset(); }

TextRun
  = value:$[^\\{[<]+ { return lexeme('text', location(), { value }); }

/**
 * A closed HTML comment, opaque: its tags and macros are not markup, and
 * rendering drops it. (An unclosed `<!--` is ordinary text.)
 */
Comment
  = value:$("<!--" (">" / "->" / (!"-->" .)* "-->")) {
      const node = lexeme('text', location(), { value });
      node.comment = true;
      return node;
    }

/**
 * A backslash run. Before a brace, an odd run escapes it; in text mode the
 * run is also paired up (`\\` is one backslash), in passage text markdown
 * does that.
 */
Escape
  = bs:$"\\"+ brace:( &{ return bs.length % 2 === 1; } c:[{}] { return c; } )? {
      const loc = location();
      const next = input.charAt(loc.end.offset);
      if (textMode) {
        if (!brace && next !== LB && next !== RB) return lexeme('text', loc, { value: bs });
        const node = lexeme('text', loc, { value: '\\'.repeat(bs.length >> 1) + (brace || '') });
        node.escape = true;
        return node;
      }
      if (!brace) return lexeme('text', loc, { value: bs });
      const before = lexeme('text', loc, { value: bs.slice(1) });
      before.end = loc.end.offset - 2;
      const escaped = lexeme('text', loc, { value: brace });
      escaped.start = loc.end.offset - 2;
      escaped.escape = true;
      return bs.length > 1 ? [before, escaped] : escaped;
    }

/** A character that starts no markup here. */
Literal
  = "{" !(Selectors [$_@%(!/a-zA-Z]) { return lexeme('text', location(), { value: LB }); }
  / !(&{ return !textMode; } HtmlClose) "<" { return lexeme('text', location(), { value: '<' }); }
  / "[" { return lexeme('text', location(), { value: '[' }); }

LinkLexeme
  = &{ return !textMode; } "[[" ss:Here s:Selectors at:Here inner:$LinkText "]]" {
      const link = lexeme('link', location(), parseLink(inner, at, (separator) => linkSeparatorIndex(inner, at, separator)));
      link.selectorSpan = selectorSpan(s, ss, at);
      return withSelectors(link, s);
    }
  / &{ return !textMode; } "[[" { fail('Unclosed link: [[ without ]]', location(), 'unclosed-link'); }

/**
 * A link's text, up to the first ]]. (Nested [[…]] pairs, as the
 * hand-written tokenizer read them, made unclosed [[s backtrack
 * exponentially; a link's text can't hold [[ now.)
 */
LinkText
  = (!("]]" / "[[") .)*

/** `.class#id` selectors, and the one space after them. */
Selectors
  = parts:SelectorPart+ " "? { return selectorsOf(parts); }
  / "" { return NO_SELECTORS; }

/** The selectors at the start of the input, and where they end. */
SelectorsPrefix
  = s:Selectors end:Here .* { return { ...s, end }; }

SelectorPart
  = prefix:[.#] name:$SelectorChar* { return [prefix, name]; }

SelectorChar
  = [a-zA-Z0-9_\-]
  / "{" [$_@%] [a-zA-Z0-9_.]* "}"

/** A variable `{$a.b}` or expression `{$a + 1}`, `{(…)}`, `{!…}`. */
Value
  = "{" ss:Here s:Selectors sigil:[$_@%] nameStart:Here name:$[a-zA-Z0-9_.]* "}" {
      const variable = lexeme('variable', location(), { name, nameStart, nameEnd: nameStart + name.length, scope: SIGIL_SCOPES[sigil] });
      variable.selectorSpan = selectorSpan(s, ss, nameStart - 1);
      return withSelectors(variable, s);
    }
  / "{" ss:Here s:Selectors after:Here &[$_@%(!] expression:CodeToBrace "}" {
      const node = lexeme('expression', location(), { expression, expressionStart: after, expressionEnd: after + expression.length });
      node.selectorSpan = selectorSpan(s, ss, after);
      return withSelectors(node, s);
    }
  / "{" Selectors &[$_@%(!] { fail('Unclosed ' + LB + input.substr(location().end.offset, 1) + '…: no ' + RB + ' ends it', location(), 'unclosed-expression'); }

/** JavaScript up to the } that ends it: where is up to options.hooks. */
CodeToBrace
  = start:Here &{ return skipTo(hooks.closeBrace(input, start, start)); } code:$(.|{ return skipEnd - offset(); }|) { return code; }

/** A macro tag: `{name args}`, `{/name}`, with selectors on an opener. */
MacroTag
  = "{" ss:Here s:Selectors start:Here close:"/"? name:MacroName nameEnd:Here
    tail:( &{ return skipTo(hooks.closeBrace(input, nameEnd, start)); } args:$(.|{ return skipEnd - offset(); }|) "}" { return args; } )? {
      const loc = location();
      const lower = name.toLowerCase();
      const tag = lexeme('macro', loc, { name, lower, rawArgs: '', isClose: !!close });
      tag.nameStart = nameEnd - name.length;
      tag.nameEnd = nameEnd;
      tag.selectorSpan = selectorSpan(s, ss, start);
      if (tail === null) fail('Unclosed ' + LB + (close ? '/' : '') + name + '…: no ' + RB + ' ends the macro', loc, 'unclosed-macro');
      tag.rawArgs = tail.trim();
      tag.argsStart = tag.rawArgs ? nameEnd + tail.length - tail.trimStart().length : nameEnd;
      tag.argsEnd = tag.argsStart + tag.rawArgs.length;
      if (close) {
        if (s !== NO_SELECTORS) fail('A closing tag takes no selectors: ' + label(tag), loc, 'closer-with-selectors');
        if (tag.rawArgs) fail('A closing tag takes no arguments: ' + LB + '/' + name + ' ' + tag.rawArgs + RB, loc, 'closer-with-arguments');
        tag.kind = 'close';
      } else {
        withSelectors(tag, s);
        tag.kind = Object.prototype.hasOwnProperty.call(BRANCH_PARENT, lower) ? 'branch' : 'open';
      }
      return tag;
    }
  / "{" s:Selectors "/" { fail('A closing tag starts with a letter after ' + LB + '/', location(), 'invalid-closer'); }

/** A macro name: a letter, then anything up to whitespace or }. */
MacroName
  = $([a-zA-Z] [^ \t\n\r\x0B\x0C\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF}]*)

// -------------------------------------------------------------------- HTML

/**
 * An email autolink (`<support@example.com>`), text that markdown makes a
 * link: not an element `<support>` with an attribute `@example.com` (#395).
 */
EmailAutolink
  = value:$("<" [a-zA-Z0-9.!#$%&'*+/=?^_`|~-]+ "@" [a-zA-Z0-9.-]+ ">")
    &{ return EMAIL_AUTOLINK.test(value); }
    { return lexeme('text', location(), { value }); }

HtmlOpen
  = "<" tagStart:Here tag:TagName list:Attribute* _ slash:"/"? ">" {
      const lower = tag.toLowerCase();
      return lexeme('html', location(), { tag, lower, tagNameStart: tagStart, tagNameEnd: tagStart + tag.length, attributes: attrs(list), attributeSpans: list, isClose: false, isSelfClose: !!slash || VOID_TAGS.has(lower) });
    }
  / "<" tag:TagName &(_c / "/" / ">" / !.) Attribute* _ bad:Here {
      // Only the offset of a location is used (parse.ts reads line and
      // column from it).
      const c = input.charAt(bad);
      if (!c) fail('Unclosed tag <' + tag + ': no > ends it (write &lt; for a < that starts no tag)', location(), 'unclosed-tag');
      const at = { source: location().source, start: { offset: bad, line: 0, column: 0 }, end: { offset: bad + 1, line: 0, column: 0 } };
      fail('Unexpected ' + JSON.stringify(c) + ' in the tag <' + tag + '>: expected an attribute, or > to end the tag', at, 'unexpected-character');
    }

HtmlClose
  = "</" tagStart:Here tag:TagName _ ">" {
      return lexeme('html', location(), { tag, lower: tag.toLowerCase(), tagNameStart: tagStart, tagNameEnd: tagStart + tag.length, attributes: {}, attributeSpans: [], isClose: true, isSelfClose: false });
    }

TagName
  = $([a-zA-Z] [a-zA-Z0-9\-]*)

/**
 * An attribute. Its name is as in HTML: anything up to whitespace, a quote,
 * `>`, `/` or `=`; and not `<`, `{` or `}`, which markup can't use there.
 */
Attribute
  = _ nameStart:Here name:$(!(_c / ["'>/=<{}]) .)+ &{ attrCode = hooks.isCodeAttribute(name); return true; } value:(_ "=" _ v:AttrValue { return v; })? {
      const attribute = { name, value: value ? value.value : '', nameStart, nameEnd: nameStart + name.length };
      if (value) {
        attribute.valueStart = value.start;
        attribute.valueEnd = value.end;
        if (value.quote) attribute.quote = value.quote;
      }
      return attribute;
    }

/** An attribute value: its text, where that is written and its quote, if any. */
AttrValue
  = '"' start:Here value:$(ValuePart / [^"])* end:Here '"' { return { value, start, end, quote: '"' }; }
  / "'" start:Here value:$(ValuePart / [^'])* end:Here "'" { return { value, start, end, quote: "'" }; }
  / q:["'] { fail('Unclosed attribute value: the ' + q + ' here has no closing ' + q, location(), 'unclosed-attribute'); }
  / start:Here value:$[^ \t\n\r\x0B\x0C\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF>]* end:Here { return { value, start, end }; }

/** Markup in a quoted value, whose quotes don't end the value. */
ValuePart
  = &{ return !attrCode; } bs:$"\\"+ (&{ return bs.length % 2 === 1; } [{}])?
  / &{ return !attrCode; } "{" Selectors start:Here "/"? MacroName nameEnd:Here
    &{ return skipTo(hooks.closeBrace(input, nameEnd, start)); } $(.|{ return skipEnd - offset(); }|) "}"
  / &{ return !attrCode; } "{" Selectors !("/"? [a-zA-Z]) CodeToBrace "}"
  / &{ return attrCode; } "{" &[$_@%] CodeToBrace "}"

_
  = _c*

_c
  = [ \t\n\r\x0B\x0C\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]
