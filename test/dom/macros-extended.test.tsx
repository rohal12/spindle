// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import {
  clearActions,
  resetIdCounters,
  getActions,
} from '../../src/action-registry';
import { clearWidgets } from '../../src/widgets/widget-registry';
import type { StoryData, Passage as PassageData } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
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
  beforeEach(() => {
    clearActions();
    resetIdCounters();
    clearWidgets();
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Start'),
      makePassage(2, 'Room', 'A room'),
      makePassage(3, 'End', 'The end'),
      makePassage(4, 'Helper', 'Included content here'),
    ]);
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

  describe('{include}', () => {
    it('includes another passage inline', () => {
      const el = renderPassage('{include "Helper"}');
      expect(el.textContent).toContain('Included content here');
    });

    it('shows error for missing passage', () => {
      const el = renderPassage('{include "Nonexistent"}');
      expect(el.querySelector('.error')).not.toBeNull();
      expect(el.textContent).toContain('not found');
    });

    it('tracks render count for included passage', () => {
      renderPassage('{include "Helper"}');
      expect(useStoryStore.getState().renderCounts['Helper']).toBeGreaterThan(
        0,
      );
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
        '{listbox $choice}{option a}{option b}{option c}{/listbox}',
      );
      const select = el.querySelector('select');
      expect(select).not.toBeNull();
      const options = select!.querySelectorAll('option');
      expect(options.length).toBe(3);
    });

    it('selects the current value', () => {
      useStoryStore.getState().setVariable('choice', 'b');
      const el = renderPassage(
        '{listbox $choice}{option a}{option b}{option c}{/listbox}',
      );
      const select = el.querySelector('select') as HTMLSelectElement;
      expect(select.value).toBe('b');
    });

    it('registers as an action', () => {
      useStoryStore.getState().setVariable('choice', 'a');
      renderPassage('{listbox $choice}{option a}{option b}{/listbox}');
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
        '{cycle $mode}{option easy}{option normal}{option hard}{/cycle}',
      );
      const btn = el.querySelector('button.macro-cycle');
      expect(btn).not.toBeNull();
      expect(btn!.textContent).toBe('easy');
    });

    it('cycles to next value on click', () => {
      useStoryStore.getState().setVariable('mode', 'easy');
      const el = renderPassage(
        '{cycle $mode}{option easy}{option normal}{option hard}{/cycle}',
      );
      const btn = el.querySelector('button.macro-cycle') as HTMLElement;
      btn.click();
      expect(useStoryStore.getState().variables.mode).toBe('normal');
    });

    it('wraps around at end of options', () => {
      useStoryStore.getState().setVariable('mode', 'hard');
      const el = renderPassage(
        '{cycle $mode}{option easy}{option normal}{option hard}{/cycle}',
      );
      const btn = el.querySelector('button.macro-cycle') as HTMLElement;
      btn.click();
      expect(useStoryStore.getState().variables.mode).toBe('easy');
    });

    it('registers as an action', () => {
      useStoryStore.getState().setVariable('mode', 'easy');
      renderPassage('{cycle $mode}{option easy}{option normal}{/cycle}');
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
});
