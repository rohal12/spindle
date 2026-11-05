// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { render } from 'preact';
import { useRef } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { useModalFocus } from '../../src/hooks/use-modal-focus';

function Modal({
  html = '<input type="radio" name="choice">'.repeat(200) +
    '<button>After</button>',
}: {
  html?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(panel, '.body', false, () => {});
  return (
    <div
      ref={panel}
      tabIndex={-1}
    >
      <div
        class="body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

it('bounds style reads when opening and tabbing through a radio group (#718)', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const styles = vi.spyOn(window, 'getComputedStyle');
  try {
    act(() => render(<Modal />, container));
    expect(document.activeElement).toBe(container.querySelector('input'));
    expect(styles.mock.calls.length).toBeLessThan(10_000);
    styles.mockClear();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
    );
    expect(document.activeElement).toBe(container.querySelector('button'));
    expect(styles.mock.calls.length).toBeLessThan(10_000);
  } finally {
    act(() => render(null, container));
    styles.mockRestore();
    container.remove();
  }
});

it('keeps same-named radio groups separate by form owner and tree (#718)', () => {
  const container = document.createElement('div');
  document.body.append(container);
  try {
    act(() =>
      render(
        <Modal
          html={`<input type="radio" name="choice" id="light">
            <form><input type="radio" name="choice" id="form-a"></form>
            <form><input type="radio" name="choice" id="form-b"></form>
            <div id="host"></div><button id="after">After</button>`}
        />,
        container,
      ),
    );
    const shadow = container
      .querySelector('#host')!
      .attachShadow({ mode: 'open' });
    shadow.innerHTML = '<input type="radio" name="choice" id="shadow">';
    expect(document.activeElement?.id).toBe('light');
    for (const id of ['form-a', 'form-b', 'host', 'after']) {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
      );
      expect(document.activeElement?.id).toBe(id);
      if (id === 'host') expect(shadow.activeElement?.id).toBe('shadow');
    }
  } finally {
    act(() => render(null, container));
    container.remove();
  }
});
