import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const projectRoot = resolve(import.meta.dirname!, "../..");
const formatJsPath = resolve(projectRoot, "dist/format.js");
const formatJsonPath = resolve(projectRoot, "format.json");

describe("build output: dist/format.js", () => {
  const raw = readFileSync(formatJsPath, "utf-8");
  const formatMeta = JSON.parse(readFileSync(formatJsonPath, "utf-8"));

  it("file exists and is non-empty", () => {
    expect(raw.length).toBeGreaterThan(0);
  });

  it("starts with window.storyFormat(", () => {
    expect(raw.startsWith("window.storyFormat(")).toBe(true);
  });

  const jsonStr = raw.slice("window.storyFormat(".length, -1);
  let parsed: Record<string, unknown>;

  it("parses as valid JSON inside the JSONP wrapper", () => {
    parsed = JSON.parse(jsonStr);
    expect(parsed).toBeDefined();
  });

  it("has required fields: name, version, source, proofing", () => {
    parsed ??= JSON.parse(jsonStr);
    expect(parsed).toHaveProperty("name");
    expect(parsed).toHaveProperty("version");
    expect(parsed).toHaveProperty("source");
    expect(parsed).toHaveProperty("proofing");
  });

  it("source contains {{STORY_NAME}}", () => {
    parsed ??= JSON.parse(jsonStr);
    expect(parsed.source).toContain("{{STORY_NAME}}");
  });

  it("source contains {{STORY_DATA}}", () => {
    parsed ??= JSON.parse(jsonStr);
    expect(parsed.source).toContain("{{STORY_DATA}}");
  });

  it('source contains <div id="root">', () => {
    parsed ??= JSON.parse(jsonStr);
    expect(parsed.source).toContain('<div id="root">');
  });

  it("source is valid HTML (has DOCTYPE, head, body)", () => {
    parsed ??= JSON.parse(jsonStr);
    const source = parsed.source as string;
    expect(source).toContain("<!DOCTYPE html>");
    expect(source).toContain("<head>");
    expect(source).toContain("<body>");
  });

  it("name matches format.json", () => {
    parsed ??= JSON.parse(jsonStr);
    expect(parsed.name).toBe(formatMeta.name);
  });

  it("version matches format.json", () => {
    parsed ??= JSON.parse(jsonStr);
    expect(parsed.version).toBe(formatMeta.version);
  });
});
