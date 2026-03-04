import { useStoryStore } from './store';
import { tokenize } from './markup/tokenizer';
import { buildAST } from './markup/ast';
import { execute } from './expression';
import type { ASTNode } from './markup/ast';
import { setSaveTitlePassage } from './saves/save-manager';
import { deepClone } from './class-registry';

/**
 * Walk AST nodes from StoryInit and execute {set} and {do} imperatively
 * (no Preact rendering needed for initialization).
 */
function walkAndExecute(
  nodes: ASTNode[],
  vars: Record<string, unknown>,
  temps: Record<string, unknown>,
) {
  for (const node of nodes) {
    if (node.type !== 'macro') continue;

    if (node.name === 'set') {
      execute(node.rawArgs, vars, temps);
    } else if (node.name === 'do') {
      const code = node.children
        .map((n) => (n.type === 'text' ? n.value : ''))
        .join('');
      execute(code, vars, temps);
    }
  }
}

/**
 * Execute the StoryInit passage: tokenize, parse, and run all {set}/{do} macros.
 * Called during boot and after restart() to ensure variables are initialized.
 */
export function executeStoryInit() {
  const state = useStoryStore.getState();
  if (!state.storyData) return;

  const storyInit = state.storyData.passages.get('StoryInit');
  if (!storyInit) return;

  const tokens = tokenize(storyInit.content);
  const ast = buildAST(tokens);

  const vars = deepClone(state.variables);
  const temps = deepClone(state.temporary);

  walkAndExecute(ast, vars, temps);

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

  // Register SaveTitle passage if it exists
  const saveTitlePassage = state.storyData.passages.get('SaveTitle');
  if (saveTitlePassage) {
    setSaveTitlePassage(saveTitlePassage.content);
  }
}
