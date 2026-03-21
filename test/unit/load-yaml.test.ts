import { describe, it, expect } from 'vitest';
import { parseAutomationYaml } from '../../src/automation/load-yaml';

describe('parseAutomationYaml', () => {
  it('parses valid script', () => {
    const script = parseAutomationYaml(
      'name: test\nsteps:\n  - action: click\n',
    );
    expect(script.name).toBe('test');
    expect(script.steps).toHaveLength(1);
  });

  it('parses script with start field', () => {
    const script = parseAutomationYaml(
      'name: test\nstart: Intro\nsteps:\n  - action: click\n',
    );
    expect(script.start).toBe('Intro');
  });

  it('rejects step with no recognized fields', () => {
    expect(() =>
      parseAutomationYaml('name: test\nsteps:\n  - bogus: true\n'),
    ).toThrow(/step 1/i);
  });

  it('rejects step where wait is not a number', () => {
    expect(() =>
      parseAutomationYaml('name: test\nsteps:\n  - wait: "slow"\n'),
    ).toThrow(/step 1/i);
  });

  it('rejects step where set is not an object', () => {
    expect(() =>
      parseAutomationYaml('name: test\nsteps:\n  - set: 42\n'),
    ).toThrow(/step 1/i);
  });

  it('rejects missing name', () => {
    expect(() => parseAutomationYaml('steps:\n  - action: click\n')).toThrow(
      /name/i,
    );
  });

  it('rejects missing steps', () => {
    expect(() => parseAutomationYaml('name: test\n')).toThrow(/steps/i);
  });
});
