/**
 * The shape of a JavaScript literal, read from its text without running it:
 * what a StoryVariables initializer is when it is a literal, or an array or
 * object literal of literals (see parseDeclarations in story-variables.ts).
 *
 * The reader is deliberately small. Anything it does not recognise (a call,
 * an operator, a reference, a spread) is "not static", which is no error: the
 * value is simply not known without running the code.
 */
import { scanStringLiteral } from './js-lexer';

/** The type of a variable by its default (see story-variables.ts VarType). */
type LiteralType =
  'number' | 'string' | 'boolean' | 'array' | 'object' | 'null';

/** The shape of a literal (see story-variables.ts FieldSchema). */
export interface LiteralShape {
  type: LiteralType;
  /** The members an object literal gives statically, by key. */
  fields?: Map<string, LiteralShape>;
}

/** What a literal reads as. */
export type StaticLiteral =
  /** A value of this shape. */
  | { shape: LiteralShape }
  /** A value no variable can hold: its `typeof`. */
  | { unsupported: 'function' | 'undefined' | 'bigint' }
  /** Not known without running it. */
  | undefined;

const NUMBER_RE =
  /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)(n?)/y;
const IDENT_RE = /[A-Za-z_$][\w$]*/y;
const ARROW_RE =
  /(?:async\s+)?(?:\((?:[^()]|\([^()]*\))*\)|[A-Za-z_$][\w$]*)\s*=>/y;

/** Read `src`, one literal and nothing else. */
export function staticLiteral(src: string): StaticLiteral {
  const reader = new Reader(src);
  const value = reader.value();
  reader.space();
  return reader.i === src.length ? value : undefined;
}

class Reader {
  i = 0;
  constructor(private readonly src: string) {}

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
  private string(): { body: string; closed: boolean } {
    const { end, closed } = scanStringLiteral(this.src, this.i);
    const body = this.src.slice(this.i + 1, closed ? end - 1 : end);
    this.i = end;
    return { body, closed };
  }

  /** A template literal: a string, but for `${}`. */
  private template(): StaticLiteral {
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
  private number(): StaticLiteral {
    const { src } = this;
    let i = this.i;
    if (src.charAt(i) === '+' || src.charAt(i) === '-') {
      i++;
      while (/\s/.test(src.charAt(i))) i++;
    }
    NUMBER_RE.lastIndex = i;
    const match = NUMBER_RE.exec(src);
    if (match) {
      this.i = NUMBER_RE.lastIndex;
      return match[1]
        ? { unsupported: 'bigint' }
        : { shape: { type: 'number' } };
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
  private word(): StaticLiteral {
    const { src } = this;
    ARROW_RE.lastIndex = this.i;
    if (ARROW_RE.test(src)) return this.function();
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
        return { unsupported: 'undefined' };
      case 'function':
      case 'class':
      case 'async':
        return this.function();
    }
    return undefined;
  }

  /** A function (or class): the rest is its body, which is not read. */
  private function(): StaticLiteral {
    return this.unsupported({ unsupported: 'function' });
  }

  /** `value`, which makes the whole literal unsupported: the rest is not read. */
  private unsupported(value: {
    unsupported: 'function' | 'undefined' | 'bigint';
  }) {
    this.i = this.src.length;
    return value;
  }

  /** An object literal: the members that are static. */
  private object(): StaticLiteral {
    const { src } = this;
    const fields = new Map<string, LiteralShape>();
    this.i++;
    for (;;) {
      this.space();
      const c = src.charAt(this.i);
      if (c === '}') {
        this.i++;
        return { shape: { type: 'object', fields } };
      }
      if (c === ',') {
        this.i++;
        continue;
      }
      if (this.i >= src.length) return undefined;
      const key = this.key();
      this.space();
      if (key !== undefined && src.charAt(this.i) === ':') {
        this.i++;
        const at = this.i;
        const value = this.value();
        this.space();
        if (value && 'unsupported' in value) return this.unsupported(value);
        if (value && ',}'.includes(src.charAt(this.i))) {
          fields.set(key, value.shape);
          continue;
        }
        // Not static: skip to the end of the member
        this.i = at;
      } else if (key !== undefined && src.charAt(this.i) === '(') {
        return this.unsupported({ unsupported: 'function' });
      }
      if (!this.skipMember()) return undefined;
    }
  }

  /** The key of a member (a name, a string or a number), if it has one. */
  private key(): string | undefined {
    const { src } = this;
    const c = src.charAt(this.i);
    if (c === '"' || c === "'") {
      const { body, closed } = this.string();
      return closed ? body : undefined;
    }
    const word = /[\w$]+/y;
    word.lastIndex = this.i;
    const found = word.exec(src)?.[0];
    if (found === undefined) return undefined;
    this.i = word.lastIndex;
    return found;
  }

  /** Skip to the `,` or `}` that ends a member, balancing what is inside. */
  private skipMember(): boolean {
    const { src } = this;
    while (this.i < src.length) {
      const c = src.charAt(this.i);
      if (c === ',' || c === '}') return true;
      if (!this.skipOne()) return false;
    }
    return false;
  }

  /** Skip an array literal (or any bracketed group) at the cursor. */
  private skipBalanced(): boolean {
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
  private skipOne(): boolean {
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
  private skipTemplate(): boolean {
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
