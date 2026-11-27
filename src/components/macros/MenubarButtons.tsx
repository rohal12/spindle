import { actionAttributes, useControlAction } from '../../hooks/use-action';
import { useState } from 'preact/hooks';
import { useSyncExternalStore } from 'preact/compat';
import { useStoryStore } from '../../store';
import { useStoryFields } from '../../hooks/use-story-fields';
import { settings, subscribeSettings } from '../../settings';
import { quickLoad, quickSave } from '../../quick-actions';
import { defineMacro } from '../../define-macro';
import { PassageDialog } from '../PassageDialog';
import type { ActionType } from '../../action-registry';
import type { ComponentChildren } from 'preact';

interface MenubarActionConfig {
  name: string;
  label: ComponentChildren;
  actionType: ActionType;
  title?: string;
  confirm?: string;
  useHidden?: () => boolean;
  setup?: () => {
    perform: () => void | Promise<void>;
    disabled?: boolean;
    title?: string;
  };
  dialog?: {
    passageName: string;
    fallbackMarkup?: string;
    panelClass?: string;
    showCloseButton?: boolean;
  };
}

function hotkeyTitle(label: string, key: string | null): string {
  return key ? `${label} (${key})` : label;
}

export function defineMenubarAction(config: MenubarActionConfig) {
  // Visibility can change after mount. Keep the button's hooks and action
  // registration in a child whose lifetime follows that visibility.
  function Button({ className, id }: { className?: string; id?: string }) {
    const [dialogOpen, setDialogOpen] = useState(false);

    const setup = config.setup?.() ?? { perform: () => {} };
    const { disabled, title = config.title } = setup;

    const cls = className ? `menubar-button ${className}` : 'menubar-button';

    const perform = config.dialog
      ? () => setDialogOpen(true)
      : config.confirm
        ? () => {
            if (confirm(config.confirm!)) setup.perform();
          }
        : setup.perform;

    const action = useControlAction({
      type: config.actionType,
      key: config.name,
      authorId: id,
      label: typeof config.label === 'string' ? config.label : config.name,
      disabled,
      perform: config.dialog ? () => setDialogOpen(true) : setup.perform,
    });

    return (
      <>
        <button
          type="button"
          {...actionAttributes(action, { id, cls })}
          onClick={perform}
          disabled={disabled}
          title={title}
        >
          {config.label}
        </button>
        {config.dialog && dialogOpen && (
          <PassageDialog
            passageName={config.dialog.passageName}
            fallbackMarkup={config.dialog.fallbackMarkup}
            panelClass={config.dialog.panelClass}
            label={
              typeof config.label === 'string' ? config.label : config.name
            }
            onClose={() => setDialogOpen(false)}
            showCloseButton={config.dialog.showCloseButton}
          />
        )}
      </>
    );
  }

  defineMacro({
    name: config.name,
    interpolate: true,
    render(_, ctx) {
      return config.useHidden?.() ? null : (
        <Button
          className={ctx.className}
          id={ctx.id}
        />
      );
    },
  });
}

defineMenubarAction({
  name: 'back',
  label: '← Back',
  actionType: 'back',
  setup: () => ({
    perform: useStoryStore((s) => s.goBack),
    disabled: !useStoryStore((s) => s.historyIndex > 0),
  }),
});

defineMenubarAction({
  name: 'forward',
  label: 'Forward →',
  actionType: 'forward',
  setup: () => ({
    perform: useStoryStore((s) => s.goForward),
    disabled: !useStoryStore((s) => s.historyIndex < s.history.length - 1),
  }),
});

defineMenubarAction({
  name: 'quicksave',
  label: 'QuickSave',
  actionType: 'save',
  setup: () => {
    const { quickSaveKey } = useStoryFields('quickSaveKey');
    return {
      perform: quickSave,
      title: hotkeyTitle('Quick Save', quickSaveKey),
    };
  },
});

defineMenubarAction({
  name: 'quickload',
  label: 'QuickLoad',
  actionType: 'load',
  confirm: 'Load saved game? Current progress will be lost.',
  setup: () => {
    // knownSaves: re-render when the saves change, as hasSave() reads them
    const { hasSave, quickLoadKey } = useStoryFields(
      'hasSave',
      'quickLoadKey',
      'knownSaves',
    );
    return {
      perform: quickLoad,
      disabled: !hasSave(),
      title: hotkeyTitle('Quick Load', quickLoadKey),
    };
  },
});

defineMenubarAction({
  name: 'restart',
  label: '↺ Restart',
  actionType: 'restart',
  confirm: 'Restart the story? All progress will be lost.',
  setup: () => ({
    perform: useStoryStore((s) => s.restart),
  }),
});

defineMenubarAction({
  name: 'saves',
  label: 'Saves',
  actionType: 'dialog',
  dialog: {
    passageName: 'SaveLoad',
    fallbackMarkup: '{save-manager}',
    panelClass: 'dialog-saves',
  },
});

defineMenubarAction({
  name: 'settings',
  label: 'Settings',
  actionType: 'dialog',
  useHidden: () => !useSyncExternalStore(subscribeSettings, settings.hasAny),
  dialog: {
    passageName: 'Settings',
    fallbackMarkup: '{settings-controls}',
    panelClass: 'dialog-settings',
  },
});
