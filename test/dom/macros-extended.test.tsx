// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import {
  clearActions,
  resetIdCounters,
  getActions,
} from '../../src/action-registry';
import { clearWidgets, getWidget } from '../../src/widgets/widget-registry';
import {
  PassageDialog,
  DialogCloseContext,
} from '../../src/components/PassageDialog';
import { defineMacro } from '../../src/define-macro';
import type { StoryData, Passage as PassageData } from '../../src/parser';

function makePassage(
  pid: number,
  name: string,
  content: string,
  tags: string[] = [],
): PassageData {
  return { pid, name, tags, metadata: {}, content };
}

function makeStoryData(passages: PassageData[], startNode = 1): StoryData {
  const byName = new Map(passages.map((p) => [p.name, p]));
  const byId = new Map(passages.map((p) => [p.pid, p]));
  return {
    name: 'Test Story',
    startNode,
    ifid: 'test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: byName,
    passagesById: byId,
    userCSS: '',
    userScript: '',
  };
}

function renderPassage(content: string, storyData?: StoryData): HTMLElement {
  const passage = makePassage(1, 'Test', content);
  if (storyData) {
    // Ensure our test passage is in the story data
    if (!storyData.passages.has('Test')) {
      storyData.passages.set('Test', passage);
      storyData.passagesById.set(1, passage);
    }
  }
  const container = document.createElement('div');
  render(<Passage passage={passage} />, container);
  return container;
}

describe('extended macro components', () => {
  beforeEach(async () => {
    clearActions();
    resetIdCounters();
    clearWidgets();
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Start'),
      makePassage(2, 'Room', 'A room'),
      makePassage(3, 'End', 'The end'),
      makePassage(4, 'Helper', 'Included content here'),
      makePassage(5, 'Markdown', '**bold** text'),
      makePassage(
        6,
        'TestPanel',
        '<div class="row">\n  <span class="a">Alpha</span>\n  <span class="b">Beta</span>\n</div>\n<div class="row">\n  <span class="c">Gamma</span>\n</div>',
        ['nobr'],
      ),
      makePassage(7, 'Help', 'Help content here'),
      makePassage(8, 'inline', '**INCLUDED**'),
      makePassage(9, 'An inline example', '**Example**'),
    ]);
    useStoryStore.getState().init(storyData);
    // Earlier tests leave mounted components whose effects count renders:
    // let them run, then start the counts afresh
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    useStoryStore.getState().init(storyData);
  });

  describe('{switch}/{case}/{default}', () => {
    it('renders matching case branch', () => {
      useStoryStore.getState().setVariable('color', 'red');
      const el = renderPassage(
        '{switch $color}{case "red"}Red!{case "blue"}Blue!{/switch}',
      );
      expect(el.textContent).toContain('Red!');
      expect(el.textContent).not.toContain('Blue!');
    });

    it('renders default when no case matches', () => {
      useStoryStore.getState().setVariable('color', 'green');
      const el = renderPassage(
        '{switch $color}{case "red"}Red{default}Other{/switch}',
      );
      expect(el.textContent).toContain('Other');
      expect(el.textContent).not.toContain('Red');
    });

    it('renders nothing when no match and no default', () => {
      useStoryStore.getState().setVariable('color', 'green');
      const el = renderPassage(
        '{switch $color}{case "red"}Red{case "blue"}Blue{/switch}',
      );
      expect(el.textContent).not.toContain('Red');
      expect(el.textContent).not.toContain('Blue');
    });

    it('shows error for invalid switch expression', () => {
      const el = renderPassage('{switch $x +}{case "a"}A{/switch}');
      expect(el.querySelector('.error')).not.toBeNull();
    });

    it('shows error for invalid case expression', () => {
      useStoryStore.getState().setVariable('x', 1);
      const el = renderPassage('{switch $x}{case +++}A{/switch}');
      expect(el.querySelector('.error')).not.toBeNull();
    });
  });

  describe('{type}', () => {
    it('reveals text that becomes nonempty after mounting', async () => {
      useStoryStore.getState().setVariable('name', '');
      const el = renderPassage('{type 1ms}{$name}{/type}');
      const inner = () =>
        el.querySelector('.macro-type-inner') as HTMLElement | null;
      expect(inner()!.style.visibility).toBe('hidden');
      await act(async () => {
        useStoryStore.getState().setVariable('name', 'Hello');
      });
      for (let i = 0; i < 20; i++) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 10));
        });
      }
      expect(inner()!.textContent).toBe('Hello');
      expect(inner()!.style.visibility).toBe('visible');
      expect(el.querySelector('.macro-type-done')).not.toBeNull();
    });
  });

  describe('{include}', () => {
    it('includes another passage inline', () => {
      const el = renderPassage('{include "Helper"}');
      expect(el.textContent).toContain('Included content here');
    });

    it('shows error for missing passage', () => {
      const el = renderPassage('{include "Nonexistent"}');
      expect(el.querySelector('.error')!.textContent).toBe(
        '{include error: No passage named "Nonexistent" (in passage "Start")}',
      );
    });

    it('shows an error for an expression naming no passage', () => {
      useStoryStore.getState().setVariable('part', 'Nowhere');
      const el = renderPassage('Before {include $part} after');
      expect(el.querySelector('.error')!.textContent).toBe(
        '{include error: No passage named "Nowhere" (in passage "Start")}',
      );
      expect(el.textContent).toContain('after');
    });

    it('shows an error for an expression that throws, with no text fallback', () => {
      const el = renderPassage('{include $missing.part}');
      expect(el.querySelector('.error')!.textContent).toMatch(
        /^\{include error: .*undefined/,
      );
    });

    it('tracks render count for included passage', async () => {
      await act(async () => {
        renderPassage('{include "Helper"}');
      });
      expect(useStoryStore.getState().renderCounts['Helper']).toBe(1);
    });

    it('does not count an included passage again on an unrelated update', async () => {
      await act(async () => {
        renderPassage('{include "Helper"}');
      });
      await act(async () => {
        useStoryStore.getState().updateVariables((d) => {
          d.variables.unrelated = 1;
        });
      });
      expect(useStoryStore.getState().renderCounts['Helper']).toBe(1);
    });

    it('renders without markdown when inline flag is set', () => {
      const el = renderPassage('{include "Markdown" inline}');
      expect(el.querySelector('strong')).toBeNull();
      expect(el.textContent).toContain('**bold** text');
    });

    // Issue #201: the flag was stripped from anywhere in the arguments
    it('includes a passage named "inline" (#201)', () => {
      const el = renderPassage('{include "inline"}');
      expect(el.querySelector('.error')).toBeNull();
      expect(el.querySelector('strong')!.textContent).toBe('INCLUDED');
    });

    it('keeps "inline" inside a quoted passage name (#201)', () => {
      const el = renderPassage('{include "An inline example"}');
      expect(el.querySelector('.error')).toBeNull();
      expect(el.querySelector('strong')!.textContent).toBe('Example');
    });

    it('applies the flag after a passage named "inline" (#201)', () => {
      const el = renderPassage('{include "inline" inline}');
      expect(el.querySelector('.error')).toBeNull();
      expect(el.querySelector('strong')).toBeNull();
      expect(el.textContent).toContain('**INCLUDED**');
    });

    it('accepts a leading inline flag (#201)', () => {
      const el = renderPassage('{include inline "An inline example"}');
      expect(el.querySelector('.error')).toBeNull();
      expect(el.querySelector('strong')).toBeNull();
      expect(el.textContent).toContain('**Example**');
    });

    it('does not treat "inline" inside an expression as the flag (#201)', () => {
      useStoryStore.getState().setVariable('names', { inline: 'Markdown' });
      const el = renderPassage('{include $names["inline"]}');
      expect(el.querySelector('.error')).toBeNull();
      expect(el.querySelector('strong')!.textContent).toBe('bold');
    });

    it('applies the flag after an expression target (#201)', () => {
      useStoryStore.getState().setVariable('target', 'An inline example');
      const el = renderPassage('{include $target inline}');
      expect(el.querySelector('.error')).toBeNull();
      expect(el.querySelector('strong')).toBeNull();
      expect(el.textContent).toContain('**Example**');
    });

    it('finds the flag after a template literal with quotes in an interpolation', () => {
      const el = renderPassage('{include `Mark${"`".slice(1)}down` inline}');
      expect(el.querySelector('.error')).toBeNull();
      expect(el.querySelector('strong')).toBeNull();
      expect(el.textContent).toContain('**bold** text');
    });

    it('finds the flag after a regex literal containing a quote', () => {
      const el = renderPassage(
        `{include /"/.test('"') ? "Markdown" : "Helper" inline}`,
      );
      expect(el.querySelector('.error')).toBeNull();
      expect(el.querySelector('strong')).toBeNull();
      expect(el.textContent).toContain('**bold** text');
    });

    it('renders with markdown by default', () => {
      const el = renderPassage('{include "Markdown"}');
      expect(el.querySelector('strong')).not.toBeNull();
      expect(el.querySelector('strong')!.textContent).toBe('bold');
    });

    it('respects [nobr] tag on included passage', () => {
      const el = renderPassage(
        '<div class="panel">{include "TestPanel"}</div>',
      );
      const panel = el.querySelector('.panel')!;
      expect(panel.querySelector('p')).toBeNull();
      expect(panel.querySelector('.row .a')!.textContent).toBe('Alpha');
      expect(panel.querySelector('.row .b')!.textContent).toBe('Beta');
      expect(panel.querySelector('.row .c')!.textContent).toBe('Gamma');
    });
  });

  describe('{nobr}', () => {
    it('suppresses <p> wrapping but keeps inline markdown', () => {
      const el = renderPassage('{nobr}**bold** text{/nobr}');
      expect(el.querySelector('p')).toBeNull();
      expect(el.querySelector('strong')).not.toBeNull();
      expect(el.textContent).toContain('bold');
    });

    it('suppresses <p> inside nested HTML elements', () => {
      const el = renderPassage(
        '{nobr}<div class="layout"><div class="inner">text</div></div>{/nobr}',
      );
      expect(el.querySelector('p')).toBeNull();
      expect(el.querySelector('.layout .inner')).not.toBeNull();
    });

    it('propagates into {for} loop body', () => {
      useStoryStore.getState().setVariable('items', ['Alpha', 'Beta']);
      const el = renderPassage(
        '{nobr}{for @item of $items}<span class="trait">{@item}</span>{/for}{/nobr}',
      );
      expect(el.querySelector('p')).toBeNull();
      const traits = el.querySelectorAll('.trait');
      expect(traits.length).toBe(2);
      expect(traits[0]!.textContent).toBe('Alpha');
      expect(traits[1]!.textContent).toBe('Beta');
    });

    it('renders <p> tags by default without {nobr}', () => {
      const el = renderPassage('Some text here');
      expect(el.querySelector('p')).not.toBeNull();
    });
  });

  describe('[nobr] passage tag', () => {
    it('suppresses <p> wrapping for the entire passage', () => {
      const passage = makePassage(10, 'NoBr', '**bold** text', ['nobr']);
      const storyData = makeStoryData([passage], 10);
      useStoryStore.getState().init(storyData);
      const container = document.createElement('div');
      render(<Passage passage={passage} />, container);
      expect(container.querySelector('p')).toBeNull();
      expect(container.querySelector('strong')).not.toBeNull();
    });
  });

  describe('{goto}', () => {
    it('navigates to specified passage', () => {
      renderPassage('{goto "Room"}');
      expect(useStoryStore.getState().currentPassage).toBe('Room');
    });

    it('navigates using expression', () => {
      useStoryStore.getState().setVariable('dest', 'End');
      renderPassage('{goto $dest}');
      expect(useStoryStore.getState().currentPassage).toBe('End');
    });

    it('shows an error naming the passage when an expression names none', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      useStoryStore.getState().setVariable('dest', 'Nowhere');
      let el!: HTMLElement;
      // The error shows on the re-render the failed navigation causes
      act(() => {
        el = renderPassage('{goto $dest}');
      });
      expect(useStoryStore.getState().currentPassage).toBe('Start');
      expect(el.querySelector('.error')!.textContent).toBe(
        '{goto error: No passage named "Nowhere" (in passage "Start")}',
      );
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('Error in {goto}'),
        expect.objectContaining({
          message: 'No passage named "Nowhere" (in passage "Start")',
        }),
      );
      error.mockRestore();
    });

    it('shows the error of an expression that throws, with no text fallback', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      let el!: HTMLElement;
      // The error shows on the re-render the failed navigation causes
      act(() => {
        el = renderPassage('{goto Room}');
      });
      expect(useStoryStore.getState().currentPassage).toBe('Start');
      expect(el.querySelector('.error')!.textContent).toMatch(
        /^\{goto error: .*Room/,
      );
      error.mockRestore();
    });

    it('navigates, and reports a session write error like an error in {do}', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      useStoryStore.getState().setVariable('cb', () => 1);
      renderPassage('{goto "Room"}');
      expect(useStoryStore.getState().currentPassage).toBe('Room');
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('Error in {goto}'),
        expect.objectContaining({
          message: expect.stringContaining('Cannot save a function (at $cb)'),
        }),
      );
      error.mockRestore();
    });
  });

  describe('{unset}', () => {
    it('deletes a story variable', () => {
      useStoryStore.getState().setVariable('gold', 100);
      renderPassage('{unset $gold}');
      expect(useStoryStore.getState().variables.gold).toBeUndefined();
    });

    it('deletes a temporary variable', () => {
      useStoryStore.getState().setTemporary('temp', 'val');
      renderPassage('{unset _temp}');
      expect(useStoryStore.getState().temporary.temp).toBeUndefined();
    });

    it('unsets a @local variable inside a for loop', async () => {
      useStoryStore.getState().setVariable('items', ['hello']);
      let el: HTMLElement;
      act(() => {
        el = renderPassage(
          '{for @item of $items}{unset @item}{print @item === undefined ? "gone" : @item}{/for}',
        );
      });
      // After act(), the re-render from the state update should have completed
      expect(el!.textContent).toContain('gone');
    });

    it('shows an error for a @local outside a locals scope', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      let el!: HTMLElement;
      act(() => {
        el = renderPassage('before {unset @foo} after');
      });
      spy.mockRestore();
      expect(el.textContent).toContain('before');
      expect(el.textContent).toContain('after');
      const error = el.querySelector('.error');
      expect(error).not.toBeNull();
      expect(error!.textContent).toContain('{unset error');
      expect(error!.textContent).toMatch(/@foo/);
    });

    it('shows an error for an argument that is not a variable', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const el = renderPassage('{unset foo}');
      spy.mockRestore();
      const error = el.querySelector('.error');
      expect(error).not.toBeNull();
      expect(error!.textContent).toContain(
        'expects a variable ($name, _name, %name, or @name), got "foo"',
      );
    });
  });

  describe('{link}', () => {
    it('renders a link with display text', () => {
      const el = renderPassage('{link "Click me" "Room"}{/link}');
      const link = el.querySelector('.macro-link');
      expect(link).not.toBeNull();
      expect(link!.textContent).toBe('Click me');
    });

    it('renders a link without passage target', () => {
      const el = renderPassage('{link "Just text"}{/link}');
      const link = el.querySelector('.macro-link');
      expect(link).not.toBeNull();
      expect(link!.textContent).toBe('Just text');
    });

    it('executes child {set} on click and navigates', () => {
      const el = renderPassage(
        '{link "Go" "Room"}{set $clicked = true}{/link}',
      );
      const link = el.querySelector('.macro-link') as HTMLElement;
      link.click();
      expect(useStoryStore.getState().variables.clicked).toBe(true);
      expect(useStoryStore.getState().currentPassage).toBe('Room');
    });

    it('navigates to a passage an expression names', () => {
      useStoryStore.getState().setVariable('dest', 'Room');
      const el = renderPassage('{link "Go" $dest}{/link}');
      (el.querySelector('.macro-link') as HTMLElement).click();
      expect(useStoryStore.getState().currentPassage).toBe('Room');
    });

    it('shows an error in place for a passage that does not exist', () => {
      useStoryStore.getState().setVariable('dest', 'Nowhere');
      const el = renderPassage('{link "Go" $dest}{/link}');
      expect(el.querySelector('.macro-link')).toBeNull();
      expect(el.querySelector('.error')!.textContent).toContain(
        'No passage named "Nowhere"',
      );
    });

    it('shows an error in place for unquoted text', () => {
      const el = renderPassage('{link Go north}{/link}');
      expect(el.querySelector('.macro-link')).toBeNull();
      expect(el.querySelector('.error')!.textContent).toContain(
        'The text must be a quoted string',
      );
    });

    it('registers as an action', () => {
      renderPassage('{link "Test Link" "Room"}{/link}');
      const actions = getActions();
      expect(actions.some((a) => a.type === 'link')).toBe(true);
    });

    it('handles apostrophes in double-quoted passage names', () => {
      useStoryStore
        .getState()
        .init(
          makeStoryData([
            makePassage(1, 'Start', 'Start'),
            makePassage(5, "The Director's Cut", 'Director content'),
          ]),
        );
      const el = renderPassage('{link "Watch" "The Director\'s Cut"}{/link}');
      const link = el.querySelector('.macro-link') as HTMLElement;
      expect(link).not.toBeNull();
      expect(link!.textContent).toBe('Watch');
      link.click();
      expect(useStoryStore.getState().currentPassage).toBe(
        "The Director's Cut",
      );
    });

    it('handles apostrophes in display text', () => {
      const el = renderPassage('{link "It\'s a trap" "Room"}{/link}');
      const link = el.querySelector('.macro-link');
      expect(link).not.toBeNull();
      expect(link!.textContent).toBe("It's a trap");
    });

    it('handles single-quoted args without apostrophes', () => {
      const el = renderPassage("{link 'Click me' 'Room'}{/link}");
      const link = el.querySelector('.macro-link') as HTMLElement;
      expect(link).not.toBeNull();
      expect(link!.textContent).toBe('Click me');
      link.click();
      expect(useStoryStore.getState().currentPassage).toBe('Room');
    });

    it('handles double quotes inside single-quoted args', () => {
      const el = renderPassage("{link 'Say \"hello\"' 'Room'}{/link}");
      const link = el.querySelector('.macro-link');
      expect(link).not.toBeNull();
      expect(link!.textContent).toBe('Say "hello"');
    });
  });

  describe('{back}', () => {
    it('renders a disabled button when no history', () => {
      const el = renderPassage('{back}');
      const btn = el.querySelector('button');
      expect(btn).not.toBeNull();
      expect(btn!.disabled).toBe(true);
    });

    it('renders an enabled button after navigation', () => {
      useStoryStore.getState().navigate('Room');
      const passage = makePassage(2, 'Room', '{back}');
      const container = document.createElement('div');
      render(<Passage passage={passage} />, container);
      const btn = container.querySelector('button');
      expect(btn).not.toBeNull();
      expect(btn!.disabled).toBe(false);
    });
  });

  describe('{forward}', () => {
    it('renders a disabled button at end of history', () => {
      const el = renderPassage('{forward}');
      const btn = el.querySelector('button');
      expect(btn).not.toBeNull();
      expect(btn!.disabled).toBe(true);
    });
  });

  describe('{story-title}', () => {
    it('displays the story title', () => {
      const el = renderPassage('{story-title}');
      expect(el.textContent).toContain('Test Story');
    });
  });

  describe('{listbox}', () => {
    it('renders a select element with options', () => {
      useStoryStore.getState().setVariable('choice', 'a');
      const el = renderPassage(
        '{listbox $choice}{option "a"}{option "b"}{option "c"}{/listbox}',
      );
      const select = el.querySelector('select');
      expect(select).not.toBeNull();
      const options = select!.querySelectorAll('option');
      expect(options.length).toBe(3);
    });

    it('selects the current value', () => {
      useStoryStore.getState().setVariable('choice', 'b');
      const el = renderPassage(
        '{listbox $choice}{option "a"}{option "b"}{option "c"}{/listbox}',
      );
      const select = el.querySelector('select') as HTMLSelectElement;
      expect(select.value).toBe('b');
    });

    it('registers as an action', () => {
      useStoryStore.getState().setVariable('choice', 'a');
      renderPassage('{listbox $choice}{option "a"}{option "b"}{/listbox}');
      const actions = getActions();
      expect(actions.some((a) => a.type === 'listbox')).toBe(true);
    });
  });

  describe('{numberbox}', () => {
    it('renders a number input', () => {
      useStoryStore.getState().setVariable('age', 25);
      const el = renderPassage('{numberbox $age}');
      const input = el.querySelector('input[type="number"]');
      expect(input).not.toBeNull();
    });

    it('registers as an action', () => {
      useStoryStore.getState().setVariable('age', 25);
      renderPassage('{numberbox $age}');
      const actions = getActions();
      expect(actions.some((a) => a.type === 'numberbox')).toBe(true);
    });

    it('keeps unfinished numeric input while the reader types (#353)', () => {
      useStoryStore.getState().setVariable('n', 10);
      const el = renderPassage('{numberbox $n}');
      const input = el.querySelector('input') as HTMLInputElement;
      const type = (text: string) => {
        act(() => {
          input.value = text;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      };
      // A browser reports a lone "-" as an empty value
      type('');
      expect(useStoryStore.getState().variables.n).toBe(0);
      expect(input.value).toBe('');
      type('-5');
      expect(useStoryStore.getState().variables.n).toBe(-5);
      expect(input.value).toBe('-5');
      type('2e3');
      expect(useStoryStore.getState().variables.n).toBe(2000);
      expect(input.value).toBe('2e3');
      // An outside change replaces the text
      act(() => useStoryStore.getState().setVariable('n', 7));
      expect(input.value).toBe('7');
    });
  });

  describe('{textarea}', () => {
    it('renders a textarea element', () => {
      useStoryStore.getState().setVariable('notes', 'hello');
      const el = renderPassage('{textarea $notes}');
      const ta = el.querySelector('textarea');
      expect(ta).not.toBeNull();
    });

    it('registers as an action', () => {
      useStoryStore.getState().setVariable('notes', '');
      renderPassage('{textarea $notes}');
      const actions = getActions();
      expect(actions.some((a) => a.type === 'textarea')).toBe(true);
    });
  });

  describe('{radiobutton}', () => {
    it('renders a radio input', () => {
      useStoryStore.getState().setVariable('color', 'red');
      const el = renderPassage('{radiobutton $color "red" "Red"}');
      const input = el.querySelector('input[type="radio"]');
      expect(input).not.toBeNull();
    });

    it('checks the matching radio', () => {
      useStoryStore.getState().setVariable('color', 'red');
      const el = renderPassage('{radiobutton $color "red" "Red"}');
      const input = el.querySelector('input[type="radio"]') as HTMLInputElement;
      expect(input.checked).toBe(true);
    });

    it('does not check non-matching radio', () => {
      useStoryStore.getState().setVariable('color', 'blue');
      const el = renderPassage('{radiobutton $color "red" "Red"}');
      const input = el.querySelector('input[type="radio"]') as HTMLInputElement;
      expect(input.checked).toBe(false);
    });

    it('registers as an action', () => {
      useStoryStore.getState().setVariable('color', 'red');
      renderPassage('{radiobutton $color "red" "Red"}');
      const actions = getActions();
      expect(actions.some((a) => a.type === 'radiobutton')).toBe(true);
    });
  });

  describe('{cycle}', () => {
    it('renders a button with current value', () => {
      useStoryStore.getState().setVariable('mode', 'easy');
      const el = renderPassage(
        '{cycle $mode}{option "easy"}{option "normal"}{option "hard"}{/cycle}',
      );
      const btn = el.querySelector('button.macro-cycle');
      expect(btn).not.toBeNull();
      expect(btn!.textContent).toBe('easy');
    });

    it('cycles to next value on click', () => {
      useStoryStore.getState().setVariable('mode', 'easy');
      const el = renderPassage(
        '{cycle $mode}{option "easy"}{option "normal"}{option "hard"}{/cycle}',
      );
      const btn = el.querySelector('button.macro-cycle') as HTMLElement;
      btn.click();
      expect(useStoryStore.getState().variables.mode).toBe('normal');
    });

    it('wraps around at end of options', () => {
      useStoryStore.getState().setVariable('mode', 'hard');
      const el = renderPassage(
        '{cycle $mode}{option "easy"}{option "normal"}{option "hard"}{/cycle}',
      );
      const btn = el.querySelector('button.macro-cycle') as HTMLElement;
      btn.click();
      expect(useStoryStore.getState().variables.mode).toBe('easy');
    });

    it('registers as an action', () => {
      useStoryStore.getState().setVariable('mode', 'easy');
      renderPassage('{cycle $mode}{option "easy"}{option "normal"}{/cycle}');
      const actions = getActions();
      expect(actions.some((a) => a.type === 'cycle')).toBe(true);
    });
  });

  describe('{widget} and widget invocation', () => {
    it('renders a defined widget', () => {
      // First define the widget in a passage, then invoke it
      const passages = [
        makePassage(1, 'Start', 'Start'),
        makePassage(
          5,
          'WidgetSetup',
          '{widget "greeting" @name}Hello {@name}!{/widget}',
        ),
      ];
      const storyData = makeStoryData(passages);
      useStoryStore.getState().init(storyData);

      // Render the widget definition first
      const setupContainer = document.createElement('div');
      render(<Passage passage={passages[1]!} />, setupContainer);

      // Now invoke it
      const el = renderPassage('{greeting "World"}');
      expect(el.textContent).toContain('Hello');
      expect(el.textContent).toContain('World');
    });

    it('re-registers a widget when its definition changes', () => {
      const container = document.createElement('div');
      const define = (content: string) =>
        act(() => {
          render(
            <Passage passage={makePassage(5, 'WidgetSetup', content)} />,
            container,
          );
        });
      define('{widget "Badge" @x}one {@x}{/widget}');
      expect(renderPassage('{Badge 1}').textContent).toContain('one 1');

      define('{widget "Badge" @y}two {@y}{/widget}');
      expect(getWidget('Badge')!.params).toEqual(['@y']);
      expect(renderPassage('{Badge 2}').textContent).toContain('two 2');
    });

    function defineWidgets(content: string) {
      const passages = [
        makePassage(1, 'Start', 'Start'),
        makePassage(5, 'WidgetSetup', content),
      ];
      useStoryStore.getState().init(makeStoryData(passages));
      render(<Passage passage={passages[1]!} />, document.createElement('div'));
    }

    it('applies an undefined computed result to a widget parameter (#234)', () => {
      defineWidgets(
        '{widget "Show" @x}{computed @x = $source.missing}<span class="result">[{@x}]</span>{/widget}',
      );
      useStoryStore.getState().setVariable('source', {});
      let el!: HTMLElement;
      act(() => {
        el = renderPassage('{Show 99}');
      });
      expect(el.querySelector('.result')!.textContent).toBe('[]');

      act(() => useStoryStore.getState().setVariable('source', { missing: 5 }));
      expect(el.querySelector('.result')!.textContent).toBe('[5]');

      act(() => useStoryStore.getState().setVariable('source', {}));
      expect(el.querySelector('.result')!.textContent).toBe('[]');
    });

    it('binds missing arguments to undefined instead of outer locals (#206)', () => {
      defineWidgets('{widget "Greet" @name}NAME:{@name}{/widget}');
      const el = renderPassage('{for @name of ["OUTER"]}{Greet}{/for}');
      expect(el.textContent).toContain('NAME:');
      expect(el.textContent).not.toContain('OUTER');
    });

    it('gives a zero-argument parameterized widget its own local scope (#206)', () => {
      defineWidgets(
        '{widget "Bump" @name}{set @name = "INNER"}{@name}{/widget}',
      );
      let el!: HTMLElement;
      act(() => {
        el = renderPassage('{for @name of ["OUTER"]}{Bump}|{@name}{/for}');
      });
      expect(el.textContent).toContain('INNER|OUTER');
    });

    it.each([
      ['whitespace', ' '],
      ['comma', ', '],
    ])(
      'splits after a regex literal argument containing a quote (%s form)',
      (_label, sep) => {
        defineWidgets('{widget "Pair" @a @b}A=[{@a}] B=[{@b}]{/widget}');
        const el = renderPassage(`{Pair "a\\"b".match(/"/).index${sep}"x"}`);
        expect(el.textContent).toContain('A=[1] B=[x]');
      },
    );

    it.each([
      ['whitespace', ' '],
      ['comma', ', '],
    ])(
      'splits a string argument ending in an escaped backslash (%s form, #224)',
      (_label, sep) => {
        defineWidgets('{widget "Pair" @a @b}A=[{@a}] B=[{@b}]{/widget}');
        const args = JSON.stringify('C:\\') + sep + JSON.stringify('label');
        const el = renderPassage(`{Pair ${args}}`);
        expect(el.textContent).toContain('A=[C:\\] B=[label]');
      },
    );
  });

  describe('CSS class and id selectors on macros', () => {
    it('applies class to include wrapper', () => {
      const el = renderPassage('{.highlight include "Helper"}');
      const span = el.querySelector('.highlight');
      expect(span).not.toBeNull();
    });

    it('applies id to include wrapper', () => {
      const el = renderPassage('{#main include "Helper"}');
      const span = el.querySelector('#main');
      expect(span).not.toBeNull();
    });
  });

  describe('{dialog}', () => {
    it('renders close button by default', () => {
      const el = renderPassage('{dialog "Open"}Help{/dialog}');
      const btn = el.querySelector('button') as HTMLElement;
      expect(btn).not.toBeNull();
      expect(btn.textContent).toBe('Open');

      act(() => {
        btn.click();
      });
      const closeBtn = el.querySelector('.dialog-close');
      expect(closeBtn).not.toBeNull();
    });

    it('hides close button with noclose flag', () => {
      const el = renderPassage('{dialog "Open" noclose}Help{/dialog}');
      const btn = el.querySelector('button') as HTMLElement;
      act(() => {
        btn.click();
      });

      const closeBtn = el.querySelector('.dialog-close');
      expect(closeBtn).toBeNull();

      // Dialog body should still render
      const body = el.querySelector('.dialog-body');
      expect(body).not.toBeNull();
    });

    it('noclose does not appear in button label', () => {
      const el = renderPassage('{dialog "Open" noclose}Help{/dialog}');
      const btn = el.querySelector('button') as HTMLElement;
      expect(btn.textContent).toBe('Open');
    });
  });

  describe('{type}', () => {
    it('renders with macro-type class', () => {
      const el = renderPassage('{type 10ms}Hello{/type}');
      const typeEl = el.querySelector('.macro-type');
      expect(typeEl).not.toBeNull();
      expect(typeEl!.textContent).toContain('Hello');
    });

    it('types to the end, then stops its interval', () => {
      vi.useFakeTimers();
      try {
        let el!: HTMLElement;
        act(() => {
          el = renderPassage('{type 10ms}Hi!{/type}');
        });
        const typeEl = el.querySelector('.macro-type')!;
        expect(typeEl.classList.contains('macro-type-done')).toBe(false);

        for (let i = 0; i < 50; i++)
          act(() => {
            vi.advanceTimersByTime(10);
          });
        expect(typeEl.classList.contains('macro-type-done')).toBe(true);
        expect(el.querySelector('.macro-type-cursor')).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('PassageDialog', () => {
    it('keeps the DialogCloseContext value stable across re-renders', () => {
      const seen: unknown[] = [];
      defineMacro({
        name: 'probe-dialog-close',
        render(_props, ctx) {
          seen.push(ctx.hooks.useContext(DialogCloseContext));
          return null;
        },
      });
      const onClose = vi.fn();
      const container = document.createElement('div');
      // A new inline onClose each render, as callers typically pass
      for (let i = 0; i < 3; i++) {
        act(() => {
          render(
            h(PassageDialog, {
              fallbackMarkup: '{probe-dialog-close}',
              onClose: () => onClose(i),
            }),
            container,
          );
        });
      }
      expect(seen.length).toBeGreaterThan(0);
      expect(new Set(seen).size).toBe(1);

      // The stable callback calls the latest onClose
      act(() => (seen[0] as () => void)());
      expect(onClose).toHaveBeenCalledWith(2);
    });

    it('onClose callback is invoked when close button is clicked', () => {
      let closed = false;
      const container = document.createElement('div');
      act(() => {
        render(
          h(PassageDialog, {
            fallbackMarkup: 'test content',
            onClose: () => {
              closed = true;
            },
            showCloseButton: true,
          }),
          container,
        );
      });
      const closeBtn = container.querySelector(
        '.dialog-close',
      ) as HTMLButtonElement;
      expect(closeBtn).not.toBeNull();
      act(() => {
        closeBtn.click();
      });
      expect(closed).toBe(true);
    });

    it('closes on backdrop click by default', () => {
      const onClose = vi.fn();
      const container = document.createElement('div');
      act(() => {
        render(
          h(PassageDialog, { fallbackMarkup: 'test', onClose }),
          container,
        );
      });
      const overlay = container.querySelector('.dialog-overlay') as HTMLElement;
      act(() => {
        overlay.click();
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('ignores clicks inside the panel', () => {
      const onClose = vi.fn();
      const container = document.createElement('div');
      act(() => {
        render(
          h(PassageDialog, { fallbackMarkup: 'test', onClose }),
          container,
        );
      });
      const panel = container.querySelector('.dialog-panel') as HTMLElement;
      act(() => {
        panel.click();
      });
      expect(onClose).not.toHaveBeenCalled();
    });

    describe('dismissible: false', () => {
      function renderLocked(props: Record<string, unknown> = {}) {
        const onClose = vi.fn();
        const container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
          render(
            h(PassageDialog, {
              fallbackMarkup: 'test',
              onClose,
              dismissible: false,
              ...props,
            }),
            container,
          );
        });
        return { container, onClose };
      }

      it('hides the close button', () => {
        const { container } = renderLocked();
        expect(container.querySelector('.dialog-close')).toBeNull();
        expect(container.querySelector('.dialog-body')!.textContent).toBe(
          'test',
        );
      });

      it('ignores backdrop clicks', () => {
        const { container, onClose } = renderLocked();
        const overlay = container.querySelector(
          '.dialog-overlay',
        ) as HTMLElement;
        act(() => {
          overlay.click();
        });
        expect(onClose).not.toHaveBeenCalled();
      });

      it('ignores Escape', () => {
        const { onClose } = renderLocked();
        act(() => {
          document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
          );
        });
        expect(onClose).not.toHaveBeenCalled();
      });

      it('still shows the close button when showCloseButton is explicitly true', () => {
        const { container, onClose } = renderLocked({ showCloseButton: true });
        const closeBtn = container.querySelector(
          '.dialog-close',
        ) as HTMLButtonElement;
        expect(closeBtn).not.toBeNull();
        act(() => {
          closeBtn.click();
        });
        expect(onClose).toHaveBeenCalledTimes(1);
      });
    });

    it('onClose callback reflects latest reference after re-render', () => {
      let callCount = 0;
      const container = document.createElement('div');

      // First render with one callback
      act(() => {
        render(
          h(PassageDialog, {
            fallbackMarkup: 'test',
            onClose: () => {
              callCount = 1;
            },
            showCloseButton: true,
          }),
          container,
        );
      });

      // Re-render with a different callback (simulates parent re-render)
      act(() => {
        render(
          h(PassageDialog, {
            fallbackMarkup: 'test',
            onClose: () => {
              callCount = 2;
            },
            showCloseButton: true,
          }),
          container,
        );
      });

      // Click close — should invoke the LATEST callback, not a stale one
      const closeBtn = container.querySelector(
        '.dialog-close',
      ) as HTMLButtonElement;
      act(() => {
        closeBtn.click();
      });
      expect(callCount).toBe(2);
    });
  });

  describe('storeVar dot-path support', () => {
    beforeEach(() => {
      useStoryStore
        .getState()
        .setVariable('pc', { name: 'Maren', stats: { str: 10 } });
    });

    it('textbox reads nested value via dot-path', () => {
      const el = renderPassage('{textbox $pc.name "Enter name"}');
      const input = el.querySelector('input[type="text"]') as HTMLInputElement;
      expect(input.value).toBe('Maren');
    });

    it('textbox reads nested value when variable is quoted', () => {
      const el = renderPassage('{textbox "$pc.name" "Enter name"}');
      const input = el.querySelector('input[type="text"]') as HTMLInputElement;
      expect(input.value).toBe('Maren');
    });

    it('textbox writes nested value via dot-path', () => {
      const el = renderPassage('{textbox $pc.name "Enter name"}');
      const input = el.querySelector('input[type="text"]') as HTMLInputElement;
      act(() => {
        const event = new Event('input', { bubbles: true });
        Object.defineProperty(event, 'target', { value: { value: 'Zara' } });
        input.dispatchEvent(event);
      });
      const pc = useStoryStore.getState().variables.pc as Record<
        string,
        unknown
      >;
      expect(pc.name).toBe('Zara');
      // Other properties should be preserved
      expect((pc.stats as Record<string, unknown>).str).toBe(10);
    });

    it('numberbox reads nested value via dot-path', () => {
      const el = renderPassage('{numberbox $pc.stats.str}');
      const input = el.querySelector(
        'input[type="number"]',
      ) as HTMLInputElement;
      expect(input.value).toBe('10');
    });

    it('checkbox reads nested boolean via dot-path', () => {
      useStoryStore.getState().setVariable('settings', { darkMode: true });
      const el = renderPassage('{checkbox $settings.darkMode "Dark mode"}');
      const input = el.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      expect(input.checked).toBe(true);
    });

    it('radiobutton reads nested value via dot-path', () => {
      const el = renderPassage('{radiobutton $pc.name "Maren" "Maren"}');
      const input = el.querySelector('input[type="radio"]') as HTMLInputElement;
      expect(input.checked).toBe(true);
    });

    it('listbox reads nested value via dot-path', () => {
      const el = renderPassage(
        '{listbox $pc.name}{option "Maren"}{option "Zara"}{/listbox}',
      );
      const select = el.querySelector('select') as HTMLSelectElement;
      expect(select.value).toBe('Maren');
    });

    it('cycle reads and writes nested value via dot-path', () => {
      const el = renderPassage(
        '{cycle $pc.name}{option "Maren"}{option "Zara"}{/cycle}',
      );
      const btn = el.querySelector('button.macro-cycle') as HTMLElement;
      expect(btn.textContent).toBe('Maren');
      btn.click();
      const pc = useStoryStore.getState().variables.pc as Record<
        string,
        unknown
      >;
      expect(pc.name).toBe('Zara');
    });
  });
});
