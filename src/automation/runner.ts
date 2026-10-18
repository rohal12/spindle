import type {
  AutomationScript,
  AutomationStep,
  RunResult,
  StepError,
  ActionMatcher,
} from './types';
import type { StoryAPI } from '../story-api';
import { actionMatches, type StoryAction } from '../action-registry';
import { errorMessage } from '../utils/error-message';
import { deepEqual } from '../structural';

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
  if (script.start !== undefined) {
    let started = false;
    // Observe the supplied runtime, which may come from a separate package
    // bundle. Valid destinations emit before rendering (and any redirects).
    const unsubscribe = story.on('beforenavigate', (passage) => {
      if (passage === script.start) started = true;
    });
    try {
      story.goto(script.start);
      if (!started) {
        throw new Error(
          `Cannot start automation at passage "${script.start}": navigation was refused`,
        );
      }
      await story.waitForActions();
    } catch (err) {
      return {
        success: false,
        stepsRun: 0,
        errors: [{ step: -1, message: errorMessage(err) }],
      };
    } finally {
      unsubscribe();
    }
  }

  for (let i = 0; i < script.steps.length; i++) {
    const step = script.steps[i]!;
    options.onStep?.(i, step);

    try {
      await executeStep(story, step, i, errors);
    } catch (err) {
      errors.push({
        step: i,
        message: errorMessage(err),
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
    // Controls shown or removed by the new values register (or go) when the
    // UI has rendered, which is after set(): an assert, or an action in the
    // same step, would otherwise see the previous step's controls (#514)
    await story.waitForActions();
  }

  if (step.action !== undefined) {
    const id = typeof step.action === 'string' ? step.action : step.action.id;
    const value =
      typeof step.action === 'string' ? undefined : step.action.value;
    // An action that finishes later (QuickLoad) is awaited, then the UI
    await story.performAction(id, value);
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
        if (!deepEqual(actual, expected)) {
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
  return actions.find((action) => actionMatches(action, matcher));
}
