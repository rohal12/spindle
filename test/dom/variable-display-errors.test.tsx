// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { render } from 'preact';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import {
  observableErrors,
  observableText,
} from '../../src/observe/observable-text';

const container = document.createElement('div');
afterEach(() => render(null, container));

it.each([
  [
    'unprintable conversion error',
    {
      toString() {
        throw Object.create(null);
      },
    },
    '{$value}',
  ],
  [
    'unprintable getter error',
    new (class {
      get field() {
        throw Object.create(null);
      }
    })(),
    '{$value.field}',
  ],
  [
    'unprintable expression error',
    new (class {
      get field() {
        throw Object.create(null);
      }
    })(),
    '{$value.field + 1}',
  ],
  ['null-prototype dictionary', Object.create(null), '{$value}'],
  ['non-callable toString', { toString: 3 }, '{$value}'],
  [
    'throwing field getter',
    new (class {
      get field() {
        throw new Error('field failed');
      }
    })(),
    '{$value.field}',
  ],
])(
  'contains a %s failure while retaining the rest of the passage (#552)',
  (_, value, markup) => {
    useStoryStore.getState().setVariable('value', value);
    expect(() =>
      render(
        <Passage
          passage={{
            pid: 1,
            name: 'Display',
            content: `Before ${markup} After`,
            tags: [],
            metadata: {},
          }}
        />,
        container,
      ),
    ).not.toThrow();
    expect(observableText(container)).toContain('Before');
    expect(observableText(container)).toContain('After');
    expect(observableErrors(container)).toHaveLength(1);
  },
);
