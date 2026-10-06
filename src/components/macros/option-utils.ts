import type { ASTNode } from '../../markup/ast';
import { readWholeQuoted } from './arg-utils';
import { parseMacroArgs } from './macro-args';

/** `$var "placeholder"`, the arguments of the input macros. */
export function parseVarArgs(rawArgs: string): {
  varName: string;
  placeholder: string;
} {
  const { variable = '', placeholder = '' } = parseMacroArgs(rawArgs, [
    { name: 'variable', type: 'variable' },
    { name: 'placeholder', type: 'string' },
  ]);
  return { varName: variable.replace(/["']/g, ''), placeholder };
}

/**
 * Walk AST children to find {option} macro nodes, returning their rawArgs as values.
 */
export function extractOptions(children: ASTNode[]): string[] {
  const options: string[] = [];
  for (const node of children) {
    if (node.type === 'macro' && node.name === 'option') {
      const raw = node.rawArgs.trim();
      // Strip surrounding quotes so {option "Long Sword"} gives "Long Sword"
      const stripped =
        readWholeQuoted(raw) ?? raw.replace(/^(["'])(.+)\1$/s, '$2');
      options.push(stripped);
    }
  }
  return options;
}
