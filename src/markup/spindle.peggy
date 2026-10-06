// Spindle passage markup, as a Peggy grammar. Imported as a module, it is
// compiled to its parser on load (scripts/peggy.ts); parse.ts wraps it.
//
// Start rules:
//   Markup  the nested AST (ast.ts): macros with their bodies and branches,
//           HTML elements with their children, links, variables, text.
//   Tokens  the flat token stream (tokens.ts Token), without nesting:
//           what the variable checker scans.
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
const BRANCHING = new Set(['if', 'switch', 'timed']);
const LINK_SEPARATORS = [['|', false], ['->', false], ['<-', true]];
const NO_SELECTORS = {};

function parseLink(inner) {
  for (const [separator, targetFirst] of LINK_SEPARATORS) {
    const idx = inner.indexOf(separator);
    if (idx === -1) continue;
    const before = inner.slice(0, idx).trim();
    const after = inner.slice(idx + separator.length).trim();
    return targetFirst ? { display: after, target: before } : { display: before, target: after };
  }
  const trimmed = inner.trim();
  return { display: trimmed, target: trimmed };
}

function quoteArg(value) {
  return '"' + value.replace(/[\\"]/g, '\\$&') + '"';
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
function closerOf(tag) {
  return tag.lex === 'html' ? '</' + tag.tag + '>' : LB + '/' + tag.name + RB;
}
function at(loc) {
  return 'line ' + loc.start.line + ', column ' + loc.start.column;
}
function sameName(open, close) {
  return open.lex === close.lex && open.lower === close.lower;
}

/** A lexeme: what one token of the flat stream holds, with its span. */
function lexeme(lex, loc, fields) {
  fields.lex = lex;
  fields.start = loc.start.offset;
  fields.end = loc.end.offset;
  fields.loc = loc;
  return fields;
}

/** The AST node of a lexeme that stands alone (not a macro or element). */
function nodeOf(x) {
  switch (x.lex) {
    case 'text':
      return { type: 'text', value: x.value };
    case 'link':
      return withSelectors({ type: 'macro', name: 'link', rawArgs: quoteArg(x.display) + ' ' + quoteArg(x.target), children: [] }, x);
    case 'variable':
      return withSelectors({ type: 'variable', name: x.name, scope: x.scope }, x);
    case 'expression':
      return withSelectors({ type: 'expression', expression: x.expression }, x);
    default:
      return x; // already a node
  }
}

/** The token of a lexeme (tokens.ts Token). */
function tokenOf(x) {
  const span = { start: x.start, end: x.end };
  switch (x.lex) {
    case 'text':
      return { type: 'text', value: x.value, ...span };
    case 'link':
      return withSelectors({ type: 'link', display: x.display, target: x.target, ...span }, x);
    case 'variable':
      return withSelectors({ type: 'variable', name: x.name, scope: x.scope, ...span }, x);
    case 'expression':
      return withSelectors({ type: 'expression', expression: x.expression, ...span }, x);
    case 'macro':
      return withSelectors({ type: 'macro', name: x.name, rawArgs: x.rawArgs, isClose: x.isClose, ...span }, x);
    case 'html':
      return { type: 'html', tag: x.tag, attributes: x.attributes, isClose: x.isClose, isSelfClose: x.isSelfClose, ...span };
  }
}

/**
 * Flatten items (lexemes, nodes, arrays of them, nulls) and join adjacent
 * text, except escaped braces, which stay a text item of their own.
 */
function joinText(items, convert) {
  const out = [];
  let last = null;
  const add = (item) => {
    if (item === null || item === undefined) return;
    if (Array.isArray(item)) return item.forEach(add);
    if (item.lex === 'text' && !item.escape && last && last.lex === 'text' && !last.escape && last.end === item.start) {
      last.value += item.value;
      last.end = item.end;
      return;
    }
    out.push(item);
    last = item;
  };
  add(items);
  return convert ? out.map(convert) : out;
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

function skipTo(end) {
  skipEnd = end;
  return end >= 0;
}
function fail(message, loc) {
  error(message, loc);
}
function attrs(list) {
  const attributes = {};
  const seen = new Set();
  for (const [name, value] of list) {
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    Object.defineProperty(attributes, name, { value, enumerable: true, writable: true, configurable: true });
  }
  return attributes;
}

/** Check the body of a macro or element against its opening tag. */
function checkBody(open, body) {
  for (const branch of body.branches) {
    const parent = BRANCH_PARENT[branch.tag.lower];
    if (open.lex !== 'macro' || open.lower !== parent) {
      fail(label(branch.tag) + ' must be directly inside ' + LB + parent + RB + ', not inside ' + label(open), branch.tag.loc);
    }
  }
  if (!body.end) {
    fail('Unclosed ' + label(open) + ': no ' + closerOf(open) + ' closes it', open.loc);
  }
  if (!sameName(open, body.end)) {
    fail(label(body.end) + ' found where ' + closerOf(open) + ' should close the ' + label(open) + ' opened at ' + at(open.loc), body.end.loc);
  }
}

function macroNode(tag, body) {
  const node = { type: 'macro', name: tag.lower, rawArgs: tag.rawArgs, children: [] };
  if (!body) return withSelectors(node, tag);
  checkBody(tag, body);
  node.children = body.children;
  if (BRANCHING.has(tag.lower)) {
    node.branches = [withSelectors({ rawArgs: tag.rawArgs, children: body.children }, tag)];
    for (const b of body.branches) {
      node.branches.push(withSelectors({ rawArgs: b.tag.rawArgs, children: b.children }, b.tag));
    }
    node.children = [];
  } else {
    withSelectors(node, tag);
  }
  return node;
}
}

// ---------------------------------------------------------------- structure

Markup
  = nodes:Content Tail { return nodes; }

/** What ends the top level: the end, or a closer or branch with no opener. */
Tail
  = !.
  / tag:BranchTag { fail(label(tag) + ' must be directly inside ' + LB + BRANCH_PARENT[tag.lower] + RB, tag.loc); }
  / tag:CloseTag { fail(label(tag) + ' closes nothing: no ' + (tag.lex === 'html' ? '<' + tag.tag + '>' : LB + tag.name + RB) + ' is open here', tag.loc); }

Content
  = items:Item* { return joinText(items, nodeOf); }

Item
  = TextRun
  / Escape
  / LinkLexeme
  / HtmlElement
  / VoidCloser
  / Value
  / MacroElement
  / Literal

MacroElement
  = tag:MacroTag &{ return tag.kind === 'open'; }
    body:( &{ rawName = tag.lower; return hooks.isRaw(rawName); } b:RawBody { return b; }
         / &{ return hooks.isBlock(tag.lower); } b:BlockBody { return b; }
         / "" { return null; } )
    { return macroNode(tag, body); }

HtmlElement
  = &{ return !textMode; } open:HtmlOpen
    body:( &{ return !open.isSelfClose; } b:BlockBody { return b; } )?
    {
      const node = { type: 'html', tag: open.tag, attributes: open.attributes, children: [] };
      if (body) {
        checkBody(open, body);
        node.children = body.children;
      }
      return node;
    }

BlockBody
  = children:Content branches:BranchPart* end:BlockEnd { return { children, branches, end }; }

BranchPart
  = tag:BranchTag children:Content { return { tag, children }; }

BlockEnd
  = CloseTag
  / !. { return null; }

BranchTag
  = tag:MacroTag &{ return tag.kind === 'branch'; } { return tag; }

CloseTag
  = tag:MacroTag &{ return tag.kind === 'close'; } { return tag; }
  / &{ return !textMode; } tag:HtmlClose { return tag; }

/** A raw body ({do}): JavaScript up to its closer, kept as one text node. */
RawBody
  = start:Here &{ return skipTo(hooks.rawBodyEnd(input, start, rawName)); }
    body:$(.|{ return skipEnd - offset(); }|) end:CloseTag
    { return { children: body ? [{ type: 'text', value: body }] : [], branches: [], end }; }
  / "" { return { children: [], branches: [], end: null }; }

// ------------------------------------------------------------- flat tokens

Tokens
  = items:TokenItem* { return joinText(items, tokenOf); }

TokenItem
  = TextRun
  / Escape
  / LinkLexeme
  / &{ return !textMode; } tag:HtmlOpen { return tag; }
  / &{ return !textMode; } tag:HtmlClose { return VOID_TAGS.has(tag.lower) ? null : tag; }
  / Value
  / tag:MacroTag
    body:( &{ rawName = tag.lower; return tag.kind === 'open' && hooks.isRaw(rawName); } b:RawTokens { return b; } )?
    { return body ? [tag, body] : tag; }
  / Literal

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
  = &{ return !textMode; } "[[" s:Selectors inner:$LinkText "]]" {
      return withSelectors(lexeme('link', location(), parseLink(inner)), s);
    }
  / &{ return !textMode; } "[[" { fail('Unclosed link: [[ without ]]', location()); }

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
  = "{" s:Selectors sigil:[$_@%] name:$[a-zA-Z0-9_.]* "}" {
      return withSelectors(lexeme('variable', location(), { name, scope: SIGIL_SCOPES[sigil] }), s);
    }
  / "{" s:Selectors &[$_@%(!] expression:CodeToBrace "}" {
      return withSelectors(lexeme('expression', location(), { expression }), s);
    }
  / "{" Selectors &[$_@%(!] { fail('Unclosed ' + LB + input.substr(location().end.offset, 1) + '…: no ' + RB + ' ends it', location()); }

/** JavaScript up to the } that ends it: where is up to options.hooks. */
CodeToBrace
  = start:Here &{ return skipTo(hooks.closeBrace(input, start, start)); } code:$(.|{ return skipEnd - offset(); }|) { return code; }

/** A macro tag: `{name args}`, `{/name}`, with selectors on an opener. */
MacroTag
  = "{" s:Selectors start:Here close:"/"? name:MacroName nameEnd:Here
    tail:( &{ return skipTo(hooks.closeBrace(input, nameEnd, start)); } args:$(.|{ return skipEnd - offset(); }|) "}" { return args; } )? {
      const loc = location();
      const lower = name.toLowerCase();
      const tag = lexeme('macro', loc, { name, lower, rawArgs: '', isClose: !!close });
      if (tail === null) fail('Unclosed ' + LB + (close ? '/' : '') + name + '…: no ' + RB + ' ends the macro', loc);
      tag.rawArgs = tail.trim();
      if (close) {
        if (s !== NO_SELECTORS) fail('A closing tag takes no selectors: ' + label(tag), loc);
        if (tag.rawArgs) fail('A closing tag takes no arguments: ' + LB + '/' + name + ' ' + tag.rawArgs + RB, loc);
        tag.kind = 'close';
      } else {
        withSelectors(tag, s);
        tag.kind = Object.prototype.hasOwnProperty.call(BRANCH_PARENT, lower) ? 'branch' : 'open';
      }
      return tag;
    }
  / "{" s:Selectors "/" { fail('A closing tag starts with a letter after ' + LB + '/', location()); }

/** A macro name: a letter, then anything up to whitespace or }. */
MacroName
  = $([a-zA-Z] [^ \t\n\r\x0B\x0C\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF}]*)

// -------------------------------------------------------------------- HTML

/** A redundant closer of a void element (</br>), which is dropped. */
VoidCloser
  = &{ return !textMode; } tag:HtmlClose &{ return VOID_TAGS.has(tag.lower); } { return null; }

HtmlOpen
  = "<" tag:TagName list:Attribute* _ slash:"/"? ">" {
      const lower = tag.toLowerCase();
      return lexeme('html', location(), { tag, lower, attributes: attrs(list), isClose: false, isSelfClose: !!slash || VOID_TAGS.has(lower) });
    }
  / "<" tag:TagName &(_c / "/" / ">" / !.) Attribute* _ bad:Here {
      // Only the offset of a location is used (parse.ts reads line and
      // column from it).
      const c = input.charAt(bad);
      if (!c) fail('Unclosed tag <' + tag + ': no > ends it (write &lt; for a < that starts no tag)', location());
      const at = { source: location().source, start: { offset: bad, line: 0, column: 0 }, end: { offset: bad + 1, line: 0, column: 0 } };
      fail('Unexpected ' + JSON.stringify(c) + ' in the tag <' + tag + '>: expected an attribute, or > to end the tag', at);
    }

HtmlClose
  = "</" tag:TagName _ ">" {
      return lexeme('html', location(), { tag, lower: tag.toLowerCase(), attributes: {}, isClose: true, isSelfClose: false });
    }

TagName
  = $([a-zA-Z] [a-zA-Z0-9\-]*)

/**
 * An attribute. Its name is as in HTML: anything up to whitespace, a quote,
 * `>`, `/` or `=`; and not `<`, `{` or `}`, which markup can't use there.
 */
Attribute
  = _ name:$(!(_c / ["'>/=<{}]) .)+ &{ attrCode = hooks.isCodeAttribute(name); return true; } value:(_ "=" _ v:AttrValue { return v; })? {
      return [name, value ?? ''];
    }

AttrValue
  = '"' v:$(ValuePart / [^"])* '"' { return v; }
  / "'" v:$(ValuePart / [^'])* "'" { return v; }
  / q:["'] { fail('Unclosed attribute value: the ' + q + ' here has no closing ' + q, location()); }
  / $[^ \t\n\r\x0B\x0C\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF>]*

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
