import { render } from "preact";
import { App } from "./components/App";
import { parseStoryData } from "./parser";
import { useStoryStore } from "./store";
import { installStoryAPI } from "./story-api";
import { tokenize } from "./markup/tokenizer";
import { buildAST } from "./markup/ast";
import { execute } from "./expression";
import type { ASTNode } from "./markup/ast";
import "./styles.css";

/**
 * Walk AST nodes from StoryInit and execute {set} and {do} imperatively
 * (no Preact rendering needed for initialization).
 */
function executeStoryInit(nodes: ASTNode[]) {
  const state = useStoryStore.getState();
  const vars = { ...state.variables };
  const temps = { ...state.temporary };

  function walk(nodeList: ASTNode[]) {
    for (const node of nodeList) {
      if (node.type !== "macro") continue;

      if (node.name === "set") {
        execute(node.rawArgs, vars, temps);
      } else if (node.name === "do") {
        const code = node.children
          .map((n) => (n.type === "text" ? n.value : ""))
          .join("");
        execute(code, vars, temps);
      }
    }
  }

  walk(nodes);

  // Apply all changes to the store
  for (const key of Object.keys(vars)) {
    if (vars[key] !== state.variables[key]) {
      state.setVariable(key, vars[key]);
    }
  }
  for (const key of Object.keys(temps)) {
    if (temps[key] !== state.temporary[key]) {
      state.setTemporary(key, temps[key]);
    }
  }
}

function boot() {
  const storyData = parseStoryData();

  // Install Story API before author script runs
  installStoryAPI();

  // Apply author CSS
  if (storyData.userCSS) {
    const style = document.createElement("style");
    style.textContent = storyData.userCSS;
    document.head.appendChild(style);
  }

  // Execute author JavaScript
  if (storyData.userScript) {
    try {
      new Function(storyData.userScript)();
    } catch (err) {
      console.error("react-twine: Error in story JavaScript:", err);
    }
  }

  useStoryStore.getState().init(storyData);

  // Execute StoryInit passage if it exists
  const storyInit = storyData.passages.get("StoryInit");
  if (storyInit) {
    try {
      const tokens = tokenize(storyInit.content);
      const ast = buildAST(tokens);
      executeStoryInit(ast);
    } catch (err) {
      console.error("react-twine: Error in StoryInit passage:", err);
    }
  }

  const root = document.getElementById("root");
  if (!root) {
    throw new Error('react-twine: No <div id="root"> element found.');
  }

  render(<App />, root);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
