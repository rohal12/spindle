// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useStoryStore } from '../../src/store';
import {
  installStoryAPI,
  getReadyPromise,
  _resetReadyState,
} from '../../src/story-api';

describe('deferred :storyready', () => {
  beforeEach(() => {
    _resetReadyState();
    useStoryStore.setState({
      storyData: null,
      currentPassage: '',
      variables: {},
      variableDefaults: {},
      temporary: {},
      history: [],
      historyIndex: -1,
      visitCounts: {},
      renderCounts: {},
      renderDeferred: false,
      transitionConfig: null,
      nextTransition: null,
    });
    installStoryAPI();
  });

  afterEach(() => {
    _resetReadyState();
  });

  it('getReadyPromise() is null when deferRender was not called', () => {
    expect(getReadyPromise()).toBeNull();
  });

  it('getReadyPromise() returns a promise after deferRender()', () => {
    window.Story.deferRender();
    expect(getReadyPromise()).toBeInstanceOf(Promise);
  });

  it(':storyready fires after ready() resolves the promise', async () => {
    window.Story.deferRender();

    const handler = vi.fn();
    document.addEventListener(':storyready', handler);

    const promise = getReadyPromise()!;

    // Simulate what index.tsx does: chain :storyready on the promise
    promise.then(() => {
      document.dispatchEvent(new CustomEvent(':storyready'));
    });

    expect(handler).not.toHaveBeenCalled();

    window.Story.ready();
    await promise;
    // Allow microtask to flush
    await new Promise((r) => setTimeout(r, 0));

    expect(handler).toHaveBeenCalledTimes(1);

    document.removeEventListener(':storyready', handler);
  });
});
