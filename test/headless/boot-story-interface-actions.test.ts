// @vitest-environment happy-dom
import { describe, it } from 'vitest';
import { bootStory } from '../../src/headless';
import {
  INTERFACE_ACTIONS_HTML,
  expectInterfaceActionsKept,
} from './interface-actions';

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory with controls in StoryInterface (#233)', () => {
  it('keeps interface and passage controls registered across navigation', async () => {
    const Story = await bootStory({ html: INTERFACE_ACTIONS_HTML });
    await expectInterfaceActionsKept(Story);
  });
});
