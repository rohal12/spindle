import { expect, it } from 'vitest';
import { splitSigilTemplate } from '../../src/markup/code-attributes';
import {
  completionContext,
  passagePieces,
  variableReferences,
} from '../../src/tooling';

it.each(['$\\u0066oo', '_\\u0066oo', '$\\u{66}oo'])(
  'reads escaped code-attribute root %s consistently (#661)',
  (expr) => {
    expect(splitSigilTemplate(`{${expr}}`)).toEqual([{ expr }]);
    const source = `<b onclick="{${expr}}">x</b>`;
    expect(passagePieces(source)).toMatchObject([{ kind: 'code', code: expr }]);
    if (expr.startsWith('$'))
      expect(variableReferences(source)).toMatchObject([{ name: 'foo' }]);
    const incomplete = `<b onclick="{${expr}.`;
    expect(completionContext(incomplete, incomplete.length)).toMatchObject({
      kind: 'code',
    });
  },
);

it.each(['{$(1)}', '{$\\uZZZZ}', '{_()}'])(
  'keeps nonreferences verbatim: %s',
  (source) => {
    expect(splitSigilTemplate(source)).toEqual([{ verbatim: source }]);
  },
);
