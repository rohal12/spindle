/**
 * Macro arguments as the built-in macros read them: through the argument
 * layer (`parseMacroArgs`) with each macro's declared parameters, in the
 * shapes the macros use.
 */
import '../../src/components/macros/Checkbox';
import '../../src/components/macros/Include';
import '../../src/components/macros/MacroLink';
import '../../src/components/macros/Radiobutton';
import '../../src/components/macros/Watch';
import { meterArgs } from '../../src/components/macros/Meter';
import { parseMacroArgs } from '../../src/components/macros/macro-args';
import { getMacroRegistry } from '../../src/registry';

/** The arguments the registered macro `name` reads from `rawArgs`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function macroArgs(name: string, rawArgs: string): Record<string, any> {
  const meta = getMacroRegistry().find((m) => m.name === name);
  if (!meta?.parameters) throw new Error(`{${name}} declares no parameters`);
  return parseMacroArgs(rawArgs, meta.parameters);
}

export function parseMeterArgs(rawArgs: string) {
  return meterArgs(macroArgs('meter', rawArgs));
}

export function parseIncludeArgs(rawArgs: string) {
  const { passage, inline } = macroArgs('include', rawArgs);
  return { nameExpr: passage ?? '', inline };
}

export function parseWatchArgs(rawArgs: string) {
  const { condition, options } = macroArgs('watch', rawArgs);
  return condition === undefined ? null : { condition, options };
}

export function parseUnwatchName(rawArgs: string): string {
  return macroArgs('unwatch', rawArgs).name ?? '';
}

export function parseCheckboxLabel(rawArgs: string): string {
  return macroArgs('checkbox', rawArgs).label ?? '';
}

export function parseRadioArgs(rawArgs: string) {
  const { value, label } = macroArgs('radiobutton', rawArgs);
  return { value: value ?? '', label: label ?? '' };
}

export function parseLinkArgs(rawArgs: string) {
  const { text, passage } = macroArgs('link', rawArgs);
  return text === undefined
    ? { display: rawArgs.trim(), passage: null }
    : { display: text, passage: passage ?? null };
}
