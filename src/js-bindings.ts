/**
 * Which declaration a variable names where it is used in JavaScript, read
 * from the text without running it (see discoverMacros): the scope the use is
 * in, the declarations of the name that scope can see, and the innermost one.
 *
 * It reads the shape of the code (brackets, and the words before and after a
 * name) in text whose strings, comments and regexes are blanked, so it needs
 * no syntax tree and goes on through code that is not complete. What it
 * cannot place, it counts as a declaration of unknown value: a parameter, a
 * pattern, an assignment. Better no answer than another declaration's.
 */

type Kind = '{' | '(' | '[';

interface Group {
  kind: Kind;
  open: number;
  /** The closing bracket, or the end of the text if there is none. */
  close: number;
  parent: Group | undefined;
}

/** The text a name is visible in: `[start, end)`. */
interface Scope {
  start: number;
  end: number;
}

interface Binding {
  scope: Scope;
  /** Where the name is declared. */
  at: number;
  /** Whether it must come before a use in the same function. */
  ordered: boolean;
  /** The `{` of the object literal it is declared as, if it is. */
  object?: number;
  /**
   * Not a declaration but a write to the value of one (an assignment, a
   * property of it set): `scope` is then that of the declaration it writes to.
   */
  write?: true;
}

const CLOSERS: Record<string, Kind> = { '}': '{', ')': '(', ']': '[' };
/** What `(…) {` is when a word like this is before the `(`: a block. */
const BLOCK_WORDS = new Set(['if', 'for', 'while', 'switch', 'with', 'catch']);
const NOT_PARAMETERS = new Set(['if', 'for', 'while', 'switch', 'with']);
const DECLARATIONS = new Set(['const', 'let', 'var']);
/** After a name: `=`, `+=`, `&&=`, `++` and the other ways to give it a value. */
const WRITE_RE =
  /(?:(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])=(?!=)|=(?![=>])|\+\+|--)/y;
/** A call of these on `x.list` changes `x`; as does one of these on `x` itself. */
const MUTATORS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
]);
const MUTATING_CALL_RE =
  /(?:Object|Reflect)\s*\.\s*(?:assign|defineProperty|defineProperties|setPrototypeOf|set|deleteProperty)\s*$/;
/** Before a name in a pattern or parameter list, by the group around it. */
const BEFORE_BINDING: Record<Kind, string> = {
  '{': '{,:',
  '[': '[,',
  '(': '(,',
};

const isWordChar = (c: string | undefined) => !!c && /[\w$]/.test(c);

/** Resolve the declaration of variables in `code` (see blankedCode in macro-discovery). */
export class Bindings {
  private readonly groups: Group[] = [];
  private readonly byOpen = new Map<number, Group>();
  private readonly byClose = new Map<number, Group>();
  private readonly functions = new Map<Group, boolean>();
  private readonly functionStarts = new Map<number, number>();
  private readonly facts = new Map<
    ReadonlySet<string>,
    Map<string, Binding[]>
  >();
  private readonly top: Scope = { start: -1, end: Infinity };

  constructor(private readonly code: string) {
    this.readGroups();
  }

  /**
   * The `{` of the object literal that `name`, used at `at`, is declared as
   * (`const`, `let` or `var`), when that is the declaration it names: the
   * innermost one in the scope of the use, that comes before it unless the
   * use is in a function of its own. `undefined` if it names another value,
   * more than one declaration is the innermost, or the value is written to
   * (given another, or one of its `properties` set) where the use can follow.
   */
  objectOf(
    name: string,
    at: number,
    properties: ReadonlySet<string>,
  ): number | undefined {
    let names = this.facts.get(properties);
    if (!names) this.facts.set(properties, (names = new Map()));
    let bindings = names.get(name);
    if (!bindings) {
      bindings = this.readBindings(name, properties);
      names.set(name, bindings);
    }
    const found = this.innermostVisible(bindings, at);
    return found.length === 1 ? found[0]!.object : undefined;
  }

  /** Declaration and write facts are immutable for this source and property set. */
  private readBindings(
    name: string,
    properties: ReadonlySet<string>,
  ): Binding[] {
    const { code } = this;
    const escaped = name.replace(/\$/g, '\\$');
    const bindings: Binding[] = [];
    for (const m of code.matchAll(
      new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'g'),
    )) {
      const binding = this.bindingAt(m.index, name.length, properties);
      if (binding) bindings.push(binding);
    }
    // A write is to the declaration it sees: in the scope of that one
    const declarations = bindings.filter((b) => !b.write);
    for (const b of bindings) {
      if (b.write) {
        b.scope =
          this.innermostVisible(declarations, b.at)[0]?.scope ?? this.top;
      }
    }
    return bindings;
  }

  /**
   * Of the `bindings` the use at `at` can see, those in the innermost scope:
   * the scope is the use's, and a binding comes before it, unless the use is
   * in a function of its own.
   */
  private innermostVisible(bindings: Binding[], at: number): Binding[] {
    const useFunction = this.functionStart(at);
    const visible = bindings.filter(
      (b) =>
        b.scope.start <= at &&
        at < b.scope.end &&
        (!b.ordered || b.at < at || this.functionStart(b.at) !== useFunction),
    );
    const innermost = Math.max(...visible.map((b) => b.scope.start));
    return visible.filter((b) => b.scope.start === innermost);
  }

  // -- the brackets ---------------------------------------------------------

  private readGroups(): void {
    const { code, groups } = this;
    const stack: Group[] = [];
    for (let i = 0; i < code.length; i++) {
      const c = code.charAt(i);
      if (c === '{' || c === '(' || c === '[') {
        const group: Group = {
          kind: c,
          open: i,
          close: code.length,
          parent: stack[stack.length - 1],
        };
        groups.push(group);
        stack.push(group);
        this.byOpen.set(i, group);
      } else if (CLOSERS[c]) {
        // Tolerate a closer with no opener: the innermost of its kind closes
        let k = stack.length - 1;
        while (k >= 0 && stack[k]!.kind !== CLOSERS[c]) k--;
        if (k >= 0) {
          stack[k]!.close = i;
          this.byClose.set(i, stack[k]!);
          stack.length = k;
        }
      }
    }
  }

  /** The innermost group that has `index` inside it, of this kind if given. */
  private innermost(index: number, kind?: Kind): Group | undefined {
    const { groups } = this;
    for (let k = groups.length - 1; k >= 0; k--) {
      const g = groups[k]!;
      if (g.open < index && index < g.close && (!kind || g.kind === kind)) {
        return g;
      }
    }
    return undefined;
  }

  /**
   * The word before a `(` group (`if`, `for`, `catch`, a function's name…);
   * `for await` is `for`.
   */
  private ownerWord(paren: Group): string {
    const word = this.wordBefore(this.backFrom(paren.open) + 1);
    if (word.text !== 'await') return word.text;
    const before = this.wordBefore(this.backFrom(word.start) + 1).text;
    return before === 'for' ? before : word.text;
  }

  /**
   * Whether the `{` group is the body of a function (or method), or of a
   * class static block, which has the scope of a `var` of its own.
   */
  private isFunctionBody(group: Group): boolean {
    if (group.kind !== '{') return false;
    let known = this.functions.get(group);
    if (known === undefined) {
      const before = this.backFrom(group.open);
      const { code } = this;
      if (code.charAt(before) === ')') {
        const params = this.byClose.get(before);
        known = !!params && !BLOCK_WORDS.has(this.ownerWord(params));
      } else {
        known =
          code.slice(before - 1, before + 1) === '=>' ||
          this.wordBefore(before + 1).text === 'static';
      }
      this.functions.set(group, known);
    }
    return known;
  }

  /** The start of the function that has `index` in its body, or -1. */
  private functionStart(index: number): number {
    const known = this.functionStarts.get(index);
    if (known !== undefined) return known;
    for (let g = this.innermost(index, '{'); g; g = g.parent) {
      if (g.kind === '{' && this.isFunctionBody(g)) {
        this.functionStarts.set(index, g.open);
        return g.open;
      }
    }
    this.functionStarts.set(index, -1);
    return -1;
  }

  // -- the scopes -----------------------------------------------------------

  private scopeOf(group: Group | undefined): Scope {
    return group ? { start: group.open, end: group.close } : this.top;
  }

  /** The block `index` is in: what `let` and `const` declare for. */
  private blockAt(index: number): Scope {
    return this.scopeOf(this.innermost(index, '{'));
  }

  /** The function (or the whole text) `index` is in: what `var` declares for. */
  private functionAt(index: number): Scope {
    const start = this.functionStart(index);
    return start < 0 ? this.top : this.scopeOf(this.byOpen.get(start));
  }

  /**
   * What the declaration keyword `word` (`var`, `let`, `const`) declares for:
   * the function for `var`, the block for the others, or the `for` statement,
   * header and body, when the declaration is in its header.
   */
  private declaredIn(word: { text: string; start: number }): Scope {
    if (word.text === 'var') return this.functionAt(word.start);
    const group = this.innermost(word.start);
    if (group?.kind === '(' && this.ownerWord(group) === 'for') {
      return { start: group.open, end: this.statementEnd(group.close + 1) };
    }
    return this.blockAt(word.start);
  }

  /**
   * Where the statement that starts at `from` ends: a block, the body of an
   * `if`, `for`, `while` or `with` (and the `else` of an `if`), or else up to
   * a `;`, the closer of the group it is in, or a line break that is followed
   * by a statement of its own.
   */
  private statementEnd(from: number): number {
    const { code } = this;
    const start = this.forward(from);
    const block = this.byOpen.get(start);
    if (block?.kind === '{') return Math.min(block.close + 1, code.length);
    const word = this.wordAt(start);
    if (/^(?:if|for|while|with)$/.test(word)) {
      let paren = this.forward(start + word.length);
      if (word === 'for' && this.wordAt(paren) === 'await') {
        paren = this.forward(paren + 5);
      }
      const header = this.byOpen.get(paren);
      if (header) {
        const end = this.statementEnd(header.close + 1);
        const next = this.forward(end);
        return word === 'if' && this.wordAt(next) === 'else'
          ? this.statementEnd(next + 4)
          : end;
      }
    }
    for (let end = start; end < code.length; end++) {
      const c = code.charAt(end);
      if (c === ';') return end + 1;
      if (CLOSERS[c]) return end;
      const group = this.byOpen.get(end);
      if (group) end = group.close;
      else if (c === '\n' && this.startsStatement(end)) return end;
    }
    return code.length;
  }

  /** Whether the line break at `index` ends a statement, and one follows. */
  private startsStatement(index: number): boolean {
    const next = this.forward(index);
    return (
      /[\w$)\]}]/.test(this.code.charAt(this.backFrom(index))) &&
      isWordChar(this.code.charAt(next)) &&
      !/^(?:in|of|instanceof|else)$/.test(this.wordAt(next))
    );
  }

  /** What a parameter list, whose `)` is `close`, is the scope of: the body. */
  private bodyAfter(close: number): Scope | undefined {
    const next = this.forward(close + 1);
    if (this.code.charAt(next) === '{')
      return this.scopeOf(this.byOpen.get(next));
    return this.code.startsWith('=>', next)
      ? this.arrowBody(next + 2)
      : undefined;
  }

  /** The body of an arrow function, whose `=>` ends before `from`. */
  private arrowBody(from: number): Scope {
    const { code } = this;
    const start = this.forward(from);
    if (code.charAt(start) === '{') return this.scopeOf(this.byOpen.get(start));
    let end = start;
    while (end < code.length && !',;)]}'.includes(code.charAt(end))) {
      end = this.byOpen.get(end)?.close ?? end;
      end++;
    }
    return { start, end };
  }

  // -- the text -------------------------------------------------------------

  /** The index of the last character that is no space before `index`, or -1. */
  private backFrom(index: number): number {
    let i = index - 1;
    while (i >= 0 && /\s/.test(this.code.charAt(i))) i--;
    return i;
  }

  /** The index of the first character that is no space from `index` on. */
  private forward(index: number): number {
    let i = index;
    while (i < this.code.length && /\s/.test(this.code.charAt(i))) i++;
    return i;
  }

  /** The word that starts at `index` (empty if there is none). */
  private wordAt(index: number): string {
    return this.code.slice(index, this.nameEnd(index));
  }

  /** The word that ends before `end`, and where it starts. */
  private wordBefore(end: number): { text: string; start: number } {
    let start = end;
    while (start > 0 && isWordChar(this.code.charAt(start - 1))) start--;
    return { text: this.code.slice(start, end), start };
  }

  // -- the declarations -----------------------------------------------------

  /**
   * What the name of `length` characters at `at` declares, or writes to, if it
   * does. A write to a `properties` of it counts, one to another does not.
   */
  private bindingAt(
    at: number,
    length: number,
    properties: ReadonlySet<string>,
  ): Binding | undefined {
    const { code } = this;
    let before = this.backFrom(at);
    const spread = code.slice(before - 2, before + 1) === '...';
    if (code.charAt(before) === '.' && !spread) return undefined; // a property
    if (spread) before = this.backFrom(before - 2);
    const after = this.forward(at + length);
    return (
      this.declarationAt(at, before, spread) ??
      this.patternAt(at, before, after) ??
      this.arrowParameterAt(at, after) ??
      (spread ? undefined : this.writeAt(at, before, after, properties))
    );
  }

  /** `const x`, `let x`, `var x`, a later `y` of `let x, y`, `function x`, `class x`. */
  private declarationAt(
    at: number,
    before: number,
    spread: boolean,
  ): Binding | undefined {
    if (spread) return undefined;
    const word =
      this.code.charAt(before) === ','
        ? this.listKeyword(before)
        : this.wordBefore(before + 1);
    if (!word || this.code.charAt(word.start - 1) === '.') return undefined;
    if (DECLARATIONS.has(word.text)) {
      const scope = this.declaredIn(word);
      const init = /\s*=\s*(?=\{)/y;
      init.lastIndex = this.nameEnd(at);
      const object = init.test(this.code) ? init.lastIndex : undefined;
      return { scope, at, ordered: true, object };
    }
    if (word.text === 'function' || word.text === 'class') {
      return {
        scope: this.blockAt(word.start),
        at,
        ordered: word.text === 'class',
      };
    }
    return undefined;
  }

  /**
   * The `const`, `let` or `var` of the declaration list that the `,` at
   * `comma` is in (`let a = 1, b`, also in a `for` header): the nearest one
   * before it in the same brackets, that no `;` is between.
   */
  private listKeyword(
    comma: number,
  ): { text: string; start: number } | undefined {
    const { code } = this;
    const floor = this.innermost(comma)?.open ?? -1;
    for (let i = comma - 1; i > floor; i--) {
      const c = code.charAt(i);
      if (c === ';') return undefined;
      const group = CLOSERS[c] ? this.byClose.get(i) : undefined;
      if (group) i = group.open;
      else if (isWordChar(c)) {
        const word = this.wordBefore(i + 1);
        if (
          DECLARATIONS.has(word.text) &&
          code.charAt(word.start - 1) !== '.'
        ) {
          return word;
        }
        i = word.start;
      }
    }
    return undefined;
  }

  private nameEnd(at: number): number {
    let end = at;
    while (isWordChar(this.code.charAt(end))) end++;
    return end;
  }

  /**
   * A name in a pattern (`const { x } = …`) or a parameter list; or one a
   * pattern assigns to (`({ x } = …)`).
   */
  private patternAt(
    at: number,
    before: number,
    after: number,
  ): Binding | undefined {
    const { code } = this;
    const inner = this.innermost(at);
    if (!inner || !BEFORE_BINDING[inner.kind].includes(code.charAt(before))) {
      return undefined;
    }
    if (inner.kind === '{' && code.charAt(after) === ':') return undefined; // a key
    // The outermost pattern, to see whether it is assigned to
    let pattern: Group | undefined;
    for (let group: Group | undefined = inner; group; group = group.parent) {
      if (group.kind === '(') {
        const scope = NOT_PARAMETERS.has(this.ownerWord(group))
          ? undefined
          : this.bodyAfter(group.close);
        return scope
          ? { scope, at, ordered: false }
          : this.patternWriteAt(at, pattern);
      }
      pattern = group;
      const open = this.backFrom(group.open);
      const word =
        code.charAt(open) === ','
          ? this.listKeyword(open)
          : this.wordBefore(open + 1);
      if (word && DECLARATIONS.has(word.text)) {
        return { scope: this.declaredIn(word), at, ordered: true };
      }
      // Inside another pattern or list
      if (!'({[,:'.includes(code.charAt(open))) break;
    }
    return this.patternWriteAt(at, pattern);
  }

  /** `[x] = …`, `({ x } = …)`, `for ({ x } of …)`: a name that is assigned to. */
  private patternWriteAt(
    at: number,
    pattern: Group | undefined,
  ): Binding | undefined {
    if (!pattern) return undefined;
    const { code } = this;
    const open = this.backFrom(pattern.open);
    if (/[\w$)\]]/.test(code.charAt(open))) return undefined; // `a[x] = …`
    const next = this.forward(pattern.close + 1);
    const inForHead =
      pattern.parent?.kind === '(' &&
      this.ownerWord(pattern.parent) === 'for' &&
      /^(?:of|in)(?![\w$])/.test(code.slice(next));
    return inForHead || this.isWriteOperator(next)
      ? { scope: this.top, at, ordered: true, write: true }
      : undefined;
  }

  /** `x => …`. */
  private arrowParameterAt(at: number, after: number): Binding | undefined {
    return this.code.startsWith('=>', after)
      ? { scope: this.arrowBody(after + 2), at, ordered: false }
      : undefined;
  }

  /** Whether an assignment, `++` or `--` operator is at `index`. */
  private isWriteOperator(index: number): boolean {
    WRITE_RE.lastIndex = index;
    return WRITE_RE.test(this.code);
  }

  /**
   * `x = …`, `x += …`, `x++`, `for (x of …)`, and the writes to what it
   * holds that change the config it is (`x.name = …`, `delete x.name`,
   * `x.parameters.push(…)`, `Object.assign(x, …)`): a value not known.
   */
  private writeAt(
    at: number,
    before: number,
    after: number,
    properties: ReadonlySet<string>,
  ): Binding | undefined {
    const { code } = this;
    if (this.isClassBody(this.innermost(at))) return undefined; // a field
    const { keys, end } = this.memberChain(after);
    const prefix = ['++', '--'].includes(code.slice(before - 1, before + 1));
    const written =
      prefix ||
      this.isWriteOperator(end) ||
      (keys.length > 0 &&
        (this.wordBefore(before + 1).text === 'delete' ||
          (keys.length > 1 &&
            code.charAt(end) === '(' &&
            MUTATORS.has(keys[keys.length - 1]!)))) ||
      (keys.length === 0 && this.isForTarget(before, end)) ||
      (keys.length === 0 && this.isMutatedArgument(before, end));
    // A property that is not a part of the macro's config does not matter
    const first = keys[0];
    if (!written || (first && !properties.has(first))) return undefined;
    return { scope: this.top, at, ordered: true, write: true };
  }

  /** Whether the group is the body of a class: its members are its own. */
  private isClassBody(group: Group | undefined): boolean {
    if (group?.kind !== '{') return false;
    let start = group.open;
    while (start > 0 && !'{};'.includes(this.code.charAt(start - 1))) start--;
    return /(?<![\w$.])class(?![\w$])/.test(this.code.slice(start, group.open));
  }

  /**
   * The properties read from a name at `from` (`.a.b[c]`, a key is null if
   * computed), and where the chain ends.
   */
  private memberChain(from: number): { keys: (string | null)[]; end: number } {
    const { code } = this;
    const keys: (string | null)[] = [];
    let end = from;
    for (;;) {
      let i = end;
      if (code.startsWith('?.', i)) i += 2;
      else if (code.charAt(i) === '.' && code.charAt(i + 1) !== '.') i++;
      else if (code.charAt(i) !== '[') break;
      i = this.forward(i);
      const bracket = code.charAt(i) === '[' ? this.byOpen.get(i) : undefined;
      const key = bracket ? '' : this.wordAt(i);
      if (!bracket && !key) break;
      keys.push(bracket ? null : key);
      end = this.forward(bracket ? bracket.close + 1 : i + key.length);
    }
    return { keys, end };
  }

  /** `for (x of …)`: the name is assigned each item. */
  private isForTarget(before: number, end: number): boolean {
    const group = this.byOpen.get(before);
    return (
      group?.kind === '(' &&
      this.ownerWord(group) === 'for' &&
      /^(?:of|in)(?![\w$])/.test(this.code.slice(end))
    );
  }

  /** `Object.assign(x, …)` and the like: the name is the first argument. */
  private isMutatedArgument(before: number, end: number): boolean {
    const group = this.byOpen.get(before);
    return (
      group?.kind === '(' &&
      ',)'.includes(this.code.charAt(end)) &&
      MUTATING_CALL_RE.test(this.code.slice(0, group.open))
    );
  }
}
