import yaml from 'js-yaml';
import type { AutomationScript, AutomationStep } from './types';

function validateStep(step: unknown, index: number): AutomationStep {
  if (typeof step !== 'object' || step === null) {
    throw new Error(`Invalid automation step ${index + 1}: expected an object`);
  }
  const s = step as Record<string, unknown>;

  const hasAction = 'action' in s;
  const hasAssert = 'assert' in s;
  const hasWait = 'wait' in s;
  const hasSet = 'set' in s;

  if (!hasAction && !hasAssert && !hasWait && !hasSet) {
    throw new Error(
      `Invalid automation step ${index + 1}: must have at least one of action, assert, wait, set`,
    );
  }

  if (hasWait && typeof s.wait !== 'number') {
    throw new Error(
      `Invalid automation step ${index + 1}: "wait" must be a number`,
    );
  }

  if (hasSet && (typeof s.set !== 'object' || s.set === null)) {
    throw new Error(
      `Invalid automation step ${index + 1}: "set" must be an object`,
    );
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

  return {
    name: doc.name,
    start: typeof doc.start === 'string' ? doc.start : undefined,
    steps,
  };
}
