// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ActionsDisabledContext, useAction } from '../../src/hooks/use-action';
import {
  getActions,
  clearActions,
  resetIdCounters,
} from '../../src/action-registry';

function ForestLink() {
  useAction({
    type: 'link',
    key: 'Forest',
    label: 'F',
    perform() {},
  });
  return null;
}

/** A link control whose ID is written to `seen`. */
function Seen({ label, seen }: { label: string; seen: string[] }) {
  seen.push(useAction({ type: 'link', key: 'Forest', label, perform() {} }));
  return null;
}

function renderSeen(
  container: HTMLElement,
  disabled: boolean,
  label: string,
  seen: string[],
) {
  act(() => {
    render(
      <ActionsDisabledContext.Provider value={disabled}>
        <Seen
          label={label}
          seen={seen}
        />
      </ActionsDisabledContext.Provider>,
      container,
    );
  });
}

describe('ActionsDisabledContext', () => {
  beforeEach(() => {
    clearActions();
    resetIdCounters();
  });

  it('registers nothing under ActionsDisabledContext', () => {
    const container = document.createElement('div');
    render(
      <ActionsDisabledContext.Provider value={true}>
        <ForestLink />
      </ActionsDisabledContext.Provider>,
      container,
    );
    expect(getActions()).toEqual([]);
  });

  it('reserves no ID under ActionsDisabledContext', () => {
    const hidden = document.createElement('div');
    render(
      <ActionsDisabledContext.Provider value={true}>
        <ForestLink />
      </ActionsDisabledContext.Provider>,
      hidden,
    );
    const visible = document.createElement('div');
    render(<ForestLink />, visible);
    expect(getActions().map((a) => a.id)).toEqual(['link:Forest']);
  });

  it('returns no ID under ActionsDisabledContext', () => {
    const seen: string[] = [];
    renderSeen(document.createElement('div'), true, 'F', seen);
    expect(seen[seen.length - 1]).toBe('');
  });

  it('returns no ID once the flag turns true', () => {
    const container = document.createElement('div');
    const seen: string[] = [];
    renderSeen(container, false, 'F', seen);
    expect(seen[seen.length - 1]).toBe('link:Forest');
    renderSeen(container, true, 'F', seen);
    expect(seen[seen.length - 1]).toBe('');
    expect(getActions()).toEqual([]);
  });

  it('updates the action after a disabled mount turned enabled', () => {
    const container = document.createElement('div');
    const seen: string[] = [];
    renderSeen(container, true, 'F', seen);
    renderSeen(container, false, 'F', seen);
    expect(getActions().map((a) => a.label)).toEqual(['F']);
    // The first change after the flag turned false
    renderSeen(container, false, 'G', seen);
    expect(getActions().map((a) => a.label)).toEqual(['G']);
  });
});
