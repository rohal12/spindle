import { useContext } from 'preact/hooks';
import { renderInlineNodes, LocalsUpdateContext } from '../../markup/render';
import { collectText } from '../../utils/extract-text';
import { useAction } from '../../hooks/use-action';
import { useInterpolate } from '../../hooks/use-interpolate';
import { executeMutation } from '../../execute-mutation';
import { currentSourceLocation } from '../../utils/source-location';
import { registerMacro } from '../../registry';
import type { MacroProps } from '../../registry';

export function Button({ rawArgs, children = [], className, id }: MacroProps) {
  const resolve = useInterpolate();
  className = resolve(className);
  id = resolve(id);
  const { update, getValues } = useContext(LocalsUpdateContext);

  const handleClick = () => {
    try {
      executeMutation(rawArgs, getValues(), update);
    } catch (err) {
      console.error(
        `spindle: Error in {button ${rawArgs}}${currentSourceLocation()}:`,
        err,
      );
    }
  };

  useAction({
    type: 'button',
    key: rawArgs,
    authorId: id,
    label: collectText(children) || rawArgs,
    perform: handleClick,
  });

  const cls = className ? `macro-button ${className}` : 'macro-button';

  return (
    <button
      id={id}
      class={cls}
      onClick={handleClick}
    >
      {renderInlineNodes(children)}
    </button>
  );
}

registerMacro('button', Button);
