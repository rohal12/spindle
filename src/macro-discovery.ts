/**
 * What `defineMacro({ … })` calls in JavaScript declare, read from the text
 * without running it (see discoverMacros): the literal parts of the config
 * object, and nothing else.
 */
import {
  checkParameterTypes,
  type ParameterDef,
  type ParameterType,
  type StringHolds,
} from './registry';
import { Bindings } from './js-bindings';
import { Reader, regexLiterals } from './static-literal';
import type { ToolingMacro } from './tooling';

/** A macro that a `defineMacro` call declares, and where its name is written. */
export interface DiscoveredMacro extends ToolingMacro {
  /** Whether it renders what is in `<name>` with `merged` locals. */
  merged?: boolean;
  description?: string;
  /** The name as written, without quotes: `[nameStart, nameEnd)` UTF-16 offsets. */
  nameStart: number;
  nameEnd: number;
}

/** A literal in the config of a macro. */
type Datum =
  | { type: 'string'; value: string; start: number; end: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'array'; items: (Datum | undefined)[] }
  | { type: 'object'; props: Map<string, Datum | undefined> };

/** The text of an object config, or the name of the variable that holds it. */
const CALL_RE = /(?<![\w$])defineMacro\s*\(\s*/g;
const IDENTIFIER_ARGUMENT_RE = /^([A-Za-z_$][\w$]*)\s*[,)]/;
const WORD_RE = /[A-Za-z_]+/y;
/** Before the key of a member that is an accessor, an async method or a generator. */
const MODIFIER_RE = /^(?:get|set|async)?$/;
const KEY_START_RE = /[\w$'"[.*]/;
/** The properties of a config that its macro is read from. */
const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'name',
  'block',
  'subMacros',
  'parameters',
  'interpolate',
  'storeVar',
  'merged',
  'description',
]);

/** The literals of a config object, read to the end of what is static. */
class ConfigReader extends Reader {
  /** Whether the text could not be skipped through (it ends the reading). */
  failed = false;
  private depth = 0;

  /** The static value of a member or element, whatever follows is skipped. */
  private member(): Datum | undefined {
    const at = this.i;
    const datum = this.datum();
    this.space();
    if (datum && this.atElementEnd()) return datum;
    // Part of a larger expression, or not a literal: skip all of it
    this.i = at;
    while (this.i < this.src.length && !this.atElementEnd()) {
      if (!this.skipOne()) {
        this.fail();
        break;
      }
    }
    return undefined;
  }

  private atElementEnd(): boolean {
    return this.i >= this.src.length || ',]}'.includes(this.src.charAt(this.i));
  }

  /** The literal at the cursor, if it is a string, boolean, array or object. */
  datum(): Datum | undefined {
    const { src } = this;
    this.space();
    const c = src.charAt(this.i);
    if (c === '"' || c === "'") {
      const start = this.i;
      const value = this.stringValue();
      return value === undefined
        ? undefined
        : { type: 'string', value, start: start + 1, end: this.i - 1 };
    }
    if (c === '`') return this.plainTemplate();
    if (c === '[') return this.array();
    if (c === '{') return this.record();
    WORD_RE.lastIndex = this.i;
    const word = WORD_RE.exec(src)?.[0];
    if (word === 'true' || word === 'false') {
      this.i = WORD_RE.lastIndex;
      return { type: 'boolean', value: word === 'true' };
    }
    return undefined;
  }

  /** A template literal that has no `${}` and no escapes, as a string. */
  private plainTemplate(): Datum | undefined {
    const { src } = this;
    const start = this.i;
    for (let i = start + 1; i < src.length; i++) {
      const c = src.charAt(i);
      if (c === '`') {
        this.i = i + 1;
        return {
          type: 'string',
          value: src.slice(start + 1, i),
          start: start + 1,
          end: i,
        };
      }
      if (c === '\\' || (c === '$' && src.charAt(i + 1) === '{')) break;
    }
    return undefined;
  }

  /**
   * Read the elements up to `close`, each by `read`, which leaves the cursor
   * after what it read. False if the text ends first, or cannot be read.
   */
  private elements(close: string, read: () => void): boolean {
    // Deeper values are unknown, but skipping them must leave the reader
    // at the next member so unrelated config fields and calls still work.
    if (this.depth >= 64) {
      if (!this.skipBalanced()) this.fail();
      return false;
    }
    this.depth++;
    try {
      this.i++;
      for (;;) {
        this.space();
        const c = this.src.charAt(this.i);
        if (c === close) {
          this.i++;
          return true;
        }
        if (c === ',') {
          this.i++;
          continue;
        }
        if (this.failed || this.i >= this.src.length) return false;
        const before = this.i;
        read();
        if (this.i === before) this.fail();
      }
    } finally {
      this.depth--;
    }
  }

  private array(): Datum | undefined {
    const items: (Datum | undefined)[] = [];
    return this.elements(']', () => items.push(this.member()))
      ? { type: 'array', items }
      : undefined;
  }

  private record(): Datum | undefined {
    const props = new Map<string, Datum | undefined>();
    const ok = this.elements('}', () => this.property(props));
    return ok ? { type: 'object', props } : undefined;
  }

  /**
   * A member: what it sets replaces an earlier member of the key. One that is
   * not a literal (a method, an accessor, a shorthand) sets its key to a
   * value not known; a spread of an object literal sets the members of it, a
   * spread of anything else or a computed key can set any key.
   */
  private property(props: Map<string, Datum | undefined>): void {
    const { src } = this;
    if (src.startsWith('...', this.i)) {
      this.i += 3;
      this.space();
      const spread = src.charAt(this.i) === '{' ? this.record() : undefined;
      this.space();
      if (spread?.type === 'object' && this.atElementEnd()) {
        for (const [key, value] of spread.props) props.set(key, value);
        return;
      }
      props.clear();
    } else {
      let key = this.key();
      this.space();
      if (key !== undefined && src.charAt(this.i) === ':') {
        this.i++;
        props.set(key, this.member());
        return;
      }
      // `get name() {}`, `async name() {}`, `*name() {}`: the key follows
      if (
        MODIFIER_RE.test(key ?? '') &&
        KEY_START_RE.test(src.charAt(this.i))
      ) {
        if (src.charAt(this.i) === '*') this.i++;
        this.space();
        key = this.key();
      }
      if (key === undefined) props.clear();
      else props.set(key, undefined);
    }
    // The rest of the member: not a literal
    if (!this.skipMember()) this.fail();
  }

  /** Stop reading: the text cannot be skipped through. */
  private fail(): void {
    this.failed = true;
  }
}

/**
 * The text with everything but code (strings, comments, regexes) blanked, and
 * where its regex literals are.
 */
function codeOnly(source: string): {
  code: string;
  regexes: Map<number, number>;
} {
  const chars = Array.from({ length: source.length }, () => ' ');
  const regexes = regexLiterals(source, 'statements', {
    code(ch, index) {
      for (let k = 0; k < ch.length; k++) chars[index + k] = ch[k]!;
    },
  });
  return { code: chars.join(''), regexes };
}

const stringOf = (d: Datum | undefined) =>
  d?.type === 'string' ? d : undefined;
const booleanOf = (d: Datum | undefined) =>
  d?.type === 'boolean' ? d.value : undefined;
const textOf = (d: Datum | undefined) => stringOf(d)?.value;
const stringsOf = (d: Datum | undefined): string[] =>
  d?.type === 'array'
    ? d.items.flatMap((item) => stringOf(item)?.value ?? [])
    : [];

/** `{ [key]: value }` if `read` finds the property `key` written out, else `{}`. */
function written<K extends string, T>(
  props: ReadonlyMap<string, Datum | undefined>,
  key: K,
  read: (datum: Datum | undefined) => T | undefined,
): { [P in K]?: T } {
  const value = read(props.get(key));
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: T };
}

/** A declared parameter, if its name and type are written out. */
function parameterOf(datum: Datum | undefined): ParameterDef | undefined {
  if (datum?.type !== 'object') return undefined;
  const { props } = datum;
  const name = stringOf(props.get('name'));
  const type = stringOf(props.get('type'));
  if (!name || !type) return undefined;
  const param: ParameterDef = {
    name: name.value,
    type: type.value as ParameterType,
    ...written(props, 'required', booleanOf),
    ...written(props, 'description', textOf),
    ...written(props, 'holds', (d) => textOf(d) as StringHolds | undefined),
  };
  if (props.has('parameters')) {
    const options = parametersOf(props.get('parameters'));
    if (!options) return undefined;
    param.parameters = options;
  }
  return param;
}

/** The parameters of an array literal of them, if every one is written out. */
function parametersOf(datum: Datum | undefined): ParameterDef[] | undefined {
  if (datum?.type !== 'array') return undefined;
  const params: ParameterDef[] = [];
  for (const item of datum.items) {
    const param = parameterOf(item);
    if (!param) return undefined;
    params.push(param);
  }
  return params;
}

/** The macro a config object declares, if its name is written out. */
function macroOf(config: Datum): DiscoveredMacro | undefined {
  if (config.type !== 'object') return undefined;
  const { props } = config;
  const name = stringOf(props.get('name'));
  if (!name?.value) return undefined;
  const subMacros = stringsOf(props.get('subMacros'));
  const block = booleanOf(props.get('block'));
  const macro: DiscoveredMacro = {
    name: name.value,
    block: block === true || (block !== false && subMacros.length > 0),
    subMacros,
    nameStart: name.start,
    nameEnd: name.end,
    ...written(props, 'interpolate', booleanOf),
    ...written(props, 'storeVar', booleanOf),
    ...written(props, 'merged', booleanOf),
    ...written(props, 'description', textOf),
  };
  // Arguments are read by their parameters: a list that is not entirely
  // written out, or that defineMacro would refuse, declares none
  const parameters = parametersOf(props.get('parameters'));
  if (parameters) {
    try {
      checkParameterTypes(macro.name, parameters);
      macro.parameters = parameters;
    } catch {
      // defineMacro throws for it: the macro is not registered with them
    }
  }
  return macro;
}

/**
 * The macros the `defineMacro({ … })` and `Story.defineMacro({ … })` calls in
 * `source` (JavaScript: a script passage, the body of a `{do}`, a project
 * file) declare, in source order, read from the text without running it. A
 * call whose config is an object literal (or a variable declared as one with
 * `const`, `let` or `var` that the call sees, see Bindings: not a parameter, a
 * pattern or an assignment of the name, or a write to a property the macro
 * is read from) and whose `name` is a string is found,
 * wherever it is, even inside a function. Only what is written out is read: a `block`,
 * `interpolate`, `storeVar` or `merged` that is a boolean literal, the
 * strings of `subMacros`, and `parameters` when every one is an object
 * literal with a string `name` and `type` (and `holds`, `required`,
 * `description` and nested `parameters` of options when written out as such);
 * a later member that sets one of these again (a spread, a method, an
 * accessor, a computed key) replaces it; a list with a parameter that is not,
 * or that `defineMacro` would refuse, declares none. It is tolerant: text it cannot read is skipped, and it
 * throws for none.
 */
export function discoverMacros(source: string): DiscoveredMacro[] {
  const { code, regexes } = codeOnly(source);
  const found: DiscoveredMacro[] = [];
  const configs = new Map<number, Datum | undefined>();
  let bindings: Bindings | undefined;
  for (const call of code.matchAll(CALL_RE)) {
    let at = call.index + call[0].length;
    if (code.charAt(at) !== '{') {
      const variable = IDENTIFIER_ARGUMENT_RE.exec(code.slice(at))?.[1];
      if (!variable) continue;
      bindings ??= new Bindings(code);
      const object = bindings.objectOf(variable, call.index, CONFIG_KEYS);
      if (object === undefined) continue;
      at = object;
    }
    if (!configs.has(at)) {
      const reader = new ConfigReader(source, { goal: 'statements', regexes });
      reader.i = at;
      configs.set(at, reader.datum());
    }
    const config = configs.get(at);
    const macro = config && macroOf(config);
    if (macro) found.push(macro);
  }
  return found;
}
