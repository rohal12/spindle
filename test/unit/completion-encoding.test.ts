import { expect, it } from 'vitest';
import { getMacroRegistry } from '../../src/registry';
import {
  completionContext,
  passagePieces,
  pieceOffset,
  validateStoryMarkup,
  type ToolingMacro,
} from '../../src/tooling';

const macros = getMacroRegistry();

it('exposes the quote needed to encode a completion in an unfinished label (#651)', () => {
  const source = '{button "{print $obj.';
  const context = completionContext(source, source.length, macros);
  expect(context).toMatchObject({
    kind: 'code',
    code: '$obj.',
    containers: [{ kind: 'string', quote: '"', escapes: 'quotes' }],
  });
  if (context.kind !== 'code') return;
  let replacement = '["first-name"]';
  for (const container of [...(context.containers ?? [])].reverse()) {
    if (container.kind === 'string' && container.escapes === 'quotes')
      replacement = replacement.replace(/[\\'"]/g, '\\$&');
  }
  const start = pieceOffset(context, context.cursor - 1);
  const completed = source.slice(0, start) + replacement + '}"}x{/button}';
  expect(
    validateStoryMarkup([{ name: 'Start', content: completed }], macros),
  ).toEqual([]);
  expect(passagePieces(completed, macros)).toMatchObject([
    { kind: 'text' },
    { kind: 'code', code: '$obj["first-name"]' },
  ]);
});

it('retains outer-to-inner attribute, string and link ownership (#651)', () => {
  const source = `<span title='{button "{print $obj.`;
  expect(completionContext(source, source.length, macros)).toMatchObject({
    kind: 'code',
    containers: [
      { kind: 'attribute', name: 'title', quote: "'", code: false },
      { kind: 'string', quote: '"', escapes: 'quotes' },
    ],
  });
  const label = '[[Go {print $obj.';
  expect(completionContext(label, label.length, macros)).toMatchObject({
    kind: 'code',
    containers: [{ kind: 'link-label' }],
  });
  const event = '<a onclick="{$obj.';
  expect(completionContext(event, event.length, macros)).toMatchObject({
    kind: 'code',
    containers: [
      { kind: 'attribute', name: 'onclick', quote: '"', code: true },
    ],
  });
});

it('keeps decoded widget offsets across CRLF and JavaScript escapes (#651)', () => {
  const custom: ToolingMacro[] = [
    ...macros,
    {
      name: 'Card',
      block: false,
      subMacros: [],
      widget: { params: ['@label'], holds: { '@label': 'markup' } },
    },
  ];
  const source = '\r\n{Card "\\x7bprint \\"x\\" + $obj.';
  const context = completionContext(source, source.length, custom);
  expect(context).toMatchObject({
    kind: 'code',
    code: '"x" + $obj.',
    containers: [{ kind: 'string', quote: '"', escapes: 'javascript' }],
  });
  if (context.kind !== 'code') return;
  expect(pieceOffset(context, 0)).toBe(source.indexOf('\\"'));
  expect(pieceOffset(context, context.code.indexOf('$'))).toBe(
    source.indexOf('$'),
  );
  expect(pieceOffset(context, context.cursor)).toBe(source.length);
});

it('records code-holding string encodings and leaves top-level contexts unchanged (#651)', () => {
  const source = "{watch '$obj.";
  expect(completionContext(source, source.length, macros)).toMatchObject({
    kind: 'code',
    containers: [{ kind: 'string', quote: "'", escapes: 'quotes' }],
  });
  const plain = '{$obj.';
  expect(completionContext(plain, plain.length, macros)).not.toHaveProperty(
    'containers',
  );
});
