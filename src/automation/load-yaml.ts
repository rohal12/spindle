import * as yaml from 'js-yaml';
import type { AutomationScript, AutomationStep } from './types';
import { checkActionMatcher } from '../action-registry';
import {
  checkFields,
  checkObject,
  isRecord,
  isString,
  type Fail,
  type FieldCheck,
} from '../utils/field-checks';

const isCount: FieldCheck = (v) => Number.isInteger(v) && (v as number) >= 0;

const ASSERT_FIELDS: Record<string, [FieldCheck, string]> = {
  passage: [isString, 'a string'],
  variables: [isRecord, 'an object of variable names and values'],
  actions: [Array.isArray, 'a list of action matchers'],
  actionCount: [isCount, 'a non-negative integer'],
};

function checkAssert(value: unknown, fail: Fail): void {
  const assert = checkObject(
    value,
    '"assert"',
    Object.keys(ASSERT_FIELDS),
    fail,
  );
  checkFields(assert, '"assert"', ASSERT_FIELDS, fail);
  for (const matcher of (assert.actions as unknown[] | undefined) ?? []) {
    checkActionMatcher(matcher, 'an action matcher in "assert.actions"', fail);
  }
}

function checkAction(value: unknown, fail: Fail): void {
  if (typeof value === 'string') return;
  const action = checkObject(value, '"action"', ['id', 'value'], fail);
  if (typeof action.id !== 'string') {
    fail('"action" needs an "id" string (or be an action ID string)');
  }
}

const STEP_CHECKS: Record<string, (value: unknown, fail: Fail) => void> = {
  action: checkAction,
  assert: checkAssert,
  wait(value, fail) {
    if (typeof value !== 'number' || !(value >= 0) || !isFinite(value)) {
      fail('"wait" must be a number of milliseconds');
    }
  },
  set(value, fail) {
    if (!isRecord(value)) fail('"set" must be an object');
  },
};

function validateStep(step: unknown, index: number): AutomationStep {
  const fail: Fail = (message) => {
    throw new Error(`Invalid automation step ${index + 1}: ${message}`);
  };
  const fields = Object.keys(STEP_CHECKS);
  if (typeof step !== 'object' || step === null) {
    fail('expected an object');
  }
  const s = checkObject(step, 'a step', fields, fail);

  if (!fields.some((field) => field in s)) {
    fail(`must have at least one of ${fields.join(', ')}`);
  }
  for (const [field, check] of Object.entries(STEP_CHECKS)) {
    if (field in s) check(s[field], fail);
  }

  return s as AutomationStep;
}

export function parseAutomationYaml(yamlContent: string): AutomationScript {
  const doc = yaml.load(yamlContent) as Record<string, unknown>;

  if (!doc || typeof doc !== 'object') {
    throw new Error('Invalid YAML: expected an object');
  }

  if (typeof doc.name !== 'string') {
    throw new Error('Invalid automation script: missing "name" field');
  }

  if (!Array.isArray(doc.steps)) {
    throw new Error('Invalid automation script: missing "steps" array');
  }

  const steps = doc.steps.map((step, i) => validateStep(step, i));

  if ('start' in doc && typeof doc.start !== 'string') {
    throw new Error(
      'Invalid automation script: "start" must be a passage name',
    );
  }

  return {
    name: doc.name,
    start: doc.start as string | undefined,
    steps,
  };
}
