// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { parseStoryData } from '../../src/parser';
import { tokenize } from '../../src/markup/tokenizer';

function setDocumentHTML(html: string) {
  document.body.innerHTML = html;
}

const MINIMAL_STORY = `
<tw-storydata name="My Story" startnode="1" ifid="ABCD-1234" format="spindle" format-version="0.1.0">
  <tw-passagedata pid="1" name="Start" tags="">Hello world</tw-passagedata>
</tw-storydata>
`;

describe('parseStoryData', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('parses story name, startnode, ifid, format, format-version', () => {
    setDocumentHTML(MINIMAL_STORY);
    const data = parseStoryData();

    expect(data.name).toBe('My Story');
    expect(data.startNode).toBe(1);
    expect(data.ifid).toBe('ABCD-1234');
    expect(data.format).toBe('spindle');
    expect(data.formatVersion).toBe('0.1.0');
  });

  it('parses multiple passages with pid, name, tags, content', () => {
    setDocumentHTML(`
      <tw-storydata name="Test" startnode="1" ifid="X" format="" format-version="">
        <tw-passagedata pid="1" name="Start" tags="intro">Welcome</tw-passagedata>
        <tw-passagedata pid="2" name="Room" tags="explore">A dark room</tw-passagedata>
      </tw-storydata>
    `);
    const data = parseStoryData();

    expect(data.passages.size).toBe(2);

    const start = data.passages.get('Start')!;
    expect(start.pid).toBe(1);
    expect(start.name).toBe('Start');
    expect(start.tags).toEqual(['intro']);
    expect(start.content).toBe('Welcome');

    const room = data.passages.get('Room')!;
    expect(room.pid).toBe(2);
    expect(room.content).toBe('A dark room');
  });

  it('parses user CSS from style type=text/twine-css', () => {
    setDocumentHTML(`
      <tw-storydata name="Test" startnode="1" ifid="X" format="" format-version="">
        <style type="text/twine-css">body { color: red; }</style>
        <tw-passagedata pid="1" name="Start" tags="">Hi</tw-passagedata>
      </tw-storydata>
    `);
    const data = parseStoryData();

    expect(data.userCSS).toBe('body { color: red; }');
  });

  it('parses user JS from script type=text/twine-javascript', () => {
    setDocumentHTML(`
      <tw-storydata name="Test" startnode="1" ifid="X" format="" format-version="">
        <script type="text/twine-javascript">console.log("hi");</script>
        <tw-passagedata pid="1" name="Start" tags="">Hi</tw-passagedata>
      </tw-storydata>
    `);
    const data = parseStoryData();

    expect(data.userScript).toBe('console.log("hi");');
  });

  it('throws when no tw-storydata present', () => {
    setDocumentHTML('<div>No story here</div>');
    expect(() => parseStoryData()).toThrow(/No <tw-storydata> element found/);
  });

  it('decodes HTML entities in passage content', () => {
    setDocumentHTML(`
      <tw-storydata name="Test" startnode="1" ifid="X" format="" format-version="">
        <tw-passagedata pid="1" name="Start" tags="">Tom &amp; Jerry &lt;3</tw-passagedata>
      </tw-storydata>
    `);
    const data = parseStoryData();

    expect(data.passages.get('Start')!.content).toBe('Tom & Jerry <3');
  });

  it('keeps a no-break space as U+00A0, not the &nbsp; innerHTML writes', () => {
    setDocumentHTML(`
      <tw-storydata name="Test" startnode="1" ifid="X" format="" format-version="">
        <tw-passagedata pid="1" name="Start" tags="">{set $x = "a b"}[[Café Noir]] &amp;nbsp;</tw-passagedata>
      </tw-storydata>
    `);
    const data = parseStoryData();

    // An author-written `&nbsp;` (stored as &amp;nbsp;) stays text.
    expect(data.passages.get('Start')!.content).toBe(
      '{set $x = "a b"}[[Café Noir]] &nbsp;',
    );
  });

  it('parses passages with multiple space-separated tags', () => {
    setDocumentHTML(`
      <tw-storydata name="Test" startnode="1" ifid="X" format="" format-version="">
        <tw-passagedata pid="1" name="Start" tags="intro tutorial important">Hi</tw-passagedata>
      </tw-storydata>
    `);
    const data = parseStoryData();

    expect(data.passages.get('Start')!.tags).toEqual([
      'intro',
      'tutorial',
      'important',
    ]);
  });

  it('treats empty tags attribute as empty array', () => {
    setDocumentHTML(`
      <tw-storydata name="Test" startnode="1" ifid="X" format="" format-version="">
        <tw-passagedata pid="1" name="Start" tags="">Hi</tw-passagedata>
      </tw-storydata>
    `);
    const data = parseStoryData();

    expect(data.passages.get('Start')!.tags).toEqual([]);
  });

  it('preserves HTML tags in passage content when HTML-encoded', () => {
    setDocumentHTML(`
      <tw-storydata name="Test" startnode="1" ifid="X" format="" format-version="">
        <tw-passagedata pid="1" name="Start" tags="">{button}&lt;div class=&quot;nav-item&quot;&gt;Click me&lt;/div&gt;{set $myVar = &quot;clicked&quot;}{/button}</tw-passagedata>
      </tw-storydata>
    `);
    const data = parseStoryData();
    expect(data.passages.get('Start')!.content).toBe(
      '{button}<div class="nav-item">Click me</div>{set $myVar = "clicked"}{/button}',
    );
  });

  it('preserves HTML tags in passage content when NOT HTML-encoded', () => {
    setDocumentHTML(`
      <tw-storydata name="Test" startnode="1" ifid="X" format="" format-version="">
        <tw-passagedata pid="1" name="Start" tags="">{button}<div class="nav-item">Click me</div>{set $myVar = "clicked"}{/button}</tw-passagedata>
      </tw-storydata>
    `);
    const data = parseStoryData();
    // The <div> should be preserved as literal text for the tokenizer
    expect(data.passages.get('Start')!.content).toBe(
      '{button}<div class="nav-item">Click me</div>{set $myVar = "clicked"}{/button}',
    );
  });

  describe('passage HTML that is NOT HTML-encoded', () => {
    /** The content of a passage whose data holds `html` as written. */
    function contentOf(html: string): string {
      setDocumentHTML(
        `<tw-storydata name="T" startnode="1"><tw-passagedata pid="1" name="Start">${html}</tw-passagedata></tw-storydata>`,
      );
      return parseStoryData().passages.get('Start')!.content;
    }

    /** The attributes the passage tokenizer reads from the first tag. */
    function attributesOf(content: string): Record<string, string> {
      const tag = tokenize(content).find((t) => t.type === 'html');
      return tag?.type === 'html' ? tag.attributes : {};
    }

    it('quotes an attribute value holding double quotes', () => {
      const content = contentOf(`<i title='say "hi"'>t</i>`);
      expect(content).toBe(`<i title='say "hi"'>t</i>`);
      expect(attributesOf(content)).toEqual({ title: 'say "hi"' });
    });

    it('escapes quotes in text when the value holds both kinds', () => {
      const content = contentOf(`<i title="it's &quot;x&quot;">t</i>`);
      expect(content).toBe(`<i title="it's &quot;x&quot;">t</i>`);
    });

    it('keeps quotes inside markup in a value as written', () => {
      const content = contentOf(
        `<i title="{print 'a' + &quot;b&quot;} it's">t</i>`,
      );
      expect(content).toBe(`<i title="{print 'a' + "b"} it's">t</i>`);
      expect(attributesOf(content)).toEqual({
        title: `{print 'a' + "b"} it's`,
      });
    });

    it('escapes only the quotes outside markup in a value', () => {
      const content = contentOf(
        `<i title="{print &quot;a&quot;} it's &quot;b&quot;">t</i>`,
      );
      expect(content).toBe(`<i title="{print "a"} it's &quot;b&quot;">t</i>`);
    });

    it('escapes only the quotes outside references in a code attribute', () => {
      const content = contentOf(
        `<b onclick="f({$a + &quot;x&quot;}, 'it&quot;s')">t</b>`,
      );
      expect(content).toBe(`<b onclick="f({$a + "x"}, 'it&quot;s')">t</b>`);
    });

    // Comments too, but happy-dom decodes references in comments, which
    // browsers don't (see test/e2e/html-parsing.test.ts).
    it('keeps text the serializer leaves unescaped as written', () => {
      expect(contentOf('<style>p::after { content: "&amp;" }</style>')).toBe(
        '<style>p::after { content: "&amp;" }</style>',
      );
    });

    it('writes void elements without an end tag', () => {
      expect(contentOf('a<br>b<img src="x.png" alt="">c')).toBe(
        'a<br>b<img src="x.png" alt="">c',
      );
    });
  });

  it('makes passages accessible by both name and pid', () => {
    setDocumentHTML(MINIMAL_STORY);
    const data = parseStoryData();

    const byName = data.passages.get('Start');
    const byPid = data.passagesById.get(1);
    expect(byName).toBe(byPid);
  });
});
