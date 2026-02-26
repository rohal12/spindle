// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { parseStoryData } from "../../src/parser";

function setDocumentHTML(html: string) {
  document.body.innerHTML = html;
}

const MINIMAL_STORY = `
<tw-storydata name="My Story" startnode="1" ifid="ABCD-1234" format="react-twine" format-version="0.1.0">
  <tw-passagedata pid="1" name="Start" tags="">Hello world</tw-passagedata>
</tw-storydata>
`;

describe("parseStoryData", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("parses story name, startnode, ifid, format, format-version", () => {
    setDocumentHTML(MINIMAL_STORY);
    const data = parseStoryData();

    expect(data.name).toBe("My Story");
    expect(data.startNode).toBe(1);
    expect(data.ifid).toBe("ABCD-1234");
    expect(data.format).toBe("react-twine");
    expect(data.formatVersion).toBe("0.1.0");
  });

  it("parses multiple passages with pid, name, tags, content", () => {
    setDocumentHTML(`
      <tw-storydata name="Test" startnode="1" ifid="X" format="" format-version="">
        <tw-passagedata pid="1" name="Start" tags="intro">Welcome</tw-passagedata>
        <tw-passagedata pid="2" name="Room" tags="explore">A dark room</tw-passagedata>
      </tw-storydata>
    `);
    const data = parseStoryData();

    expect(data.passages.size).toBe(2);

    const start = data.passages.get("Start")!;
    expect(start.pid).toBe(1);
    expect(start.name).toBe("Start");
    expect(start.tags).toEqual(["intro"]);
    expect(start.content).toBe("Welcome");

    const room = data.passages.get("Room")!;
    expect(room.pid).toBe(2);
    expect(room.content).toBe("A dark room");
  });

  it("parses user CSS from style type=text/twine-css", () => {
    setDocumentHTML(`
      <tw-storydata name="Test" startnode="1" ifid="X" format="" format-version="">
        <style type="text/twine-css">body { color: red; }</style>
        <tw-passagedata pid="1" name="Start" tags="">Hi</tw-passagedata>
      </tw-storydata>
    `);
    const data = parseStoryData();

    expect(data.userCSS).toBe("body { color: red; }");
  });

  it("parses user JS from script type=text/twine-javascript", () => {
    setDocumentHTML(`
      <tw-storydata name="Test" startnode="1" ifid="X" format="" format-version="">
        <script type="text/twine-javascript">console.log("hi");</script>
        <tw-passagedata pid="1" name="Start" tags="">Hi</tw-passagedata>
      </tw-storydata>
    `);
    const data = parseStoryData();

    expect(data.userScript).toBe('console.log("hi");');
  });

  it("throws when no tw-storydata present", () => {
    setDocumentHTML("<div>No story here</div>");
    expect(() => parseStoryData()).toThrow(/No <tw-storydata> element found/);
  });

  it("decodes HTML entities in passage content", () => {
    setDocumentHTML(`
      <tw-storydata name="Test" startnode="1" ifid="X" format="" format-version="">
        <tw-passagedata pid="1" name="Start" tags="">Tom &amp; Jerry &lt;3</tw-passagedata>
      </tw-storydata>
    `);
    const data = parseStoryData();

    expect(data.passages.get("Start")!.content).toBe("Tom & Jerry <3");
  });

  it("parses passages with multiple space-separated tags", () => {
    setDocumentHTML(`
      <tw-storydata name="Test" startnode="1" ifid="X" format="" format-version="">
        <tw-passagedata pid="1" name="Start" tags="intro tutorial important">Hi</tw-passagedata>
      </tw-storydata>
    `);
    const data = parseStoryData();

    expect(data.passages.get("Start")!.tags).toEqual([
      "intro",
      "tutorial",
      "important",
    ]);
  });

  it("treats empty tags attribute as empty array", () => {
    setDocumentHTML(`
      <tw-storydata name="Test" startnode="1" ifid="X" format="" format-version="">
        <tw-passagedata pid="1" name="Start" tags="">Hi</tw-passagedata>
      </tw-storydata>
    `);
    const data = parseStoryData();

    expect(data.passages.get("Start")!.tags).toEqual([]);
  });

  it("makes passages accessible by both name and pid", () => {
    setDocumentHTML(MINIMAL_STORY);
    const data = parseStoryData();

    const byName = data.passages.get("Start");
    const byPid = data.passagesById.get(1);
    expect(byName).toBe(byPid);
  });
});
