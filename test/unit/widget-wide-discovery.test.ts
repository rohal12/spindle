import { expect, it } from 'vitest';
import {
  effectiveWidgetDefinitions,
  widgetDefinitions,
} from '../../src/widgets/widget-def';

it.each([true, false])(
  'discovers wide widget lists in source order (closed: %s) (#720)',
  (closed) => {
    const opening = '{widget "a"}';
    const definition = opening + (closed ? '{/widget}' : '') + '\n';
    const content = definition.repeat(130_000) + '{widget "a" @last}{/widget}';
    const definitions = widgetDefinitions([
      { name: 'Widgets', tags: ['widget'], content },
    ]);
    expect(definitions).toHaveLength(130_001);
    expect(definitions[0]).toMatchObject({
      name: 'a',
      start: 0,
      end: opening.length,
      ...(closed ? { closeStart: opening.length } : {}),
    });
    expect(definitions[129_999]!.start).toBe(definition.length * 129_999);
    if (!closed) expect(definitions[0]!.closeStart).toBeUndefined();
    expect(effectiveWidgetDefinitions(definitions)).toMatchObject([
      { name: 'a', start: definition.length * 130_000, params: ['@last'] },
    ]);
  },
  30_000,
);
