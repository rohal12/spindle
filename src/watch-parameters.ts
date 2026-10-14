import type { ParameterDef } from './registry';

/** Shared syntax for trusted story declarations and rendered watchers. */
export const WATCH_PARAMETERS = [
  {
    name: 'condition',
    type: 'string',
    holds: 'expression',
    required: true,
  },
  {
    name: 'options',
    type: 'options',
    parameters: [
      { name: 'goto', type: 'string', holds: 'passage' },
      { name: 'dialog', type: 'string', holds: 'passage' },
      { name: 'run', type: 'string', holds: 'statements' },
      { name: 'name', type: 'string', holds: 'text' },
      { name: 'priority', type: 'number' },
      { name: 'once', type: 'flag' },
    ],
  },
] as const satisfies readonly ParameterDef[];
