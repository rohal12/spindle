import yaml from 'js-yaml';
import type { AutomationScript } from './types';

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

  return doc as unknown as AutomationScript;
}
