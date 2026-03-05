import type {
  AutomationScript,
  AutomationStep,
  RunResult,
  StepError,
  ActionMatcher,
} from './types';
import type { StoryAPI } from '../story-api';
import type { StoryAction } from '../action-registry';

export interface RunOptions {
  onStep?: (stepIndex: number, step: AutomationStep) => void;
}

export async function runAutomation(
  story: StoryAPI,
  script: AutomationScript,
  options: RunOptions = {},
): Promise<RunResult> {
  const errors: StepError[] = [];
  let stepsRun = 0;

  // Navigate to start passage if specified
  if (script.start) {
    story.goto(script.start);
    await story.waitForActions();
  }

  for (let i = 0; i < script.steps.length; i++) {
    const step = script.steps[i]!;
    options.onStep?.(i, step);

    try {
      await executeStep(story, step, i, errors);
    } catch (err) {
      errors.push({
        step: i,
        message: err instanceof Error ? err.message : String(err),
      });
      break;
    }

    stepsRun = i + 1;
  }

  return {
    success: errors.length === 0,
    stepsRun,
    errors,
  };
}

async function executeStep(
  story: StoryAPI,
  step: AutomationStep,
  index: number,
  errors: StepError[],
): Promise<void> {
  if (step.set) {
    story.set(step.set);
  }

  if (step.action !== undefined) {
    const id = typeof step.action === 'string' ? step.action : step.action.id;
    const value =
      typeof step.action === 'string' ? undefined : step.action.value;
    story.performAction(id, value);
    await story.waitForActions();
  }

  if (step.wait !== undefined) {
    await new Promise((resolve) => setTimeout(resolve, step.wait));
  }

  if (step.assert) {
    const { assert } = step;

    if (assert.passage !== undefined) {
      if (story.passage !== assert.passage) {
        errors.push({
          step: index,
          message: `Expected passage "${assert.passage}", got "${story.passage}"`,
        });
      }
    }

    if (assert.variables) {
      for (const [key, expected] of Object.entries(assert.variables)) {
        const actual = story.get(key);
        if (actual !== expected) {
          errors.push({
            step: index,
            message: `Variable "${key}": expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
          });
        }
      }
    }

    if (assert.actionCount !== undefined) {
      const actions = story.getActions();
      if (actions.length !== assert.actionCount) {
        errors.push({
          step: index,
          message: `Expected ${assert.actionCount} actions, got ${actions.length}`,
        });
      }
    }

    if (assert.actions) {
      const actions = story.getActions();
      for (const matcher of assert.actions) {
        if (!findMatchingAction(actions, matcher)) {
          errors.push({
            step: index,
            message: `No action matching ${JSON.stringify(matcher)}`,
          });
        }
      }
    }
  }
}

function findMatchingAction(
  actions: StoryAction[],
  matcher: ActionMatcher,
): StoryAction | undefined {
  return actions.find((action) => {
    if (matcher.id !== undefined && action.id !== matcher.id) return false;
    if (matcher.type !== undefined && action.type !== matcher.type)
      return false;
    if (matcher.target !== undefined && action.target !== matcher.target)
      return false;
    if (matcher.variable !== undefined && action.variable !== matcher.variable)
      return false;
    if (matcher.label !== undefined && action.label !== matcher.label)
      return false;
    return true;
  });
}
