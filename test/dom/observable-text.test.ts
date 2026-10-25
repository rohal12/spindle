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
