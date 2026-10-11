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

  describe('malformed steps (#485)', () => {
    const parse = (steps: string) =>
      parseAutomationYaml(`name: test\nsteps:\n${steps}`);

    it.each([
      ['an empty assert', '  - assert:\n'],
      ['a string assert', '  - assert: "score = 100"\n'],
      ['an array assert', '  - assert: [passage]\n'],
      [
        'an assert without the variables: nesting',
        '  - assert: {score: 100}\n',
      ],
      ['an unknown assert key', '  - assert: {passage: A, pasage: B}\n'],
      ['a non-string passage', '  - assert: {passage: 5}\n'],
      ['a string variables', '  - assert: {variables: "score"}\n'],
      ['an array variables', '  - assert: {variables: [score]}\n'],
      ['a null variables', '  - assert: {variables:}\n'],
      ['a string actionCount', '  - assert: {actionCount: "2"}\n'],
      ['a negative actionCount', '  - assert: {actionCount: -1}\n'],
      ['a fractional actionCount', '  - assert: {actionCount: 1.5}\n'],
      ['an object actions', '  - assert: {actions: {type: link}}\n'],
      ['a string action matcher', '  - assert: {actions: [link]}\n'],
      ['a null action matcher', '  - assert: {actions: [null]}\n'],
      [
        'an unknown matcher key',
        '  - assert: {actions: [{type: link, dsiabled: true}]}\n',
      ],
      [
        'a non-boolean disabled',
        '  - assert: {actions: [{disabled: "yes"}]}\n',
      ],
      ['a non-string matcher id', '  - assert: {actions: [{id: 3}]}\n'],
      ['a null action', '  - action:\n'],
      ['a numeric action', '  - action: 5\n'],
      ['an action object without id', '  - action: {value: 1}\n'],
      ['an action with an unknown key', '  - action: {id: a, valeu: 1}\n'],
      ['a null set', '  - set:\n'],
      ['an array set', '  - set: [1]\n'],
      ['a negative wait', '  - wait: -5\n'],
      ['an unknown step key', '  - action: a\n    asert: {passage: A}\n'],
    ])('rejects %s, naming the step', (_label, step) => {
      expect(() => parse(`  - action: ok\n${step}`)).toThrow(/step 2/i);
    });

    it('rejects a non-string start', () => {
      expect(() =>
        parseAutomationYaml('name: test\nstart: 5\nsteps:\n  - action: a\n'),
      ).toThrow(/start/i);
    });

    it('accepts every documented step shape', () => {
      const script = parse(
        [
          '  - set: {a: 1}',
          '  - action: link:A',
          '  - action: {id: textbox:$n, value: Alice}',
          '  - action: {id: cycle:$w}',
          '  - wait: 0',
          '  - assert:',
          '      passage: A',
          '      variables: {a: 1}',
          '      actionCount: 0',
          '      actions:',
          '        - {id: x, type: back, target: A, variable: v, label: L, disabled: true}',
          '',
        ].join('\n'),
      );
      expect(script.steps).toHaveLength(6);
    });
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
