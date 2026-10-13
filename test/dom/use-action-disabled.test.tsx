// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
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
});
