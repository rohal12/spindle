// @vitest-environment happy-dom
import CodeMirror from 'codemirror';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from '../../src/twine-editor/commands';
import { snippets } from '../../src/twine-editor/snippets';
import { toolbar } from '../../src/twine-editor/toolbar';

/** The snippet's text around `selection`, and where its slot is in it. */
function expected(id: string, selection: string) {
  const snippet = snippets.find((s) => s.id === id)!;
  const [head = '', tail = ''] = snippet.before.split('|');
  return { text: head + tail + selection + snippet.after, slot: head.length };
}

let editors: CodeMirror.Editor[] = [];
function create(
  value: string,
  options: CodeMirror.EditorConfiguration = {},
): CodeMirror.Editor {
  const editor = CodeMirror(document.body, { value, ...options });
  editors.push(editor);
  return editor;
}

const alert = vi.fn();
beforeEach(() => {
  alert.mockClear();
  vi.stubGlobal('alert', alert);
  window.alert = alert;
});
afterEach(() => {
  for (const editor of editors) editor.getWrapperElement().remove();
  editors = [];
});

describe('snippet commands', () => {
  it('wraps the selection and one undo restores the text', () => {
    const editor = create('hello');
    editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 5 });
    commands['snippet:if']!(editor);
    expect(editor.getValue()).toBe(expected('if', 'hello').text);
    editor.undo();
    expect(editor.getValue()).toBe('hello');
  });

  it('inserts the template with no selection and puts the cursor in the slot', () => {
    const editor = create('ab');
    editor.setCursor({ line: 0, ch: 1 });
    commands['snippet:if']!(editor);
    const { text, slot } = expected('if', '');
    expect(editor.getValue()).toBe('a' + text + 'b');
    expect(editor.getCursor()).toEqual(
      expect.objectContaining({ line: 0, ch: 1 + slot }),
    );
    expect(editor.somethingSelected()).toBe(false);
  });

  it('wraps every selection, undone in one step', () => {
    const editor = create('one two');
    editor.setSelections([
      { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 3 } },
      { anchor: { line: 0, ch: 4 }, head: { line: 0, ch: 7 } },
    ]);
    commands['snippet:if']!(editor);
    expect(editor.getValue()).toBe(
      `${expected('if', 'one').text} ${expected('if', 'two').text}`,
    );
    const first = expected('if', 'one');
    const cursors = editor.listSelections().map((s) => s.head.ch);
    expect(cursors[0]).toBe(first.slot);
    expect(editor.listSelections()).toHaveLength(2);
    editor.undo();
    expect(editor.getValue()).toBe('one two');
  });

  it('puts the cursor in the slot of a snippet that wraps nothing', () => {
    const editor = create('');
    commands['snippet:goto']!(editor);
    const { text, slot } = expected('goto', '');
    expect(editor.getValue()).toBe(text);
    expect(editor.getCursor().ch).toBe(slot);
  });

  it('has a snippet command for every snippet', () => {
    for (const snippet of snippets) {
      expect(commands[`snippet:${snippet.id}`]).toBeTypeOf('function');
    }
  });
});

describe('check', () => {
  it('marks the error span with its message and alerts the count', () => {
    const editor = create('{if $x');
    commands.check!(editor);
    const marks = editor.getAllMarks();
    expect(marks).toHaveLength(1);
    const mark = marks[0]!;
    const found = mark.find() as CodeMirror.MarkerRange;
    expect(found.from).toEqual(expect.objectContaining({ line: 0, ch: 0 }));
    expect(found.to.ch).toBeGreaterThan(0);
    // CodeMirror keeps the options of markText on the marker
    const { title } = mark as unknown as { title?: string };
    expect(title).toBeTruthy();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]![0]).toContain('1 problem');
    expect(alert.mock.calls[0]![0]).toContain(title);
  });

  it('says so when there is no problem', () => {
    const editor = create('ok');
    commands.check!(editor);
    expect(editor.getAllMarks()).toHaveLength(0);
    expect(alert).toHaveBeenCalledWith('No problems found');
  });

  it('does not report macros and widgets defined elsewhere in the story', () => {
    for (const text of [
      '{mycustom 1}',
      '{mycustom $x "a"}',
      '{mycustom 1}body{/mycustom}',
      '{mycustom}{/mycustom}',
    ]) {
      const editor = create(text);
      alert.mockClear();
      commands.check!(editor);
      expect(editor.getAllMarks(), text).toHaveLength(0);
      expect(alert, text).toHaveBeenCalledWith('No problems found');
    }
  });

  it('still reports the other problems of a passage with user macros', () => {
    for (const text of [
      '{mycustom 1}\n{if $x',
      '{mycustom}body{/mycustom}\n{if $x',
    ]) {
      const editor = create(text);
      alert.mockClear();
      commands.check!(editor);
      expect(editor.getAllMarks(), text).toHaveLength(1);
      expect(alert.mock.calls[0]![0], text).toContain('1 problem found');
    }
    // A user macro's own unclosed tag and bad code are still errors
    const editor = create('{mycustom {if');
    commands.check!(editor);
    expect(editor.getAllMarks().length).toBeGreaterThan(0);
  });

  it('reads a closer as the tokenizer does: {/foo} in a string closes nothing, so {foo} is a plain unknown macro, not reported', () => {
    for (const text of [
      '{set $s = "{/foo}"}{foo}',
      '{do}// {/foo}\n{/do}{foo}',
    ]) {
      const editor = create(text);
      alert.mockClear();
      commands.check!(editor);
      expect(editor.getAllMarks(), text).toHaveLength(0);
      expect(alert, text).toHaveBeenCalledWith('No problems found');
    }
  });

  it('clears its marks on the next change and when it runs again', () => {
    const editor = create('{if $x');
    commands.check!(editor);
    expect(editor.getAllMarks()).toHaveLength(1);
    commands.check!(editor);
    expect(editor.getAllMarks()).toHaveLength(1);
    editor.replaceRange('!', { line: 0, ch: 0 });
    expect(editor.getAllMarks()).toHaveLength(0);
    // A second check registers no second listener and marks again
    commands.check!(editor);
    expect(editor.getAllMarks()).toHaveLength(1);
    editor.replaceRange('!', { line: 0, ch: 0 });
    expect(editor.getAllMarks()).toHaveLength(0);
  });

  it('does not throw on empty or CRLF text', () => {
    expect(() => commands.check!(create(''))).not.toThrow();
    const crlf = create('a\r\n{if $x\r\nb', { lineSeparator: '\r\n' });
    expect(() => commands.check!(crlf)).not.toThrow();
    expect(crlf.getAllMarks()).toHaveLength(1);
    expect(crlf.getAllMarks()[0]!.find()).toEqual(
      expect.objectContaining({
        from: expect.objectContaining({ line: 1, ch: 0 }),
      }),
    );
  });
});

describe('format', () => {
  it('indents block bodies, keeps the cursor line and undoes in one step', async () => {
    const text = '{if $a}\nyes\n{/if}';
    const editor = create(text);
    editor.setCursor({ line: 1, ch: 1 });
    await commands.format!(editor);
    expect(editor.getValue()).toBe('{if $a}\n  yes\n{/if}\n');
    expect(editor.getCursor().line).toBe(1);
    editor.undo();
    expect(editor.getValue()).toBe(text);
  });

  it('indents the body of a block macro the static default does not know', async () => {
    const editor = create('{dialog "Hi"}\nyes\n');
    await commands.format!(editor);
    expect(editor.getValue()).toBe('{dialog "Hi"}\n  yes\n');
  });

  it('indents the body of a macro the passage closes itself', async () => {
    const editor = create('{mine}\nyes\n{/mine}');
    await commands.format!(editor);
    expect(editor.getValue()).toBe('{mine}\n  yes\n{/mine}\n');
  });

  it('formats embedded script, style and HTML through standalone Prettier', async () => {
    const editor = create(
      '<script>\nvar   a=1;\n</script>\n<style>\na { color:red }\n</style>\n',
    );
    await commands.format!(editor);
    const value = editor.getValue();
    expect(value).toContain('var a = 1;');
    expect(value).toContain('color: red;');
  });

  it('does nothing when the text changed while it ran', async () => {
    const editor = create('{if $a}\nyes\n{/if}');
    const done = commands.format!(editor);
    editor.setValue('something else');
    await done;
    expect(editor.getValue()).toBe('something else');
  });

  it('does not throw on empty text', async () => {
    const editor = create('');
    await expect(commands.format!(editor)).resolves.toBeUndefined();
    expect(alert).not.toHaveBeenCalled();
  });

  it('keeps the line endings of the passage', async () => {
    const editor = create('{if $a}\r\nyes\r\n{/if}', {
      lineSeparator: '\r\n',
    });
    await commands.format!(editor);
    expect(editor.getValue()).toBe('{if $a}\r\n  yes\r\n{/if}\r\n');
  });

  it('alerts an unexpected error and leaves the text as it was', async () => {
    const editor = create('{if $a}\nyes\n{/if}');
    const spy = vi.spyOn(editor, 'getValue');
    spy.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await commands.format!(editor);
    expect(alert).toHaveBeenCalledWith('boom');
    spy.mockRestore();
    expect(editor.getValue()).toBe('{if $a}\nyes\n{/if}');
  });
});

describe('toolbar', () => {
  it('only names commands that exist', () => {
    const editor = create('x');
    const names: string[] = [];
    for (const item of toolbar(editor, {
      appTheme: 'light',
      foregroundColor: '#000',
      locale: 'en',
    })) {
      if (item.type === 'button') names.push(item.command);
      if (item.type === 'menu') {
        for (const sub of item.items) {
          if (sub.type === 'button') names.push(sub.command);
        }
      }
    }
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) expect(Object.keys(commands)).toContain(name);
  });
});
