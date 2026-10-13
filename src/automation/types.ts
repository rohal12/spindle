import type { ActionMatcher } from '../action-registry';

export type { ActionMatcher };

export interface AssertStep {
  passage?: string;
  variables?: Record<string, unknown>;
  actions?: ActionMatcher[];
  actionCount?: number;
}

export interface AutomationStep {
  action?: string | { id: string; value?: unknown };
  assert?: AssertStep;
  wait?: number;
  set?: Record<string, unknown>;
}

export interface AutomationScript {
  name: string;
  start?: string;
  steps: AutomationStep[];
}

export interface StepError {
  step: number;
  message: string;
}

export interface RunResult {
  success: boolean;
  stepsRun: number;
  errors: StepError[];
}
