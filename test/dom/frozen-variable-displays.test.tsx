// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FrozenStateContext } from '../../src/hooks/use-story-fields';
import { useStoryStore } from '../../src/store';
import { renderNodes } from '../../src/markup/render';
import { parseMarkup } from '../../src/markup/parse';

const container = document.createElement('div');
afterEach(() => act(() => render(null, container)));

it('freezes simple displays in every store namespace and bound controls (#593)', () => {
  useStoryStore.setState({
    variables: { n: 1 },
    temporary: { n: 1 },
    transient: { n: 1 },
  });
  let frozen = false;
  act(() =>
    render(
      <FrozenStateContext.Provider value={() => frozen}>
        {renderNodes(
          parseMarkup(
            '<div>{$n} {_n} {%n} {print $n} {$n + 0}</div>{textbox $n}',
          ),
        )}
      </FrozenStateContext.Provider>,
      container,
    ),
  );
  const values = () => container.querySelector('div')!.textContent;
  const input = () => container.querySelector('input')!.value;
  expect(values()).toBe('1 1 1 1 1');
  expect(input()).toBe('1');
  act(() =>
    useStoryStore.setState({
      variables: { n: 2 },
      temporary: { n: 2 },
      transient: { n: 2 },
    }),
  );
  expect(values()).toBe('2 2 2 2 2');
  expect(input()).toBe('2');
  frozen = true;
  act(() =>
    useStoryStore.setState({
      variables: { n: 3 },
      temporary: {},
      transient: { n: 3 },
    }),
  );
  expect(values()).toBe('2 2 2 2 2');
  expect(input()).toBe('2');
});
