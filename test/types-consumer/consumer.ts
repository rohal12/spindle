// A consumer on Node's ESM resolution (NodeNext) resolves every published
// entry point and every type the type files import from each other. Each
// assignment fails to compile if a type resolves to `any` or is missing.
import type {
  ListConfig,
  Observation,
  RangeConfig,
  StoryAPI,
  ToggleConfig,
} from '@rohal12/spindle';
import type { TranscriptEntry } from '@rohal12/spindle/headless';
import type {
  ObservedAction,
  Observation as PlayObservation,
  PlaySession,
} from '@rohal12/spindle/play';
import type * as Tooling from '@rohal12/spindle/tooling';

type IsAny<T> = 0 extends 1 & T ? true : false;
type Resolved<T> = IsAny<T> extends true ? never : T;

export const checks: [
  Resolved<Observation['dialogs']>,
  Resolved<PlayObservation['actions']>,
  Resolved<ObservedAction['id']>,
  Resolved<TranscriptEntry>,
  Resolved<PlaySession['observe']>,
  Resolved<StoryAPI['observe']>,
  Resolved<keyof typeof Tooling>,
  Resolved<Tooling.ToolingMacro['widget']>,
  Resolved<ReturnType<typeof Tooling.completionContext>>,
  Resolved<Tooling.CompletionContext>,
  Resolved<Tooling.CompletionContainer>,
  Resolved<Tooling.CompletionTarget>,
  Resolved<Tooling.CompletionIdentifier>,
  Resolved<ReturnType<typeof Tooling.completionTarget>>,
  Resolved<ReturnType<typeof Tooling.macroCallAt>>,
  Resolved<Tooling.BoundVariable>,
  Resolved<ReturnType<typeof Tooling.parseBoundVariable>>,
  Resolved<Tooling.VariableReference['binding']>,
  Resolved<typeof Tooling.isSpecialPassage>,
  Resolved<ReturnType<typeof Tooling.macroCalls>>,
  Resolved<Tooling.MacroCall>,
] = [] as never;

export const widgetMacro: Tooling.ToolingMacro = {
  name: 'caption',
  block: false,
  subMacros: [],
  widget: { params: ['@value'], holds: { '@value': 'markup' } },
};

export const parameter: Tooling.ParameterDef = {
  name: 'value',
  type: 'string',
  // @ts-expect-error Widget metadata belongs to ToolingMacro, not ParameterDef.
  widget: widgetMacro.widget,
};

export const tokenOptions: Tooling.ParseMarkupOptions = {
  macros: [widgetMacro],
  text: true,
};

// Every setting type takes the optional plain-text description.
export const settingConfigs: [ToggleConfig, ListConfig, RangeConfig] = [
  { label: 'A', description: 'About A', default: true },
  { label: 'B', description: 'About B', options: ['x'], default: 'x' },
  { label: 'C', description: 'About C', min: 0, max: 1, step: 1, default: 0 },
];
