import { defineInputMacro } from './input-macro';

// An empty input is 0
defineInputMacro('numberbox', 'number', (v) =>
  v !== undefined ? Number(v) : 0,
);
