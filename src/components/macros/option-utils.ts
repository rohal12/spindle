import type { ASTNode } from '../../markup/ast';
import { parseMacroArgs } from './macro-args';
import type { ParameterDef } from '../../registry';

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
const OPTION_PARAMETERS = [
  { name: 'value', type: 'string', required: true },
] as const;

/** The parameters of the built-in sub-macros that take arguments. */
const SUB_MACRO_PARAMETERS: ReadonlyMap<string, readonly ParameterDef[]> =
  new Map([['option', OPTION_PARAMETERS]]);

/** The parameters of the built-in sub-macro `name`, if it takes any. */
export function subMacroParameters(
  name: string,
): readonly ParameterDef[] | undefined {
  return SUB_MACRO_PARAMETERS.get(name.toLowerCase());
}

/**
 * Walk AST children to find {option} macro nodes, returning their values.
 */
export function extractOptions(children: ASTNode[]): string[] {
  const options: string[] = [];
  for (const node of children) {
    if (node.type === 'macro' && node.name === 'option') {
      // {option "Long Sword"} gives `Long Sword`
      const { value } = parseMacroArgs(node.rawArgs, OPTION_PARAMETERS);
      options.push(value ?? '');
    }
  }
  return options;
}
