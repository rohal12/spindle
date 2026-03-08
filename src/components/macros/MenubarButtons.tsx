import { useState } from 'preact/hooks';
import { useStoryStore } from '../../store';
import { settings } from '../../settings';
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
  hidden?: () => boolean;
  setup?: () => { perform: () => void; disabled?: boolean };
  dialog?: {
    passageName: string;
    fallbackMarkup?: string;
    panelClass?: string;
  };
}

export function defineMenubarAction(config: MenubarActionConfig) {
  defineMacro({
    name: config.name,
    render(_, ctx) {
      if (config.hidden?.()) return null;

      const [dialogOpen, setDialogOpen] = config.dialog
        ? useState(false)
        : [false, undefined as never];

      const setup = config.setup?.() ?? { perform: () => {} };
      const { disabled } = setup;

      const cls = ctx.className
        ? `menubar-button ${ctx.className}`
        : 'menubar-button';

      const perform = config.dialog
        ? () => setDialogOpen(true)
        : config.confirm
          ? () => {
              if (confirm(config.confirm!)) setup.perform();
            }
          : setup.perform;

      ctx.useAction({
        type: config.actionType,
        key: config.name,
        authorId: ctx.id,
        label: typeof config.label === 'string' ? config.label : config.name,
        disabled,
        perform: config.dialog ? () => setDialogOpen(true) : setup.perform,
      });

      return (
        <>
          <button
            id={ctx.id}
            class={cls}
            onClick={perform}
            disabled={disabled}
            title={config.title}
          >
            {config.label}
          </button>
          {config.dialog && dialogOpen && (
            <PassageDialog
              passageName={config.dialog.passageName}
              fallbackMarkup={config.dialog.fallbackMarkup}
              panelClass={config.dialog.panelClass}
              onClose={() => setDialogOpen(false)}
            />
          )}
        </>
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
  title: 'Quick Save (F6)',
  setup: () => ({
    perform: useStoryStore((s) => s.save),
  }),
});

defineMenubarAction({
  name: 'quickload',
  label: 'QuickLoad',
  actionType: 'load',
  title: 'Quick Load (F9)',
  confirm: 'Load saved game? Current progress will be lost.',
  setup: () => {
    const load = useStoryStore((s) => s.load);
    const hasSave = useStoryStore((s) => s.hasSave);
    useStoryStore((s) => s.saveVersion);
    return { perform: () => load(), disabled: !hasSave() };
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
  hidden: () => !settings.hasAny(),
  dialog: {
    passageName: 'Settings',
    fallbackMarkup: '{settings-controls}',
    panelClass: 'dialog-settings',
  },
});
