/**
 * The shape of a JavaScript literal, read from its text without running it:
 * what a StoryVariables initializer is when it is a literal, or an array or
 * object literal of literals (see parseDeclarations in story-variables.ts).
 *
 * The reader is deliberately small. Anything it does not recognise (a call,
 * an operator, a reference, a spread) is "not static", which is no error: the
 * value is simply not known without running the code.
 */
import { scanStringLiteral, stringLiteralValue } from './js-lexer';

/** The type of a variable by its default (see story-variables.ts VarType). */
type LiteralType =
  'number' | 'string' | 'boolean' | 'array' | 'object' | 'null';

/** The shape of a literal (see story-variables.ts FieldSchema). */
export interface LiteralShape {
  type: LiteralType;
  /** The members an object literal gives statically, by key. */
  fields?: Map<string, LiteralShape>;
}

/** A value no variable can hold: its `typeof`, and `String(value)`. */
export interface UnsupportedLiteral {
  unsupported: 'function' | 'undefined' | 'bigint';
  value: string;
}

/** What a literal reads as. */
export type StaticLiteral =
  /** A value of this shape. */
  | { shape: LiteralShape }
  /** A value no variable can hold. */
  | UnsupportedLiteral
  /** Evaluating it throws an error with this message. */
  | { throws: string }
  /** Not known without running it. */
  | undefined;

/**
 * The members an object literal gives: shapes, values no variable can hold,
 * or `null` for a value that is not known (it still has its place in the
 * order of the members).
 */
type Members = Map<string, LiteralShape | UnsupportedLiteral | null>;

const NUMBER_RE =
  /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)(n?)/y;
const IDENT_RE = /[A-Za-z_$][\w$]*/y;
const KEY_RE = /[\w$]+/y;
const ARROW_RE =
  /(?:async\s+)?(?:\((?:[^()]|\([^()]*\))*\)|[A-Za-z_$][\w$]*)\s*=>/y;
const ARRAY_INDEX_RE = /^(?:0|[1-9]\d{0,8})$/;

const UNSUPPORTED_UNDEFINED: UnsupportedLiteral = {
  unsupported: 'undefined',
  value: 'undefined',
};

/** Read `src`, one literal and nothing else. */
export function staticLiteral(src: string): StaticLiteral {
  const reader = new Reader(src);
  const value = reader.value();
  reader.space();
  return reader.i === src.length ? value : undefined;
}

/**
 * The keys of an object in the order `Object.entries` lists them (array
 * indices first, ascending, then the others as they were added): the order
 * the runtime meets the members in.
 */
function entryOrder(keys: Iterable<string>): string[] {
  const all = [...keys];
  const indices = all
    .filter((key) => ARRAY_INDEX_RE.test(key))
    .sort((a, b) => Number(a) - Number(b));
  return [...indices, ...all.filter((key) => !ARRAY_INDEX_RE.test(key))];
}

/** `String(value)` of a BigInt literal's digits, or `undefined` if they are no BigInt. */
function bigintValue(digits: string): string | undefined {
  try {
    return BigInt(digits.replace(/_/g, '')).toString();
  } catch {
    return undefined;
  }
}

/**
 * The cursor over a JavaScript text that the literal reader moves: the
 * helpers that skip what is not read are shared (see macro-discovery.ts).
 */
export class Reader {
  i = 0;
  constructor(protected readonly src: string) {}

  /** Skip whitespace and comments. */
  space(): void {
    const { src } = this;
    for (;;) {
      while (/\s/.test(src.charAt(this.i))) this.i++;
      if (src.startsWith('//', this.i)) {
        const end = src.indexOf('\n', this.i);
        this.i = end < 0 ? src.length : end;
      } else if (src.startsWith('/*', this.i)) {
        const end = src.indexOf('*/', this.i + 2);
        this.i = end < 0 ? src.length : end + 2;
      } else return;
    }
  }

  /** The value at the cursor, which is left after it (or anywhere, if not static). */
  value(): StaticLiteral {
    const { src } = this;
    this.space();
    const c = src.charAt(this.i);
    if (c === '"' || c === "'") {
      return this.string().closed ? { shape: { type: 'string' } } : undefined;
    }
    if (c === '`') return this.template();
    if (c === '[')
      return this.skipBalanced() ? { shape: { type: 'array' } } : undefined;
    if (c === '{') return this.object();
    if (/[\d.+-]/.test(c)) return this.number();
    if (/[A-Za-z_$(]/.test(c)) return this.word();
    return undefined;
  }

  /** Skip the string literal at the cursor: its body, and whether it is closed. */
  protected string(): { body: string; closed: boolean } {
    const { end, closed } = scanStringLiteral(this.src, this.i);
    const body = this.src.slice(this.i + 1, closed ? end - 1 : end);
    this.i = end;
    return { body, closed };
  }

  /**
   * Skip the string literal at the cursor and read its value, or `undefined`
   * if it is not closed or not well-formed.
   */
  protected stringValue(): string | undefined {
    const at = this.i;
    const { closed } = this.string();
    return closed
      ? (stringLiteralValue(this.src.slice(at, this.i)) ?? undefined)
      : undefined;
  }

  /** A template literal: a string, but for `${}`. */
  protected template(): StaticLiteral {
    const { src } = this;
    for (let i = this.i + 1; i < src.length; i++) {
      const c = src.charAt(i);
      if (c === '\\') i++;
      else if (c === '`') {
        this.i = i + 1;
        return { shape: { type: 'string' } };
      } else if (c === '$' && src.charAt(i + 1) === '{') return undefined;
    }
    return undefined;
  }

  /** A number, or a sign and one. */
  protected number(): StaticLiteral {
    const { src } = this;
    let i = this.i;
    const sign = src.charAt(i);
    if (sign === '+' || sign === '-') {
      i++;
      while (/\s/.test(src.charAt(i))) i++;
    }
    NUMBER_RE.lastIndex = i;
    const match = NUMBER_RE.exec(src);
    if (match) {
      this.i = NUMBER_RE.lastIndex;
      if (!match[1]) return { shape: { type: 'number' } };
      // A BigInt: `+1n` throws, `-1n` and `1n` are values no variable can hold
      if (sign === '+') {
        return { throws: 'Cannot convert a BigInt value to a number' };
      }
      const digits = bigintValue(match[0].slice(0, -1));
      return digits === undefined
        ? undefined
        : {
            unsupported: 'bigint',
            value: sign === '-' && digits !== '0' ? `-${digits}` : digits,
          };
    }
    IDENT_RE.lastIndex = i;
    const word = IDENT_RE.exec(src)?.[0];
    if (word === 'Infinity') {
      this.i = IDENT_RE.lastIndex;
      return { shape: { type: 'number' } };
    }
    return undefined;
  }

  /** A keyword, a function, or a name (which is not static). */
  protected word(): StaticLiteral {
    const { src } = this;
    const start = this.i;
    const arrow = this.arrow();
    if (arrow !== undefined)
      return arrow ? this.functionFrom(start) : undefined;
    IDENT_RE.lastIndex = this.i;
    const word = IDENT_RE.exec(src)?.[0];
    if (word === undefined) return undefined;
    const end = IDENT_RE.lastIndex;
    switch (word) {
      case 'true':
      case 'false':
        this.i = end;
        return { shape: { type: 'boolean' } };
      case 'null':
        this.i = end;
        return { shape: { type: 'null' } };
      case 'NaN':
        this.i = end;
        return { shape: { type: 'number' } };
      case 'undefined':
        this.i = end;
        return UNSUPPORTED_UNDEFINED;
      case 'void': {
        // `void 0` is `undefined`, whatever the operand
        this.i = end;
        const operand = this.value();
        return operand && !('throws' in operand)
          ? UNSUPPORTED_UNDEFINED
          : operand;
      }
      case 'function':
      case 'class':
      case 'async':
        return this.skipDeclaration(word)
          ? this.functionFrom(start)
          : undefined;
    }
    return undefined;
  }

  /** The function (or class) that was skipped since `start`. */
  protected functionFrom(start: number): StaticLiteral {
    return {
      unsupported: 'function',
      value: this.src.slice(start, this.i).trimEnd(),
    };
  }

  /**
   * Skip the parameters of an arrow function and its body, which ends at a
   * `,` or `}` outside brackets, or at the end of the text. `undefined` if the
   * text at the cursor is no arrow function, false if it cannot be skipped.
   */
  protected arrow(): boolean | undefined {
    const { src } = this;
    ARROW_RE.lastIndex = this.i;
    if (!ARROW_RE.test(src)) return undefined;
    this.i = ARROW_RE.lastIndex;
    this.space();
    if (src.charAt(this.i) === '{') return this.skipBalanced();
    while (this.i < src.length && !',}'.includes(src.charAt(this.i))) {
      if (!this.skipOne()) break;
    }
    return true;
  }

  /**
   * Skip a `function`, `async function` or `class` (its keyword `word` is at
   * the cursor), up to the end of its body.
   */
  protected skipDeclaration(word: string): boolean {
    const { src } = this;
    this.i += word.length;
    this.space();
    if (word === 'async') {
      IDENT_RE.lastIndex = this.i;
      if (IDENT_RE.exec(src)?.[0] !== 'function') return false;
      return this.skipDeclaration('function');
    }
    if (word === 'function') {
      if (src.charAt(this.i) === '*') this.i++;
      this.space();
      IDENT_RE.lastIndex = this.i;
      if (IDENT_RE.test(src)) this.i = IDENT_RE.lastIndex;
      this.space();
      if (src.charAt(this.i) !== '(' || !this.skipBalanced()) return false;
      this.space();
    } else {
      // A class: up to its body, past what it extends
      while (this.i < src.length && src.charAt(this.i) !== '{') {
        if (!this.skipOne()) return false;
      }
    }
    return src.charAt(this.i) === '{' && this.skipBalanced();
  }

  /** An object literal: the members that are static. */
  protected object(): StaticLiteral {
    const { src } = this;
    const members: Members = new Map();
    let thrown: string | undefined;
    this.i++;
    for (;;) {
      this.space();
      const c = src.charAt(this.i);
      if (c === '}') {
        this.i++;
        return thrown === undefined
          ? this.objectOf(members)
          : { throws: thrown };
      }
      if (c === ',') {
        this.i++;
        continue;
      }
      if (this.i >= src.length) return undefined;
      const start = this.i;
      const key = this.key();
      if (key === '__proto__') return undefined; // sets the prototype
      this.space();
      const next = src.charAt(this.i);
      if (key !== undefined && next === ':') {
        this.i++;
        const at = this.i;
        const value = this.value();
        this.space();
        if (value && this.atMemberEnd()) {
          if ('throws' in value) thrown ??= value.throws;
          else members.set(key, 'shape' in value ? value.shape : value);
          continue;
        }
        // Not static: it replaces any earlier member of the same name
        members.set(key, null);
        this.i = at;
      } else if (key !== undefined && next === '(') {
        // A method
        if (!this.skipBalanced()) return undefined;
        this.space();
        if (src.charAt(this.i) === '{' && this.skipBalanced()) {
          members.set(key, {
            unsupported: 'function',
            value: src.slice(start, this.i),
          });
          continue;
        }
        return undefined;
      } else if (key !== undefined && (next === ',' || next === '}')) {
        members.set(key, null); // shorthand: the value of a variable
        continue;
      } else {
        // A spread, a computed key, an accessor: it can replace any member
        members.clear();
      }
      if (!this.skipMember()) return undefined;
    }
  }

  /** Whether a member ends at the cursor. */
  protected atMemberEnd(): boolean {
    return this.i < this.src.length && ',}'.includes(this.src.charAt(this.i));
  }

  /**
   * The object literal with these members: a value no variable can hold
   * anywhere in it (the first the runtime meets) is what it reads as.
   */
  protected objectOf(members: Members): StaticLiteral {
    const fields = new Map<string, LiteralShape>();
    for (const key of entryOrder(members.keys())) {
      const member = members.get(key);
      if (!member) continue;
      if ('unsupported' in member) return member;
      fields.set(key, member);
    }
    return { shape: { type: 'object', fields } };
  }

  /** The key of a member (a name, a string or a number), if it has one. */
  protected key(): string | undefined {
    const { src } = this;
    const c = src.charAt(this.i);
    if (c === '"' || c === "'") return this.stringValue();
    KEY_RE.lastIndex = this.i;
    const found = KEY_RE.exec(src)?.[0];
    if (found === undefined) return undefined;
    this.i = KEY_RE.lastIndex;
    if (!/^\d/.test(found)) return found;
    // A number: its key is its value as a string
    const digits = found.replace(/_/g, '');
    if (/^0\d/.test(digits)) return undefined;
    if (digits.endsWith('n') && !/^0[xX]/.test(digits)) {
      return bigintValue(digits.slice(0, -1));
    }
    const value = Number(digits);
    return Number.isNaN(value) ? undefined : String(value);
  }

  /** Skip to the `,` or `}` that ends a member, balancing what is inside. */
  protected skipMember(): boolean {
    const { src } = this;
    while (this.i < src.length) {
      const c = src.charAt(this.i);
      if (c === ',' || c === '}') return true;
      if (!this.skipOne()) return false;
    }
    return false;
  }

  /** Skip an array literal (or any bracketed group) at the cursor. */
  protected skipBalanced(): boolean {
    const { src } = this;
    const close = { '[': ']', '{': '}', '(': ')' }[src.charAt(this.i)];
    if (!close) return false;
    this.i++;
    while (this.i < src.length) {
      if (src.charAt(this.i) === close) {
        this.i++;
        return true;
      }
      if (!this.skipOne()) return false;
    }
    return false;
  }

  /** Skip one character, or one string, template, comment or group. */
  protected skipOne(): boolean {
    const { src } = this;
    const c = src.charAt(this.i);
    if (c === '"' || c === "'") return this.string().closed;
    if (c === '`') return this.skipTemplate();
    if (src.startsWith('//', this.i) || src.startsWith('/*', this.i)) {
      this.space();
      return true;
    }
    if (c === '[' || c === '{' || c === '(') return this.skipBalanced();
    if (c === ']' || c === '}' || c === ')') return false;
    this.i++;
    return true;
  }

  /** Skip a template literal, with the expressions in it. */
  protected skipTemplate(): boolean {
    const { src } = this;
    this.i++;
    while (this.i < src.length) {
      const c = src.charAt(this.i);
      if (c === '\\') this.i += 2;
      else if (c === '`') {
        this.i++;
        return true;
      } else if (c === '$' && src.charAt(this.i + 1) === '{') {
        this.i++;
        if (!this.skipBalanced()) return false;
      } else this.i++;
    }
    return false;
  }
}
