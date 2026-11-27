// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { Passage } from '../../src/components/Passage';
import { PassageDialog } from '../../src/components/PassageDialog';
import { useStoryStore } from '../../src/store';
import {
  clearActions,
  resetIdCounters,
  registerAction,
  type StoryAction,
} from '../../src/action-registry';
import {
  observableErrors,
  observableText,
} from '../../src/observe/observable-text';

function fixture(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

function text(html: string): string {
  return observableText(fixture(html));
}

function register(action: Partial<StoryAction> & Pick<StoryAction, 'id'>) {
  registerAction({
    type: 'textbox',
    label: '',
    perform: () => {},
    ...action,
  });
}

describe('observableText', () => {
  beforeEach(() => clearActions());
  afterEach(() => clearActions());

  describe('layout', () => {
    it('bounds trimming of interior preformatted whitespace (#792)', () => {
      const line = '  a' + ' '.repeat(120_000) + 'z';
      const root = fixture('<pre>\n' + line + '\t \n\n</pre>');
      const start = performance.now();
      expect(observableText(root)).toBe(line);
      expect(performance.now() - start).toBeLessThan(1000);
    });

    it('puts blocks on separate lines', () => {
      expect(text('<p>A</p><p>B</p>')).toBe('A\nB');
    });

    it('breaks a line at <br>', () => {
      expect(text('<div>A<br>B</div>')).toBe('A\nB');
    });

    it('leaves no more than one blank line around empty blocks', () => {
      expect(
        text(
          '<div><div>A</div><div></div><div><p></p></div><div>B</div></div>',
        ),
      ).toBe('A\nB');
      expect(text('<p>A</p><br><br><br><br><p>B</p>')).toBe('A\n\nB');
    });

    it('keeps the indentation of preformatted lines', () => {
      expect(text('<p>A</p><pre>  if (x) {\n    y();\n  }</pre>')).toBe(
        'A\n  if (x) {\n    y();\n  }',
      );
    });

    it('reads inline elements as part of the line', () => {
      expect(text('<p>Go <a>north</a> now</p>')).toBe('Go north now');
    });

    it('collapses the whitespace of the source', () => {
      expect(text('<ul>\n  <li>One</li>\n  <li>Two   words</li>\n</ul>')).toBe(
        'One\nTwo words',
      );
    });
  });

  describe('hidden content', () => {
    it('resolves same-document SVG URLs against the element base URL (#764)', () => {
      const doc = document.implementation.createHTMLDocument('SVG');
      // A base may point away from this document: even a bare fragment then
      // references an external document and must not expose local definitions.
      const base = doc.createElement('base');
      base.href = 'https://example.test/elsewhere.svg';
      doc.head.append(base);
      doc.body.innerHTML =
        '<svg><defs><text id="label">Local</text><text id="external">External</text></defs>' +
        '<use href="#external"/><use href="' +
        doc.URL +
        '#label"/></svg>';
      expect(observableText(doc.body)).toBe('Local');
    });

    it('inherits SVG use visibility without running cloned custom elements', () => {
      let constructions = 0;
      customElements.define(
        'observation-svg-label',
        class extends HTMLElement {
          constructor() {
            super();
            constructions++;
          }
        },
      );
      const el = fixture(
        '<svg><defs style="visibility:hidden">' +
          '<g id="labels"><text>Inherited</text>' +
          '<foreignObject><observation-svg-label style="visibility:visible">Explicit</observation-svg-label></foreignObject></g>' +
          '</defs><use href="#labels" style="visibility:visible"/>' +
          '<use href="#labels" style="visibility:hidden"/></svg>',
      );
      const before = constructions;
      expect(observableText(el)).toBe('InheritedExplicitExplicit');
      expect(observableText(el)).toBe('InheritedExplicitExplicit');
      expect(constructions).toBe(before);
    });

    it('expands local SVG use instances at their rendered positions (#764)', () => {
      const el = fixture(
        '<svg><defs style="display:none">' +
          '<text id="label">Label</text><text id="unused">Unused</text>' +
          '<symbol id="icon"><text>Icon</text></symbol>' +
          '<g id="cycle"><use href="#cycle"/></g></defs>' +
          '<text>Before </text><use href="#label"/><text> Between </text>' +
          '<use href="#label"/><use href="#icon"/><use href="#cycle"/>' +
          '<use href="#label" style="display:none"/>' +
          '<use href="#label" style="visibility:hidden"/>' +
          '<use href="elsewhere.svg#label"/><use href="#missing"/>' +
          '<text> After</text></svg>',
      );
      expect(observableText(el)).toBe('Before Label Between LabelIcon After');
    });

    it('omits SVG metadata and definitions but keeps drawn text and foreign HTML (#742)', () => {
      const el = fixture(
        '<svg><title>Map title</title><desc>Map description</desc>' +
          '<metadata>Export details</metadata><defs><text>Unused</text></defs>' +
          '<symbol><text>Symbol</text></symbol><clipPath><text>Clip</text></clipPath>' +
          '<mask><text>Mask</text></mask><pattern><text>Pattern</text></pattern>' +
          '<marker><text>Marker</text></marker><text>Visible</text>' +
          '<foreignObject></foreignObject></svg>',
      );
      // Construct the HTML integration point explicitly: happy-dom's innerHTML
      // currently gives foreignObject descendants the SVG namespace.
      const html = document.createElement('div');
      html.innerHTML = 'HTML <span title="Tooltip">text</span>';
      el.querySelector('foreignObject')!.append(html);
      expect(observableText(el)).toBe('Visible\nHTML text');
    });

    it.each([
      ['hidden', '<p hidden>x</p>'],
      ['display:none', '<p style="display:none">x</p>'],
      ['display: none !important', '<p style="display: none !important">x</p>'],
      [
        'display: none after another declaration',
        '<p style="color:red; display: none">x</p>',
      ],
      ['aria-hidden', '<p aria-hidden="true">x</p>'],
    ])('skips an element with %s', (_name, html) => {
      expect(text(`<p>A</p>${html}<p>B</p>`)).toBe('A\nB');
    });

    it('skips what is inside a hidden element', () => {
      expect(text('<div hidden><p>x <b>y</b></p></div>')).toBe('');
    });

    it('keeps aria-hidden="false"', () => {
      expect(text('<p aria-hidden="false">x</p>')).toBe('x');
    });
  });

  describe('controls', () => {
    it('reads edited native fields without registering actions (#743)', () => {
      const el = fixture(
        '<textarea>Original</textarea> <input value="Before">',
      );
      el.querySelector('textarea')!.value = 'Edited note';
      el.querySelector('input')!.value = 'After';
      expect(observableText(el)).toBe(
        '[textarea: "Edited note"] [input: "After"]',
      );
    });

    it('describes native selected labels rather than unselected options (#743)', () => {
      const el = fixture(
        '<select><option value="r">Red</option><option value="b">Blue</option></select> <select multiple><option value="a" selected>Alpha</option><option>Beta</option><option value="g" selected>Gamma</option></select>',
      );
      el.querySelector('select')!.value = 'b';
      expect(observableText(el)).toBe(
        '[select: "Blue"] [select: ["Alpha","Gamma"]]',
      );
      el.querySelector('select')!.selectedIndex = -1;
      expect(observableText(el)).toBe(
        '[select: ""] [select: ["Alpha","Gamma"]]',
      );
    });

    it('describes native checkedness and omits hidden controls (#743)', () => {
      const el = fixture(
        '<input type="checkbox"> <input type="radio" name="choice" value="a" checked> <input type="radio" name="choice" value="b"> <input type="hidden" value="Secret"><input hidden value="Hidden"><input style="display:none" value="None">',
      );
      el.querySelector('input')!.checked = true;
      el.querySelectorAll('input')[2]!.checked = true;
      expect(observableText(el)).toBe(
        '[checkbox: checked] [radio = "a": unselected] [radio = "b": selected]',
      );
    });

    it('uses option text when the label attribute is empty (#743)', () => {
      expect(
        text(
          '<select><option label="">Blue</option></select> <select><option label="Shown">Other text</option></select>',
        ),
      ).toBe('[select: "Blue"] [select: "Shown"]');
    });

    it('normalizes native input types before describing checkedness (#743)', () => {
      const el = fixture(
        '<input type="CHECKBOX" checked> <input type="RADIO" checked value="yes">',
      );
      expect(observableText(el)).toBe(
        '[checkbox: checked] [radio = "yes": selected]',
      );
      for (const input of el.querySelectorAll('input')) input.checked = false;
      expect(observableText(el)).toBe(
        '[checkbox: unchecked] [radio = "yes": unselected]',
      );
    });

    it('shows a textbox with its quoted value', () => {
      register({
        id: 'textbox:$name',
        type: 'textbox',
        variable: '$name',
        value: 'Alice',
      });
      expect(
        text('<p>Name: <input data-action="textbox:$name" value="x"></p>'),
      ).toBe('Name: [textbox $name: "Alice"]');
    });

    it('adds the $ to a variable the action names without it', () => {
      register({ id: 't', type: 'textbox', variable: 'name', value: 'Al' });
      expect(text('<input data-action="t">')).toBe('[textbox $name: "Al"]');
    });

    it('shows a number unquoted', () => {
      register({
        id: 'n',
        type: 'numberbox',
        variable: '$age',
        value: 7,
      });
      expect(text('<input data-action="n">')).toBe('[numberbox $age: 7]');
    });

    it('shows a checkbox as checked or unchecked', () => {
      register({ id: 'a', type: 'checkbox', variable: '$brave', value: true });
      register({ id: 'b', type: 'checkbox', variable: '$rich', value: false });
      expect(
        text(
          '<label><input type="checkbox" data-action="a"> Brave</label><br><label><input type="checkbox" data-action="b"> Rich</label>',
        ),
      ).toBe(
        '[checkbox $brave: checked] Brave\n[checkbox $rich: unchecked] Rich',
      );
    });

    it('shows a listbox and a cycle with the value of the action', () => {
      register({
        id: 'l',
        type: 'listbox',
        variable: '$weapon',
        value: 'sword',
        options: ['sword', 'axe'],
      });
      register({
        id: 'c',
        type: 'cycle',
        variable: '$armor',
        value: 'mail',
        options: ['mail', 'plate'],
      });
      expect(
        text(
          '<select data-action="l"><option>sword</option><option>axe</option></select>' +
            '<button data-action="c">mail</button>',
        ),
      ).toBe('[listbox $weapon: "sword"][cycle $armor: "mail"]');
    });

    it('skips what is inside a control', () => {
      register({ id: 'c', type: 'cycle', variable: '$a', value: 'x' });
      expect(text('<button data-action="c"><b>shown?</b></button>')).toBe(
        '[cycle $a: "x"]',
      );
    });

    it('falls back to the value of the element without a registered action', () => {
      expect(text('<input data-action="gone" value="typed">')).toBe(
        '[input: "typed"]',
      );
      expect(text('<input type="checkbox" data-action="gone" checked>')).toBe(
        '[checkbox: checked]',
      );
    });

    it('falls back to the element when the action has no value', () => {
      register({ id: 's', type: 'listbox', variable: '$w' });
      expect(
        text(
          '<select data-action="s"><option value="axe" selected>Axe</option></select>',
        ),
      ).toBe('[listbox $w: "axe"]');
    });
  });
});

describe('observableErrors', () => {
  it('omits errors in non-rendered SVG subtrees (#742)', () => {
    const el = fixture(
      '<svg><title class="error">Title</title><defs><text class="error">Unused</text></defs><text class="error">Visible</text><foreignObject><div class="error">HTML</div></foreignObject></svg>',
    );
    expect(observableErrors(el)).toEqual(['Visible', 'HTML']);
  });

  it('returns the trimmed text of each error', () => {
    expect(
      observableErrors(fixture('<div><div class="error">Boom</div></div>')),
    ).toEqual(['Boom']);
    expect(
      observableErrors(
        fixture(
          '<span class="error"> One </span><p><span class="error">Two</span></p>',
        ),
      ),
    ).toEqual(['One', 'Two']);
  });

  it('leaves out the errors the reader cannot see, as observableText does', () => {
    const el = fixture(
      [
        '<div hidden><span class="error">Hidden</span></div>',
        '<div style="display: none"><p><span class="error">None</span></p></div>',
        '<span class="error" aria-hidden="true">Aria</span>',
        '<template><span class="error">Template</span></template>',
        '<span class="error">Shown</span>',
      ].join(''),
    );
    expect(observableErrors(el)).toEqual(['Shown']);
    expect(observableText(el)).toBe('Shown');
  });

  it('returns nothing when there are no errors', () => {
    expect(observableErrors(fixture('<p>fine</p>'))).toEqual([]);
  });

  it('leaves out the errors inside what `skip` matches', () => {
    const el = fixture(
      '<div class="inner"><span class="error">Inner</span><div class="inner"><span class="error">Deeper</span></div></div><span class="error">Outer</span>',
    );
    expect(observableErrors(el, '.inner')).toEqual(['Outer']);
    // The element itself matching `skip` doesn't leave out its own errors
    const inner = el.querySelector('.inner')!;
    expect(observableErrors(inner, '.inner')).toEqual(['Inner']);
  });
});

describe('observableText with skip', () => {
  it('leaves out what `skip` matches, but not the element itself', () => {
    const el = fixture(
      '<p class="box">Kept <span class="box">left out</span></p>',
    );
    expect(observableText(el, '.box span')).toBe('Kept');
    expect(observableText(el.querySelector('p')!, '.box')).toBe('Kept');
  });
});

describe('rendered controls', () => {
  beforeEach(() => {
    clearActions();
    resetIdCounters();
  });
  afterEach(() => clearActions());

  function passageText(content: string): string {
    const container = document.createElement('div');
    render(
      h(Passage, {
        passage: { pid: 1, name: 'T', tags: [], metadata: {}, content },
      }),
      container,
    );
    return observableText(container);
  }

  it.each([
    ['{textbox $name "Your name"}', '[textbox $name: "Alice"]'],
    ['{textarea $name}', '[textarea $name: "Alice"]'],
    ['{checkbox $brave "Brave"}', '[checkbox $brave: checked] Brave'],
    [
      '{radiobutton $name "Alice" "Pick"}',
      '[radiobutton $name = "Alice": selected] Pick',
    ],
    [
      '{listbox $name}{option "Alice"}{option "Bob"}{/listbox}',
      '[listbox $name: "Alice"]',
    ],
    [
      '{cycle $name}{option "Alice"}{option "Bob"}{/cycle}',
      '[cycle $name: "Alice"]',
    ],
    ['{numberbox $age}', '[numberbox $age: 7]'],
  ])('marks %s', (markup, expected) => {
    useStoryStore.getState().setVariable('name', 'Alice');
    useStoryStore.getState().setVariable('brave', true);
    useStoryStore.getState().setVariable('age', 7);
    expect(passageText(markup)).toBe(expected);
  });

  it('tells the radios of one variable apart', () => {
    useStoryStore.getState().setVariable('c', 'red');
    expect(
      passageText('{radiobutton $c "red" "Red"}{radiobutton $c "blue" "Blue"}'),
    ).toBe(
      '[radiobutton $c = "red": selected] Red[radiobutton $c = "blue": unselected] Blue',
    );
  });

  it('names the passage of a dialog panel', () => {
    const container = document.createElement('div');
    render(
      h(PassageDialog, { passageName: 'Inventory', onClose: () => {} }),
      container,
    );
    const panel = container.querySelector('[role=dialog]')!;
    expect(panel.getAttribute('data-dialog-passage')).toBe('Inventory');
    // Not taken for the passage element by [data-passage] selectors
    expect(panel.hasAttribute('data-passage')).toBe(false);
  });
});

describe('observation visibility and value boundaries (#554, #556, #558)', () => {
  it('reads only the first summary of closed details, including nested details', () => {
    const el = fixture(
      '<details><summary>Hint <span class="error">Summary error</span></summary>Secret <span class="error">Hidden error</span><summary>Second</summary><details open><summary>Nested</summary>Nested secret</details></details>',
    );
    expect(observableText(el)).toBe('Hint Summary error');
    expect(observableErrors(el)).toEqual(['Summary error']);
    el.querySelector('details')!.open = true;
    expect(observableText(el)).toContain('Secret');
    expect(observableErrors(el)).toEqual(['Summary error', 'Hidden error']);
    el.querySelector<HTMLDetailsElement>('details details')!.open = false;
    expect(observableText(el)).toContain('Nested');
    expect(observableText(el)).not.toContain('Nested secret');
  });

  it('hides all content of a closed details without a summary', () => {
    const el = fixture(
      '<details>Secret <span class="error">Hidden</span></details>',
    );
    expect(observableText(el)).toBe('');
    expect(observableErrors(el)).toEqual([]);
  });

  it('separates numeric table cells and rows', () => {
    expect(
      text(
        '<table><tr><th>0</th><th>1</th></tr><tr><td>2</td><td>3</td></tr></table>',
      ),
    ).toBe('0\t1\n2\t3');
  });

  it('formats BigInt, cyclic and unprintable action values without throwing', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    for (const [value, shown] of [
      [1n, '1'],
      [cyclic, '[object Object]'],
      [Object.create(null), '{}'],
      [
        {
          toString: null,
          toJSON: () => {
            throw new Error('bad');
          },
        },
        '[unprintable value]',
      ],
    ] as const) {
      register({ id: 'odd', type: 'textbox', variable: 'n', value });
      expect(text('<input data-action="odd">')).toBe(`[textbox $n: ${shown}]`);
    }
    clearActions();
  });
});

it('reads shadow text and errors while excluding unassigned light DOM (#659)', () => {
  const root = fixture(
    '<div id="host"><span class="error">Unslotted error</span></div>',
  );
  root.querySelector('#host')!.attachShadow({ mode: 'open' }).innerHTML =
    'Direct shadow text<p>Shadow paragraph</p><span class="error">Shadow error</span>';
  expect(observableText(root)).toBe(
    'Direct shadow text\nShadow paragraph\nShadow error',
  );
  expect(observableErrors(root)).toEqual(['Shadow error']);
});
