import { describe, it, expect } from "vitest";
import { tokenize } from "../../src/markup/tokenizer";
import { buildAST, type ASTNode, type MacroNode } from "../../src/markup/ast";

function parse(input: string): ASTNode[] {
  return buildAST(tokenize(input));
}

describe("buildAST", () => {
  describe("flat nodes", () => {
    it("converts text tokens to text nodes", () => {
      const ast = parse("Hello world");
      expect(ast).toEqual([{ type: "text", value: "Hello world" }]);
    });

    it("converts link tokens to link nodes", () => {
      const ast = parse("[[Go|Target]]");
      expect(ast).toEqual([{ type: "link", display: "Go", target: "Target" }]);
    });

    it("converts variable tokens to variable nodes", () => {
      const ast = parse("{$health}");
      expect(ast).toEqual([{ type: "variable", name: "health", scope: "variable" }]);
    });

    it("converts temporary variable tokens", () => {
      const ast = parse("{_temp}");
      expect(ast).toEqual([{ type: "variable", name: "temp", scope: "temporary" }]);
    });

    it("self-closing macro becomes childless MacroNode", () => {
      const ast = parse("{set $x = 5}");
      expect(ast).toEqual([
        { type: "macro", name: "set", rawArgs: "$x = 5", children: [] },
      ]);
    });

    it("print macro is self-closing", () => {
      const ast = parse("{print $x + 1}");
      expect(ast).toEqual([
        { type: "macro", name: "print", rawArgs: "$x + 1", children: [] },
      ]);
    });
  });

  describe("block macros", () => {
    it("nests children inside if block", () => {
      const ast = parse("{if $x}hello{/if}");
      expect(ast).toHaveLength(1);
      const node = ast[0] as MacroNode;
      expect(node.type).toBe("macro");
      expect(node.name).toBe("if");
      expect(node.branches).toHaveLength(1);
      expect(node.branches![0].rawArgs).toBe("$x");
      expect(node.branches![0].children).toEqual([
        { type: "text", value: "hello" },
      ]);
    });

    it("handles if/else branches", () => {
      const ast = parse("{if $x}yes{else}no{/if}");
      const node = ast[0] as MacroNode;
      expect(node.branches).toHaveLength(2);
      expect(node.branches![0].rawArgs).toBe("$x");
      expect(node.branches![0].children).toEqual([
        { type: "text", value: "yes" },
      ]);
      expect(node.branches![1].rawArgs).toBe("");
      expect(node.branches![1].children).toEqual([
        { type: "text", value: "no" },
      ]);
    });

    it("handles if/elseif/else branches", () => {
      const ast = parse("{if $a}A{elseif $b}B{else}C{/if}");
      const node = ast[0] as MacroNode;
      expect(node.branches).toHaveLength(3);
      expect(node.branches![0].rawArgs).toBe("$a");
      expect(node.branches![1].rawArgs).toBe("$b");
      expect(node.branches![2].rawArgs).toBe("");
    });

    it("nests children inside for block", () => {
      const ast = parse("{for $item of $list}item{/for}");
      const node = ast[0] as MacroNode;
      expect(node.name).toBe("for");
      expect(node.rawArgs).toBe("$item of $list");
      expect(node.children).toEqual([{ type: "text", value: "item" }]);
    });

    it("nests children inside do block", () => {
      const ast = parse("{do}$x = 5{/do}");
      const node = ast[0] as MacroNode;
      expect(node.name).toBe("do");
      expect(node.children).toEqual([{ type: "text", value: "$x = 5" }]);
    });

    it("handles nested block macros", () => {
      const ast = parse("{if $a}{if $b}inner{/if}{/if}");
      const outer = ast[0] as MacroNode;
      expect(outer.branches![0].children).toHaveLength(1);
      const inner = outer.branches![0].children[0] as MacroNode;
      expect(inner.name).toBe("if");
      expect(inner.branches![0].children).toEqual([
        { type: "text", value: "inner" },
      ]);
    });

    it("handles block macro with links inside", () => {
      const ast = parse("{if $x}[[Go|Target]]{/if}");
      const node = ast[0] as MacroNode;
      expect(node.branches![0].children).toEqual([
        { type: "link", display: "Go", target: "Target" },
      ]);
    });
  });

  describe("className passthrough", () => {
    it("passes className from link token to link node", () => {
      const ast = parse("[[.fancy Go|Target]]");
      expect(ast).toEqual([{ type: "link", display: "Go", target: "Target", className: "fancy" }]);
    });

    it("passes className from variable token to variable node", () => {
      const ast = parse("{.hero-name $name}");
      expect(ast).toEqual([{ type: "variable", name: "name", scope: "variable", className: "hero-name" }]);
    });

    it("passes className to block macro node", () => {
      const ast = parse("{.highlight if $x}hello{/if}");
      const node = ast[0] as MacroNode;
      expect(node.className).toBe("highlight");
      expect(node.branches![0].children).toEqual([{ type: "text", value: "hello" }]);
    });

    it("passes className to self-closing macro node", () => {
      const ast = parse("{.muted print $x + 1}");
      expect(ast).toEqual([
        { type: "macro", name: "print", rawArgs: "$x + 1", children: [], className: "muted" },
      ]);
    });

    it("nodes without className omit the field", () => {
      const ast = parse("[[Go|Target]]");
      expect("className" in ast[0]).toBe(false);
    });
  });

  describe("errors", () => {
    it("throws on unclosed block macro", () => {
      expect(() => parse("{if $x}hello")).toThrow("Unclosed {if} macro");
    });

    it("throws on mismatched close tag", () => {
      expect(() => parse("{if $x}hello{/for}")).toThrow(
        "Expected {/if} but found {/for}"
      );
    });

    it("throws on unexpected close tag", () => {
      expect(() => parse("{/if}")).toThrow("Unexpected closing {/if}");
    });

    it("throws on elseif without if", () => {
      expect(() => parse("{elseif $x}")).toThrow("{elseif} without matching {if}");
    });

    it("throws on else without if", () => {
      expect(() => parse("{else}")).toThrow("{else} without matching {if}");
    });

    it("includes position in error for unclosed macro", () => {
      expect(() => parse("abc{if $x}hello")).toThrow("character 3");
    });
  });

  describe("mixed content", () => {
    it("handles complete passage with macros and links", () => {
      const ast = parse("Hello {$name}! {set $seen = true}\n[[Next]]");
      expect(ast.map((n) => n.type)).toEqual([
        "text", "variable", "text", "macro", "text", "link",
      ]);
    });
  });
});
