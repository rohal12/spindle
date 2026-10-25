// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import {
  isReaderVisible,
  isRendered,
} from '../../src/utils/element-visibility';

afterEach(() => document.body.replaceChildren());

it.each(['hidden', 'inert', 'display', 'aria-hidden'])(
  'checks %s on a shadow host and its ancestors (#650)',
  (gate) => {
    const outer = document.createElement('div');
    const host = document.createElement('div');
    outer.append(host);
    document.body.append(outer);
    const button = document.createElement('button');
    host.attachShadow({ mode: 'open' }).append(button);
    expect(isReaderVisible(button)).toBe(true);
    for (const el of [host, outer]) {
      if (gate === 'display') el.style.display = 'none';
      else el.setAttribute(gate, gate === 'aria-hidden' ? 'true' : '');
      expect(isReaderVisible(button)).toBe(false);
      el.removeAttribute(gate === 'display' ? 'style' : gate);
    }
    expect(isReaderVisible(button)).toBe(true);
  },
);

it('checks slotted ancestry and honors a bounded rendering root (#650)', () => {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<div style="display:none"><slot></slot></div>';
  const button = document.createElement('button');
  host.append(button);
  document.body.append(host);
  // happy-dom does not yet assign this browser-provided property.
  Object.defineProperty(button, 'assignedSlot', {
    value: root.querySelector('slot'),
  });
  expect(isReaderVisible(button)).toBe(false);
  root.querySelector('div')!.removeAttribute('style');
  host.style.display = 'none';
  expect(isRendered(button)).toBe(false);
  expect(isRendered(button, root.querySelector('slot')!)).toBe(true);
});

it('checks closed details through shadow hosts, preserving summary content (#650)', () => {
  const details = document.createElement('details');
  details.innerHTML =
    '<summary><div id="summary-host"></div></summary><div id="body-host"></div>';
  document.body.append(details);
  const makeButton = (id: string) => {
    const button = document.createElement('button');
    details.querySelector(id)!.attachShadow({ mode: 'open' }).append(button);
    return button;
  };
  const summary = makeButton('#summary-host');
  const body = makeButton('#body-host');
  expect(isRendered(summary)).toBe(true);
  expect(isRendered(body)).toBe(false);
  details.open = true;
  expect(isRendered(body)).toBe(true);
});
