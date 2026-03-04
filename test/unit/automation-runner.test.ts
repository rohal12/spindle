import { describe, it, expect, vi } from 'vitest';
import { runAutomation } from '../../src/automation/runner';
import type { StoryAPI } from '../../src/story-api';
import type { AutomationScript } from '../../src/automation/types';
import type { StoryAction } from '../../src/action-registry';

function mockAction(overrides: Partial<StoryAction> = {}): StoryAction {
  return {
    id: 'link:Forest',
    type: 'link',
    label: 'Forest',
    target: 'Forest',
    perform: vi.fn(),
    ...overrides,
  };
}

function mockStoryAPI(
  overrides: Partial<StoryAPI> = {},
): StoryAPI {
  const variables: Record<string, unknown> = {};
  let actions: StoryAction[] = [];
  let passage = 'Start';

  return {
    get(name: string) {
      return variables[name];
    },
    set(nameOrVars: any, value?: any) {
      if (typeof nameOrVars === 'string') {
        variables[nameOrVars] = value;
      } else {
        Object.assign(variables, nameOrVars);
      }
    },
    goto(p: string) {
      passage = p;
    },
    back() {},
    forward() {},
    restart() {},
    save() {},
    load() {},
    hasSave() {
      return false;
    },
    visited() {
      return 0;
    },
    hasVisited() {
      return false;
    },
    hasVisitedAny() {
      return false;
    },
    hasVisitedAll() {
      return false;
    },
    rendered() {
      return 0;
    },
    hasRendered() {
      return false;
    },
    hasRenderedAny() {
      return false;
    },
    hasRenderedAll() {
      return false;
    },
    get title() {
      return 'Test';
    },
    get passage() {
      return passage;
    },
    settings: {} as any,
    registerClass() {},
    saves: { setTitleGenerator() {} },
    getActions() {
      return actions;
    },
    performAction(id: string, v?: unknown) {
      const action = actions.find((a) => a.id === id);
      if (!action) throw new Error(`spindle: Action "${id}" not found.`);
      if (action.disabled)
        throw new Error(`spindle: Action "${id}" is disabled.`);
      action.perform(v);
      // Simulate navigation for link actions
      if (action.target) {
        passage = action.target;
      }
    },
    on() {
      return () => {};
    },
    async waitForActions() {
      return actions;
    },
    ...overrides,
    // Allow tests to inject actions
    _setActions(a: StoryAction[]) {
      actions = a;
    },
  } as any;
}

describe('automation runner', () => {
  it('runs a simple action step', async () => {
    const api = mockStoryAPI();
    const action = mockAction();
    (api as any)._setActions([action]);

    const script: AutomationScript = {
      name: 'test',
      steps: [{ action: 'link:Forest' }],
    };

    const result = await runAutomation(api, script);
    expect(result.success).toBe(true);
    expect(result.stepsRun).toBe(1);
    expect(action.perform).toHaveBeenCalled();
  });

  it('runs action with value', async () => {
    const api = mockStoryAPI();
    const action = mockAction({ id: 'textbox:$name', type: 'textbox' });
    (api as any)._setActions([action]);

    const script: AutomationScript = {
      name: 'test',
      steps: [{ action: { id: 'textbox:$name', value: 'Alice' } }],
    };

    const result = await runAutomation(api, script);
    expect(result.success).toBe(true);
    expect(action.perform).toHaveBeenCalledWith('Alice');
  });

  it('asserts passage', async () => {
    const api = mockStoryAPI();

    const script: AutomationScript = {
      name: 'test',
      steps: [{ assert: { passage: 'Start' } }],
    };

    const result = await runAutomation(api, script);
    expect(result.success).toBe(true);
  });

  it('reports assertion failure for wrong passage', async () => {
    const api = mockStoryAPI();

    const script: AutomationScript = {
      name: 'test',
      steps: [{ assert: { passage: 'Forest' } }],
    };

    const result = await runAutomation(api, script);
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Expected passage "Forest"');
  });

  it('asserts variables', async () => {
    const api = mockStoryAPI();
    api.set('health', 100);

    const script: AutomationScript = {
      name: 'test',
      steps: [{ assert: { variables: { health: 100 } } }],
    };

    const result = await runAutomation(api, script);
    expect(result.success).toBe(true);
  });

  it('reports variable assertion failure', async () => {
    const api = mockStoryAPI();
    api.set('health', 50);

    const script: AutomationScript = {
      name: 'test',
      steps: [{ assert: { variables: { health: 100 } } }],
    };

    const result = await runAutomation(api, script);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain('Variable "health"');
  });

  it('sets variables', async () => {
    const api = mockStoryAPI();

    const script: AutomationScript = {
      name: 'test',
      steps: [
        { set: { health: 100, name: 'Hero' } },
        { assert: { variables: { health: 100, name: 'Hero' } } },
      ],
    };

    const result = await runAutomation(api, script);
    expect(result.success).toBe(true);
  });

  it('errors when action not found', async () => {
    const api = mockStoryAPI();
    (api as any)._setActions([]);

    const script: AutomationScript = {
      name: 'test',
      steps: [{ action: 'link:Missing' }],
    };

    const result = await runAutomation(api, script);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain('Action "link:Missing" not found');
  });

  it('asserts action count', async () => {
    const api = mockStoryAPI();
    (api as any)._setActions([
      mockAction({ id: 'link:A' }),
      mockAction({ id: 'link:B' }),
    ]);

    const script: AutomationScript = {
      name: 'test',
      steps: [{ assert: { actionCount: 2 } }],
    };

    const result = await runAutomation(api, script);
    expect(result.success).toBe(true);
  });

  it('asserts action matchers', async () => {
    const api = mockStoryAPI();
    (api as any)._setActions([
      mockAction({ id: 'link:Forest', type: 'link', target: 'Forest' }),
    ]);

    const script: AutomationScript = {
      name: 'test',
      steps: [
        {
          assert: {
            actions: [{ type: 'link', target: 'Forest' }],
          },
        },
      ],
    };

    const result = await runAutomation(api, script);
    expect(result.success).toBe(true);
  });

  it('navigates to start passage if specified', async () => {
    const api = mockStoryAPI();
    const gotoSpy = vi.spyOn(api, 'goto');

    const script: AutomationScript = {
      name: 'test',
      start: 'Intro',
      steps: [],
    };

    await runAutomation(api, script);
    expect(gotoSpy).toHaveBeenCalledWith('Intro');
  });

  it('calls onStep callback for each step', async () => {
    const api = mockStoryAPI();
    const steps: number[] = [];

    const script: AutomationScript = {
      name: 'test',
      steps: [
        { assert: { passage: 'Start' } },
        { set: { x: 1 } },
      ],
    };

    await runAutomation(api, script, {
      onStep: (i) => steps.push(i),
    });

    expect(steps).toEqual([0, 1]);
  });
});
