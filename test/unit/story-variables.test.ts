import { describe, it, expect } from "vitest";
import {
  parseStoryVariables,
  validatePassages,
  extractDefaults,
} from "../../src/story-variables";
import type { Passage } from "../../src/parser";

function makePassage(name: string, content: string): Passage {
  return { pid: 0, name, tags: [], content };
}

function makePassages(...entries: [string, string][]): Map<string, Passage> {
  const map = new Map<string, Passage>();
  for (const [name, content] of entries) {
    map.set(name, makePassage(name, content));
  }
  return map;
}

describe("parseStoryVariables", () => {
  it("parses number declarations", () => {
    const schema = parseStoryVariables("$health = 100");
    expect(schema.get("health")).toEqual({
      name: "health",
      type: "number",
      default: 100,
    });
  });

  it("parses string declarations", () => {
    const schema = parseStoryVariables('$name = "Hero"');
    expect(schema.get("name")).toEqual({
      name: "name",
      type: "string",
      default: "Hero",
    });
  });

  it("parses boolean declarations", () => {
    const schema = parseStoryVariables("$hasKey = false");
    expect(schema.get("hasKey")).toEqual({
      name: "hasKey",
      type: "boolean",
      default: false,
    });
  });

  it("parses array declarations", () => {
    const schema = parseStoryVariables("$inventory = []");
    const entry = schema.get("inventory")!;
    expect(entry.type).toBe("array");
    expect(entry.default).toEqual([]);
  });

  it("parses object declarations with field schema", () => {
    const schema = parseStoryVariables(
      '$player = { health: 100, name: "Hero", level: 1 }'
    );
    const entry = schema.get("player")!;
    expect(entry.type).toBe("object");
    expect(entry.fields!.get("health")!.type).toBe("number");
    expect(entry.fields!.get("name")!.type).toBe("string");
    expect(entry.fields!.get("level")!.type).toBe("number");
    expect(entry.default).toEqual({ health: 100, name: "Hero", level: 1 });
  });

  it("parses nested object declarations", () => {
    const schema = parseStoryVariables(
      "$game = { player: { hp: 50 }, settings: { difficulty: 1 } }"
    );
    const entry = schema.get("game")!;
    expect(entry.type).toBe("object");
    const player = entry.fields!.get("player")!;
    expect(player.type).toBe("object");
    expect(player.fields!.get("hp")!.type).toBe("number");
  });

  it("parses multiple declarations", () => {
    const schema = parseStoryVariables(
      '$health = 100\n$name = "Hero"\n$hasKey = false'
    );
    expect(schema.size).toBe(3);
    expect(schema.get("health")!.type).toBe("number");
    expect(schema.get("name")!.type).toBe("string");
    expect(schema.get("hasKey")!.type).toBe("boolean");
  });

  it("skips blank lines", () => {
    const schema = parseStoryVariables("$a = 1\n\n$b = 2\n\n");
    expect(schema.size).toBe(2);
  });

  it("throws on invalid declaration syntax", () => {
    expect(() => parseStoryVariables("not a declaration")).toThrow(
      /Invalid declaration/
    );
  });

  it("throws on invalid expression", () => {
    expect(() => parseStoryVariables("$x = {{{")).toThrow(/Failed to evaluate/);
  });
});

describe("extractDefaults", () => {
  it("extracts default values from schema", () => {
    const schema = parseStoryVariables('$health = 100\n$name = "Hero"');
    const defaults = extractDefaults(schema);
    expect(defaults).toEqual({ health: 100, name: "Hero" });
  });
});

describe("validatePassages", () => {
  it("accepts valid variable references", () => {
    const schema = parseStoryVariables("$health = 100\n$name = \"Hero\"");
    const passages = makePassages(
      ["StoryVariables", "$health = 100\n$name = \"Hero\""],
      ["Start", "Your health is $health and name is $name"]
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toEqual([]);
  });

  it("catches undeclared variable references", () => {
    const schema = parseStoryVariables("$health = 100");
    const passages = makePassages(
      ["StoryVariables", "$health = 100"],
      ["Start", "Your score is $score"]
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Undeclared variable.*\$score/);
    expect(errors[0]).toMatch(/Passage "Start"/);
  });

  it("catches undeclared object field references", () => {
    const schema = parseStoryVariables(
      '$player = { health: 100, name: "Hero" }'
    );
    const passages = makePassages(
      ["StoryVariables", '$player = { health: 100, name: "Hero" }'],
      ["Start", "Mana: $player.mana"]
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Undeclared field.*\$player\.mana/);
  });

  it("catches field access on non-object types", () => {
    const schema = parseStoryVariables("$health = 100");
    const passages = makePassages(
      ["StoryVariables", "$health = 100"],
      ["Start", "Value: $health.something"]
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Cannot access field.*"something".*\$health.*number/);
  });

  it("skips for-loop locals", () => {
    const schema = parseStoryVariables("$inventory = []");
    const passages = makePassages(
      ["StoryVariables", "$inventory = []"],
      ["Start", "{for $item of $inventory}$item{/for}"]
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toEqual([]);
  });

  it("skips for-loop locals with index", () => {
    const schema = parseStoryVariables("$inventory = []");
    const passages = makePassages(
      ["StoryVariables", "$inventory = []"],
      ["Start", "{for $i, $item of $inventory}$i: $item{/for}"]
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toEqual([]);
  });

  it("validates deeply nested object field access", () => {
    const schema = parseStoryVariables(
      "$game = { player: { stats: { hp: 50 } } }"
    );
    const passages = makePassages(
      ["StoryVariables", "$game = { player: { stats: { hp: 50 } } }"],
      ["Start", "HP: $game.player.stats.hp"]
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toEqual([]);
  });

  it("catches invalid deep field access", () => {
    const schema = parseStoryVariables(
      "$game = { player: { stats: { hp: 50 } } }"
    );
    const passages = makePassages(
      ["StoryVariables", "$game = { player: { stats: { hp: 50 } } }"],
      ["Start", "MP: $game.player.stats.mp"]
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Undeclared field.*\$game\.player\.stats\.mp/);
  });

  it("reports multiple errors across passages", () => {
    const schema = parseStoryVariables("$health = 100");
    const passages = makePassages(
      ["StoryVariables", "$health = 100"],
      ["Start", "Score: $score"],
      ["Room", "Gold: $gold"]
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toHaveLength(2);
  });

  it("does not validate the StoryVariables passage itself", () => {
    const schema = parseStoryVariables("$health = 100");
    // StoryVariables content has $health which is declared — but even if
    // it had odd references, it should be skipped
    const passages = makePassages(
      ["StoryVariables", "$health = 100"],
      ["Start", "HP: $health"]
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toEqual([]);
  });

  it("validates StoryInit passage like any other", () => {
    const schema = parseStoryVariables("$health = 100");
    const passages = makePassages(
      ["StoryVariables", "$health = 100"],
      ["Start", "HP: $health"],
      ["StoryInit", "{set $score = 0}"]
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Passage "StoryInit".*Undeclared variable.*\$score/);
  });
});

