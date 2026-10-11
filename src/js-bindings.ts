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
}

const CLOSERS: Record<string, Kind> = { '}': '{', ')': '(', ']': '[' };
/** What `(…) {` is when a word like this is before the `(`: a block. */
const BLOCK_WORDS = new Set(['if', 'for', 'while', 'switch', 'with', 'catch']);
const NOT_PARAMETERS = new Set(['if', 'for', 'while', 'switch', 'with']);
const DECLARATIONS = new Set(['const', 'let', 'var']);
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
  private readonly top: Scope = { start: -1, end: Infinity };

  constructor(private readonly code: string) {
    this.readGroups();
  }

  /**
   * The `{` of the object literal that `name`, used at `at`, is declared as
   * (`const`, `let` or `var`), when that is the declaration it names: the
   * innermost one in the scope of the use, that comes before it unless the
   * use is in a function of its own. `undefined` if it names another value,
   * or more than one declaration is the innermost.
   */
  objectOf(name: string, at: number): number | undefined {
    const { code } = this;
    const escaped = name.replace(/\$/g, '\\$');
    const bindings: Binding[] = [];
    for (const m of code.matchAll(
      new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'g'),
    )) {
      const binding = this.bindingAt(m.index, name.length);
      if (binding) bindings.push(binding);
    }
    const useFunction = this.functionStart(at);
    const visible = bindings.filter(
      (b) =>
        b.scope.start <= at &&
        at < b.scope.end &&
        (!b.ordered || b.at < at || this.functionStart(b.at) !== useFunction),
    );
    const innermost = Math.max(...visible.map((b) => b.scope.start));
    const found = visible.filter((b) => b.scope.start === innermost);
    return found.length === 1 ? found[0]!.object : undefined;
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

  /** Whether the `{` group is the body of a function (or method). */
  private isFunctionBody(group: Group): boolean {
    if (group.kind !== '{') return false;
    let known = this.functions.get(group);
    if (known === undefined) {
      const before = this.backFrom(group.open);
      const { code } = this;
      if (code.charAt(before) === ')') {
        const params = this.byClose.get(before);
        const word = params && this.wordBefore(this.backFrom(params.open) + 1);
        known = !!params && !BLOCK_WORDS.has(word!.text);
      } else known = code.slice(before - 1, before + 1) === '=>';
      this.functions.set(group, known);
    }
    return known;
  }

  /** The start of the function that has `index` in its body, or -1. */
  private functionStart(index: number): number {
    for (let g = this.innermost(index, '{'); g; g = g.parent) {
      if (g.kind === '{' && this.isFunctionBody(g)) return g.open;
    }
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

  /** What the declaration keyword `word` (`var`, `let`, `const`) declares for. */
  private declaredIn(word: { text: string; start: number }): Scope {
    return word.text === 'var'
      ? this.functionAt(word.start)
      : this.blockAt(word.start);
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

  /** The word that ends before `end`, and where it starts. */
  private wordBefore(end: number): { text: string; start: number } {
    let start = end;
    while (start > 0 && isWordChar(this.code.charAt(start - 1))) start--;
    return { text: this.code.slice(start, end), start };
  }

  // -- the declarations -----------------------------------------------------

  /** What the name of `length` characters at `at` declares, if it does. */
  private bindingAt(at: number, length: number): Binding | undefined {
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
      this.assignmentAt(at, before, after)
    );
  }

  /** `const x`, `let x`, `var x`, `function x`, `class x`. */
  private declarationAt(
    at: number,
    before: number,
    spread: boolean,
  ): Binding | undefined {
    const word = spread ? undefined : this.wordBefore(before + 1);
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

  private nameEnd(at: number): number {
    let end = at;
    while (isWordChar(this.code.charAt(end))) end++;
    return end;
  }

  /** A name in a pattern (`const { x } = …`) or a parameter list. */
  private patternAt(
    at: number,
    before: number,
    after: number,
  ): Binding | undefined {
    const { code } = this;
    let group = this.innermost(at);
    if (!group || !BEFORE_BINDING[group.kind].includes(code.charAt(before))) {
      return undefined;
    }
    if (group.kind === '{' && code.charAt(after) === ':') return undefined; // a key
    for (; group; group = group.parent) {
      if (group.kind === '(') {
        const word = this.wordBefore(this.backFrom(group.open) + 1).text;
        const scope = NOT_PARAMETERS.has(word)
          ? undefined
          : this.bodyAfter(group.close);
        return scope && { scope, at, ordered: false };
      }
      const open = this.backFrom(group.open);
      const word = this.wordBefore(open + 1);
      if (DECLARATIONS.has(word.text)) {
        return { scope: this.declaredIn(word), at, ordered: true };
      }
      // Inside another pattern or list
      if (!'({[,:'.includes(code.charAt(open))) return undefined;
    }
    return undefined;
  }

  /** `x => …`. */
  private arrowParameterAt(at: number, after: number): Binding | undefined {
    return this.code.startsWith('=>', after)
      ? { scope: this.arrowBody(after + 2), at, ordered: false }
      : undefined;
  }

  /** `x = …`: a declaration in a list, or an assignment: a value not known. */
  private assignmentAt(
    at: number,
    before: number,
    after: number,
  ): Binding | undefined {
    const { code } = this;
    if (code.charAt(after) !== '=' || '=>'.includes(code.charAt(after + 1))) {
      return undefined;
    }
    const scope =
      code.charAt(before) === ',' ? this.functionAt(at) : this.blockAt(at);
    return { scope, at, ordered: true };
  }
}
