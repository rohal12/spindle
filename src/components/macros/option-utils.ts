import type { ASTNode } from '../../markup/ast';
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

/** The parameters of an `{option}` sub-macro: its value. */
const OPTION_PARAMETERS = [{ name: 'value', type: 'string' }] as const;

/**
 * Walk AST children to find {option} macro nodes, returning their values.
 */
export function extractOptions(children: ASTNode[]): string[] {
  const options: string[] = [];
  for (const node of children) {
    if (node.type === 'macro' && node.name === 'option') {
      // {option "Long Sword"} gives `Long Sword`. A value that isn't one
      // quoted string loses a matching pair of quotes around it, if any.
      const { value } = parseMacroArgs(node.rawArgs, OPTION_PARAMETERS);
      options.push(
        value ?? node.rawArgs.trim().replace(/^(["'])(.+)\1$/s, '$2'),
      );
    }
  }
  return options;
}
