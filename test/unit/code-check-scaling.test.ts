import { expect, it } from 'vitest';
import { codeAndText, parameterLookup } from '../../src/code-check';
import { tokenizeMarkupTolerant } from '../../src/markup/parse';
import { getMacroRegistry } from '../../src/registry';
import { passagePieces, validateStoryMarkup } from '../../src/tooling';

const macros = getMacroRegistry();
const parametersOf = parameterLookup(macros);

it.each(['{do}0;{/do}\n', '{dialog "Open"}Target{/dialog}\n'])(
  'scans repeated valid %j bodies with bounded token visits (#600)',
  (block) => {
    const count = 4000;
    const source = block.repeat(count);
    const { tokens } = tokenizeMarkupTolerant(source);
    let visits = 0;
    const observed = new Proxy(tokens, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) visits++;
        return Reflect.get(target, key, receiver);
      },
    });
    const pieces = [...codeAndText(source, observed, parametersOf)];
    const kind = block.startsWith('{do}') ? 'code' : 'passage';
    expect(pieces.filter((p) => p.kind === kind)).toHaveLength(count);
    expect(visits).toBeLessThan(tokens.length * 5);
    // Check the public tooling and startup-validation paths too.
    expect(passagePieces(source, macros)).toEqual(pieces);
    expect(
      validateStoryMarkup(
        [
          { name: 'Start', content: source },
          { name: 'Target', content: '' },
        ],
        macros,
      ),
    ).toEqual([]);
  },
);

it('finds only the inner plain-text dialog body in nested dialogs (#600)', () => {
  const source =
    '{dialog "Outer"}before {dialog "Inner"}Target{/dialog} after{/dialog}' +
    '{dialog "Next"}Other{/dialog}{Do}const x = 1;{/Do}';
  const pieces = passagePieces(source, macros);
  expect(pieces.filter((p) => p.kind === 'passage').map((p) => p.name)).toEqual(
    ['Target', 'Other'],
  );
  expect(pieces.filter((p) => p.kind === 'code').map((p) => p.code)).toEqual([
    'const x = 1;',
  ]);
});
