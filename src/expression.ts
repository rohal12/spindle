import type { StoryState } from './store';
import { useStoryStore } from './store';
import type { Passage } from './parser';
import { random, randomInt } from './prng';

interface ExpressionFns {
  currentPassage: () => Passage | undefined;
  previousPassage: () => Passage | undefined;
  visited: (name?: string) => number;
  hasVisited: (name?: string) => boolean;
  hasVisitedAny: (...names: string[]) => boolean;
  hasVisitedAll: (...names: string[]) => boolean;
  rendered: (name?: string) => number;
  hasRendered: (name?: string) => boolean;
  hasRenderedAny: (...names: string[]) => boolean;
  hasRenderedAll: (...names: string[]) => boolean;
  random: () => number;
  randomInt: (min: number, max: number) => number;
}

type CompiledExpression = (
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown>,
  __fns: ExpressionFns,
  transient: Record<string, unknown>,
) => unknown;

const FN_CACHE_MAX = 500;
const fnCache = new Map<string, CompiledExpression>();

/**
 * Transform expression: $var → variables["var"], _var → temporary["var"],
 * @var → locals["var"], %var → transient["var"].
 * Only transforms when sigils appear as a word boundary, and only in code:
 * string, template and regex literal text and comments are left untouched.
 * `%var` is handled by `scan` itself, because `%` is also the modulo operator
 * and only an operand position makes it a sigil.
 */
const VAR_RE = /\$(\w+)/g;
const TEMP_RE = /(?<![.\w])_(\w+)/g;
const LOCAL_RE = /@(\w+)/g;
/** Transient name after `%`: an identifier, so `%3` is never a reference. */
const TRANS_NAME_RE = /[A-Za-z_]\w*/y;
/**
 * The rest of an assignment target and its operator after a transient name:
 * ` = 1`, `.a.b += 2`, but not `== 1` or `=> 1`.
 */
const ASSIGNMENT_RE =
  /(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])?=(?![=>])/y;
/** Flags after the closing `/` of a regex literal. */
const REGEX_FLAGS_RE = /\w*/y;
/** Characters of identifiers, numbers and sigil variable references. */
const WORD_CHAR_RE = /[\w$@]/;
const SPACE_RE = /\s/;
/** Keywords followed by an operand rather than an operator. */
const OPERAND_KEYWORDS = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);
/** Keywords whose parenthesised header is followed by a statement. */
const HEADER_KEYWORDS = new Set(['for', 'if', 'while', 'with']);

function transformSegment(segment: string): string {
  return segment
    .replace(VAR_RE, 'variables["$1"]')
    .replace(TEMP_RE, 'temporary["$1"]')
    .replace(LOCAL_RE, 'locals["$1"]');
}

/** Index just past the string literal opening at `start`. */
function skipString(src: string, start: number): number {
  const quote = src.charAt(start);
  let i = start + 1;
  while (i < src.length) {
    const c = src.charAt(i);
    if (c === '\\') i += 2;
    else if (c === quote) return i + 1;
    else i++;
  }
  return src.length;
}

/** Index just past the regex literal (with flags) opening at `start`. */
function skipRegex(src: string, start: number): number {
  let inClass = false; // inside `[…]`, where `/` does not close
  let i = start + 1;
  while (i < src.length) {
    const c = src.charAt(i);
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '\n') return i; // unterminated: leave the rest to the parser
    if (inClass) {
      if (c === ']') inClass = false;
    } else if (c === '[') {
      inClass = true;
    } else if (c === '/') {
      REGEX_FLAGS_RE.lastIndex = i + 1;
      return i + 1 + (REGEX_FLAGS_RE.exec(src)?.[0].length ?? 0);
    }
    i++;
  }
  return src.length;
}

/** Index just past the comment opening at `start` (`//` or `/*`). */
function skipComment(src: string, start: number): number {
  if (src.charAt(start + 1) === '/') {
    const end = src.indexOf('\n', start);
    return end < 0 ? src.length : end;
  }
  const end = src.indexOf('*/', start + 2);
  return end < 0 ? src.length : end + 2;
}

/**
 * Lexical scanner behind `transform`. Walks the source once, passing string,
 * template and regex literal text and comments through untouched, and
 * transforming the code between them — including the code of template-literal
 * `${…}` interpolations, which is scanned recursively.
 *
 * It also tracks whether the next token is an operand or an operator, which
 * decides two ambiguities: `/` opens a regex in operand position and divides
 * otherwise, and `%name` is a transient reference in operand position while
 * `%` after an operand — `($n)%3`, `$a[i] %2`, `_i++ %n` — is the modulo
 * operator.
 *
 * Scanning starts at `start`; inside an interpolation it stops at the `}`
 * that closes it and returns that index as `end`.
 */
function scan(
  src: string,
  start: number,
  interpolation: boolean,
): { out: string; end: number } {
  let result = '';
  let code = ''; // accumulates code characters to be transformed
  let i = start;

  let operandNext = true; // an operand (not an operator) comes next
  let word = ''; // identifier/number currently being read
  let afterDot = false; // `word` is a property name, never a keyword
  let afterHeaderKeyword = false; // last token was if/while/for/with
  let lastPunct = '';
  let lineBreak = false; // a line break since the last token
  let braceDepth = 0;
  const parenIsHeader: boolean[] = []; // per open `(`: closes a header?

  function flushCode() {
    if (code) {
      result += transformSegment(code);
      code = '';
    }
  }

  /** Emit literal text or a comment verbatim. */
  function emit(text: string) {
    flushCode();
    result += text;
  }

  function endWord() {
    if (!word) return;
    operandNext = !afterDot && OPERAND_KEYWORDS.has(word);
    afterHeaderKeyword = !afterDot && HEADER_KEYWORDS.has(word);
    afterDot = false;
    lastPunct = '';
    lineBreak = false;
    word = '';
  }

  /** A string, template or regex literal, or a transient reference, ended. */
  function endOperand() {
    endWord();
    operandNext = false;
    afterHeaderKeyword = false;
    afterDot = false;
    lastPunct = '';
    lineBreak = false;
  }

  /** Track an operator token: `operandNext` tells what may follow it. */
  function endPunct(punct: string, nextIsOperand: boolean) {
    operandNext = nextIsOperand;
    afterDot = punct === '.';
    afterHeaderKeyword = false;
    lastPunct = punct;
    lineBreak = false;
  }

  function trackCode(c: string) {
    if (WORD_CHAR_RE.test(c)) {
      word += c;
      return;
    }
    endWord();
    // A line break alone never changes operand/operator position:
    // `$x = 5\n%n` continues the expression, as in JavaScript.
    if (c === '\n') lineBreak = true;
    if (SPACE_RE.test(c)) return;
    if (c === '(') parenIsHeader.push(afterHeaderKeyword);
    if (c === '{') braceDepth++;
    if (c === '}') braceDepth--;
    if (c === ')') {
      // `if (…) %x = 1` vs `($n)%3`
      endPunct(c, parenIsHeader.pop() ?? false);
    } else if (c === '.') {
      // Property access, unless it is the spread `...`
      endPunct(c, lastPunct === '.');
    } else {
      // `]` ends an operand; `}` closes a block, so a statement may follow.
      endPunct(c, c !== ']');
    }
  }

  /** Template literal at `i`: literal parts verbatim, interpolations scanned. */
  function scanTemplate() {
    flushCode();
    result += '`';
    i++;
    while (i < src.length) {
      const c = src.charAt(i);
      if (c === '\\') {
        result += src.slice(i, i + 2);
        i += 2;
      } else if (c === '`') {
        result += c;
        i++;
        break;
      } else if (c === '$' && src.charAt(i + 1) === '{') {
        const inner = scan(src, i + 2, true);
        result += '${' + inner.out;
        i = inner.end;
        if (i < src.length) {
          result += '}';
          i++;
        }
      } else {
        result += c;
        i++;
      }
    }
    endOperand();
  }

  while (i < src.length) {
    const ch = src.charAt(i);

    // String literal — skip entirely
    if (ch === '"' || ch === "'") {
      const end = skipString(src, i);
      emit(src.slice(i, end));
      i = end;
      endOperand();
      continue;
    }

    if (ch === '`') {
      scanTemplate();
      continue;
    }

    if (ch === '/') {
      endWord();
      const next = src.charAt(i + 1);
      // Comment — skip entirely; it is not a token
      if (next === '/' || next === '*') {
        const end = skipComment(src, i);
        const comment = src.slice(i, end);
        emit(comment);
        if (comment.includes('\n')) lineBreak = true;
        i = end;
        continue;
      }
      // Regex literal — only where an operand is expected
      if (operandNext) {
        const end = skipRegex(src, i);
        emit(src.slice(i, end));
        i = end;
        endOperand();
        continue;
      }
    }

    // Transient reference — where an operand is expected, or as the target
    // of an assignment starting a line: `$x = 5\n%a = 1` would otherwise be
    // the invalid assignment `5 % a = 1`.
    if (ch === '%') {
      endWord();
      TRANS_NAME_RE.lastIndex = i + 1;
      const name = TRANS_NAME_RE.exec(src)?.[0];
      if (name) {
        ASSIGNMENT_RE.lastIndex = i + 1 + name.length;
        if (operandNext || (lineBreak && ASSIGNMENT_RE.test(src))) {
          flushCode();
          result += `transient["${name}"]`;
          i += 1 + name.length;
          endOperand();
          continue;
        }
      }
    }

    // Increment/decrement: postfix after an operand on the same line (no line
    // break may precede postfix `++`), prefix otherwise.
    if ((ch === '+' || ch === '-') && src.charAt(i + 1) === ch) {
      endWord();
      const postfix = !operandNext && !lineBreak;
      code += ch + ch;
      i += 2;
      endPunct(ch, !postfix);
      continue;
    }

    // End of a template interpolation
    if (ch === '}' && interpolation && braceDepth === 0) break;

    // Regular code character
    trackCode(ch);
    code += ch;
    i++;
  }
  flushCode();
  return { out: result, end: i };
}

function transform(expr: string): string {
  return scan(expr, 0, false).out;
}

const preamble =
  'const {currentPassage,previousPassage,visited,hasVisited,hasVisitedAny,hasVisitedAll,rendered,hasRendered,hasRenderedAny,hasRenderedAll,random,randomInt}=__fns;';

function getOrCompile(key: string, body: string): CompiledExpression {
  const cached = fnCache.get(key);
  if (cached) {
    // Move to end for LRU ordering (Map preserves insertion order)
    fnCache.delete(key);
    fnCache.set(key, cached);
    return cached;
  }
  const fn = new Function(
    'variables',
    'temporary',
    'locals',
    '__fns',
    'transient',
    preamble + body,
  ) as CompiledExpression;
  fnCache.set(key, fn);
  if (fnCache.size > FN_CACHE_MAX) {
    // Evict oldest entry
    const oldest = fnCache.keys().next().value;
    if (oldest !== undefined) fnCache.delete(oldest);
  }
  return fn;
}

let cachedFns: ExpressionFns | null = null;
let cachedVisitCounts: Record<string, number> | null = null;
let cachedRenderCounts: Record<string, number> | null = null;

export function buildExpressionFns() {
  const state = useStoryStore.getState();
  const { visitCounts, renderCounts } = state;

  if (
    cachedFns &&
    cachedVisitCounts === visitCounts &&
    cachedRenderCounts === renderCounts
  ) {
    return cachedFns;
  }

  const visited = (name?: string): number =>
    visitCounts[name ?? useStoryStore.getState().currentPassage] ?? 0;
  const hasVisited = (name?: string): boolean => visited(name) > 0;
  const hasVisitedAny = (...names: string[]): boolean =>
    names.some((n) => visited(n) > 0);
  const hasVisitedAll = (...names: string[]): boolean =>
    names.every((n) => visited(n) > 0);

  const rendered = (name?: string): number =>
    renderCounts[name ?? useStoryStore.getState().currentPassage] ?? 0;
  const hasRendered = (name?: string): boolean => rendered(name) > 0;
  const hasRenderedAny = (...names: string[]): boolean =>
    names.some((n) => rendered(n) > 0);
  const hasRenderedAll = (...names: string[]): boolean =>
    names.every((n) => rendered(n) > 0);

  const currentPassage = (): Passage | undefined => {
    const s = useStoryStore.getState();
    return s.storyData?.passages.get(s.currentPassage);
  };
  const previousPassage = (): Passage | undefined => {
    const s = useStoryStore.getState();
    if (s.historyIndex <= 0) return undefined;
    const prevName = s.history[s.historyIndex - 1]?.passage;
    return prevName ? s.storyData?.passages.get(prevName) : undefined;
  };

  cachedFns = {
    currentPassage,
    previousPassage,
    visited,
    hasVisited,
    hasVisitedAny,
    hasVisitedAll,
    rendered,
    hasRendered,
    hasRenderedAny,
    hasRenderedAll,
    random,
    randomInt,
  };
  cachedVisitCounts = visitCounts;
  cachedRenderCounts = renderCounts;

  return cachedFns;
}

/**
 * Evaluate an expression and return its value.
 * e.g. evaluate("$health + 10", variables, temporary) → number
 */
export function evaluate(
  expr: string,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown> = {},
  transient: Record<string, unknown> = {},
): unknown {
  const transformed = transform(expr);
  // The line break keeps a trailing `// comment` from swallowing the `)`.
  const body = `return (${transformed}\n);`;
  const fn = getOrCompile(body, body);
  return fn(variables, temporary, locals, buildExpressionFns(), transient);
}

/**
 * Execute statements (no return value).
 * e.g. execute("$health = 100; $name = 'Hero'", variables, temporary)
 */
export function execute(
  code: string,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown> = {},
  transient: Record<string, unknown> = {},
): void {
  const transformed = transform(code);
  const fn = getOrCompile('exec:' + transformed, transformed);
  fn(variables, temporary, locals, buildExpressionFns(), transient);
}

/**
 * Convenience: evaluate using store state directly.
 */
/** Clear the compiled expression cache. Useful for testing and HMR. */
export function clearExpressionCache(): void {
  fnCache.clear();
  cachedFns = null;
  cachedVisitCounts = null;
  cachedRenderCounts = null;
}

export function evaluateWithState(expr: string, state: StoryState): unknown {
  return evaluate(expr, state.variables, state.temporary, {}, state.transient);
}
