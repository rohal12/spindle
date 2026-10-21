import { describe, expect, it } from 'vitest';
import {
  effectiveWidgetDefinitions,
  macroArgumentSpans,
  parseCode,
  widgetDefinitions,
} from '../../src/tooling';
import type { ParameterDef } from '../../src/registry';

const roles = (source: string) =>
  parseCode(source, 'statements').refs.map((ref) => [
    source.slice(ref.start, ref.end),
    ref.read,
    ref.write,
  ]);

describe('public executable read/write roles (#574)', () => {
  it.each([
    [
      '_x = n; [_x] = [2]',
      [
        ['_x', false, true],
        ['_x', false, true],
      ],
    ],
    [
      '_x = n; ({a:_x} = {a:2})',
      [
        ['_x', false, true],
        ['_x', false, true],
      ],
    ],
    [
      '[_y = _x] = []',
      [
        ['_y', false, true],
        ['_x', true, false],
      ],
    ],
    [
      '({[_x]: _y} = obj)',
      [
        ['_x', true, false],
        ['_y', false, true],
      ],
    ],
    [
      '_x += 1; ++_x; _x--',
      [
        ['_x', true, true],
        ['_x', true, true],
        ['_x', true, true],
      ],
    ],
    [
      '_x.field = 2; [_x[_i]] = [1]',
      [
        ['_x', true, false],
        ['_x', true, false],
        ['_i', true, false],
      ],
    ],
    [
      '[_x = _x + 1] = []',
      [
        ['_x', false, true],
        ['_x', true, false],
      ],
    ],
    [
      '({a: [_x = _d, ..._rest], ..._obj} = _source)',
      [
        ['_x', false, true],
        ['_d', true, false],
        ['_rest', false, true],
        ['_obj', false, true],
        ['_source', true, false],
      ],
    ],
    [
      '({_x = _d} = _obj)',
      [
        ['_x', false, true],
        ['_d', true, false],
        ['_obj', true, false],
      ],
    ],
    [
      'for ([_x] of _rows) { _x; }',
      [
        ['_x', false, true],
        ['_rows', true, false],
        ['_x', true, false],
      ],
    ],
    [
      'for (_x in _obj) {}',
      [
        ['_x', false, true],
        ['_obj', true, false],
      ],
    ],
    [
      '`literal _no ${_x = _y} ${_z++}`',
      [
        ['_x', false, true],
        ['_y', true, false],
        ['_z', true, true],
      ],
    ],
  ])('%s', (source, expected) => {
    expect(roles(source)).toEqual(expected);
  });

  it('distinguishes binding deletion from member deletion and other unary reads', () => {
    expect(roles('delete _x; delete _x.field; typeof _x; void _x')).toEqual([
      ['_x', false, true],
      ['_x', true, false],
      ['_x', true, false],
      ['_x', true, false],
    ]);
  });

  it('reports UTF-16 spans and all four sigils without property names', () => {
    const source =
      '"😀"; [$story, @local, %transient] = [_temporary]; obj._field';
    const refs = parseCode(source, 'statements').refs;
    expect(refs.map((r) => source.slice(r.start, r.end))).toEqual([
      '$story',
      '@local',
      '%transient',
      '_temporary',
    ]);
    expect(refs[0]!.start).toBe(source.indexOf('$story'));
    expect(refs.slice(0, 3).every((r) => r.write && !r.read)).toBe(true);
  });

  it.each(['[_x] =', '({ a: _x }', 'let _x = 1', 'function f({_x}) {}'])(
    'rejects malformed or forbidden code: %s',
    (source) => {
      expect(() => parseCode(source, 'statements')).toThrow();
    },
  );
});

describe('effective widget identity (#610)', () => {
  it.each([false, true])(
    'selects StoryInit regardless of passage order (%s)',
    (reverse) => {
      const passages = [
        {
          name: 'StoryInit',
          content: '{widget "caption" @v}INIT:{@v}{/widget}',
        },
        {
          name: 'Widgets',
          tags: ['widget'],
          content: '{widget "CAPTION" @v:markup}TAGGED:{@v}{/widget}',
        },
      ];
      if (reverse) passages.reverse();
      const definitions = widgetDefinitions(passages);
      const chosen = effectiveWidgetDefinitions(definitions);
      expect(chosen).toHaveLength(1);
      expect(chosen[0]).toBe(
        definitions.find((d) => d.passage === 'StoryInit'),
      );
      expect(chosen[0]!.holds).toBeUndefined();
    },
  );

  it('ignores an unclosed StoryInit override', () => {
    const definitions = widgetDefinitions([
      { name: 'StoryInit', content: '{widget "caption" @v:passage}unfinished' },
      {
        name: 'Widgets',
        tags: ['widget'],
        content: '{widget "Caption" @v:text}OK{/widget}',
      },
    ]);
    expect(effectiveWidgetDefinitions(definitions)).toEqual([definitions[1]]);
    expect(effectiveWidgetDefinitions(definitions)[0]).toBe(definitions[1]);
  });

  it('keeps closed overrides and source identities with duplicate passage names', () => {
    const sources = [
      { file: 'a.twee', content: '{widget "Caption" @v:text}A{/widget}' },
      {
        file: 'b.twee',
        content:
          '{widget "caption" @v:markup}B{/widget}{widget "CAPTION" @v:passage}unfinished',
      },
    ];
    const origin = new Map();
    const definitions = sources.flatMap(({ file, content }) => {
      const defs = widgetDefinitions([
        { name: 'Widgets', tags: ['widget'], content },
      ]);
      for (const definition of defs) origin.set(definition, file);
      return defs;
    });
    expect(definitions).toHaveLength(3);
    const [chosen] = effectiveWidgetDefinitions(definitions);
    expect(chosen).toBe(definitions[1]);
    expect(origin.get(chosen)).toBe('b.twee');
    expect(chosen!.holds).toEqual({ '@v': 'markup' });
    expect(effectiveWidgetDefinitions([...definitions].reverse())[0]).toBe(
      definitions[0],
    );
    expect(effectiveWidgetDefinitions([definitions[2]!])).toEqual([]);
  });
});

const argumentSummary = (raw: string, parameters: readonly ParameterDef[]) =>
  macroArgumentSpans(raw, parameters).map((span) => [
    span.parameter.name,
    span.parameterIndex,
    span.parameterPath,
    raw.slice(span.start, span.end),
  ]);

describe('runtime parameter spans (#589)', () => {
  const custom = [
    { name: 'label', type: 'string', required: true },
    { name: 'value', type: 'expression', required: true },
  ] as const;

  it('maps the whole expression rather than counting splitArgs terms', () => {
    const raw = ' "😀 label" 1 + 2 $next ';
    const spans = macroArgumentSpans(raw, custom);
    expect(spans.map((s) => raw.slice(s.start, s.end))).toEqual([
      '"😀 label"',
      '1 + 2 $next',
    ]);
    expect(spans[1]!.parameterIndex).toBe(1);
    expect(spans[1]!.parameter).toBe(custom[1]);
  });

  it.each(['"unfinished', 'unquoted 1 +', '"label" (1 +', '"label" '])(
    'retains useful spans while typing %s',
    (raw) => {
      const spans = macroArgumentSpans(raw, custom);
      expect(spans[0]!.parameter).toBe(custom[0]);
      if (raw.includes('1 +')) expect(spans[1]!.parameter).toBe(custom[1]);
      expect(() => macroArgumentSpans('', custom)).not.toThrow();
    },
  );

  it.each(['inline "A"', '"A" inline'])(
    'includes flags at either end: %s',
    (raw) => {
      const params = [
        { name: 'inline', type: 'flag' },
        { name: 'label', type: 'string', required: true },
      ] as const;
      const spans = macroArgumentSpans(raw, params);
      expect(
        spans.find(
          (s) =>
            s.parameterIndex === 0 && raw.slice(s.start, s.end) === 'inline',
        ),
      ).toBeDefined();
      expect(
        spans.find(
          (s) => s.parameterIndex === 1 && raw.slice(s.start, s.end) === '"A"',
        ),
      ).toBeDefined();
    },
  );

  it('maps separators, names and rest text by their declared parameter', () => {
    const params = [
      { name: 'names', type: 'names' },
      { name: 'of', type: 'separator' },
      { name: 'value', type: 'expression' },
    ] as const;
    expect(
      argumentSummary('@item, @i of $rows.filter(x => x.ok)', params),
    ).toEqual([
      ['names', 0, [0], '@item, @i'],
      ['of', 1, [1], 'of'],
      ['value', 2, [2], '$rows.filter(x => x.ok)'],
    ]);
    expect(
      argumentSummary('go north now', [{ name: 'label', type: 'text' }]),
    ).toEqual([['label', 0, [0], 'go north now']]);
  });

  it('includes keyword options, nested identities and incomplete values', () => {
    const params = [
      {
        name: 'options',
        type: 'options',
        parameters: [
          { name: 'goto', type: 'string' },
          { name: 'priority', type: 'number' },
          { name: 'once', type: 'flag' },
        ],
      },
    ] as const;
    expect(argumentSummary('goto "Hall" priority 3 once', params)).toEqual([
      ['options', 0, [0], 'goto "Hall" priority 3 once'],
      ['goto', 0, [0, 0], 'goto "Hall"'],
      ['priority', 0, [0, 1], 'priority 3'],
      ['once', 0, [0, 2], 'once'],
    ]);
    const spans = macroArgumentSpans('goto once', params);
    expect(spans.map((s) => s.parameter)).toEqual([
      params[0],
      ...params[0].parameters.filter((p) => p.name !== 'priority'),
    ]);
  });

  it('maps an unfinished separator and trailing quoted parameter', () => {
    expect(
      argumentSummary('@item of', [
        { name: 'names', type: 'names' },
        { name: 'of', type: 'separator' },
        { name: 'value', type: 'expression' },
      ]),
    ).toEqual([
      ['names', 0, [0], '@item'],
      ['of', 1, [1], 'of'],
    ]);
    expect(
      argumentSummary('$hp "HP', [
        { name: 'value', type: 'expression' },
        { name: 'label', type: 'string' },
      ]),
    ).toEqual([
      ['value', 0, [0], '$hp'],
      ['label', 1, [1], '"HP'],
    ]);
  });

  it('keeps an unquoted trailing term in the expression', () => {
    const params = [
      { name: 'value', type: 'expression' },
      { name: 'label', type: 'string' },
    ] as const;
    expect(argumentSummary('$hp 100', params)).toEqual([
      ['value', 0, [0], '$hp 100'],
    ]);
    expect(argumentSummary('$hp "HP"', params)).toEqual([
      ['value', 0, [0], '$hp'],
      ['label', 1, [1], '"HP"'],
    ]);
  });
});
