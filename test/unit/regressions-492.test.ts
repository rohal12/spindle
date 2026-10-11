import { describe, it, expect } from 'vitest';
import { evaluate, execute, transform } from '../../src/expression';
import { BINDINGS, FNS_BINDING } from '../../src/transform';
import { parseCode } from '../../src/js-lexer';
import { validateMarkup } from '../../src/markup/validate';
import { getMacro, getMacroRegistry, isSubMacro } from '../../src/registry';

// Authored JavaScript may declare any identifier; the names the generated
// code reads the sigil namespaces through must not capture (or clash with)
// them (#492).

describe('sigil references and authored bindings of the same name (#492)', () => {
  it('a local object named `variables` does not capture $name', () => {
    expect(
      evaluate(
        '(() => { const variables = {hp: 99}; return $hp; })()',
        { hp: 7 },
        {},
      ),
    ).toBe(7);
  });

  it('a parameter named `variables` does not capture $name', () => {
    expect(evaluate('((variables) => $hp)(null)', { hp: 7 }, {})).toBe(7);
  });

  it.each([
    ['temporary', '_hp'],
    ['locals', '@hp'],
    ['transient', '%hp'],
  ])('a parameter named `%s` does not capture %s', (name, ref) => {
    const held: Record<string, Record<string, unknown>> = {
      temporary: {},
      locals: {},
      transient: {},
      [name]: { hp: 7 },
    };
    expect(
      evaluate(
        `((${name}) => ${ref})(null)`,
        {},
        held.temporary!,
        held.locals!,
        held.transient!,
      ),
    ).toBe(7);
  });

  it('declarations of the names run as ordinary JavaScript', () => {
    const variables: Record<string, unknown> = {};
    execute(
      'const variables = 1, temporary = 2, locals = 3, transient = 4;' +
        ' $sum = variables + temporary + locals + transient',
      variables,
      {},
    );
    expect(variables.sum).toBe(10);
  });

  it('declarations of the history functions run as ordinary JavaScript', () => {
    const variables: Record<string, unknown> = {};
    execute('const random = 4; $r = random', variables, {});
    expect(variables.r).toBe(4);
  });

  it('the generated names are sigil identifiers, which cannot be declared', () => {
    // So no authored binding can equal one (the validation at startup runs
    // the same lexer)
    for (const name of [...Object.values(BINDINGS), FNS_BINDING]) {
      expect(() => parseCode(`const ${name} = 1;`, 'statements')).toThrow(
        /can't be declared/,
      );
      expect(() => parseCode(`((${name}) => 1)`, 'expression')).toThrow(
        /can't be declared/,
      );
    }
  });

  it('the transform reads the namespaces through the generated names', () => {
    expect(transform('$a + _b + @c + %d')).toBe(
      `${BINDINGS.$}["a"] + ${BINDINGS._}["b"] + ${BINDINGS['@']}["c"] + ${BINDINGS['%']}["d"]`,
    );
  });
});

describe('startup validation agrees with execution (#492)', () => {
  it('{do} may declare the names the namespaces used to be passed as', () => {
    const passage = { name: 'Start', content: '{do}const variables = 1;{/do}' };
    expect(
      validateMarkup([passage], {
        isKnownMacro: (name) => !!getMacro(name) || isSubMacro(name),
        macroNames: getMacroRegistry().map((m) => m.name),
      }),
    ).toEqual([]);
    expect(() => execute('const variables = 1;', {}, {})).not.toThrow();
  });
});
