import { useStoryStore } from './store';
import { showRuntimeError } from './runtime-errors';

/**
 * QuickSave and QuickLoad as the built-in buttons and hotkeys perform them:
 * a failure is shown on the page (the Story API's save() and load() only
 * reject, for the code that awaits them).
 */
export async function quickSave(): Promise<void> {
  try {
    await useStoryStore.getState().save();
  } catch (error) {
    showRuntimeError('The game could not be saved:', error);
  }
}

export async function quickLoad(): Promise<void> {
  try {
    await useStoryStore.getState().load();
  } catch (error) {
    showRuntimeError('The saved game could not be loaded:', error);
  }
}
