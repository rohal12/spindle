import { useContext } from 'preact/hooks';
import { renderInlineNodes, LocalsContext } from '../../markup/render';
import { collectText } from '../../utils/extract-text';
import { useAction } from '../../hooks/use-action';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import { useInterpolate } from '../../hooks/use-interpolate';
import { executeMutation } from '../../execute-mutation';
import { currentSourceLocation } from '../../utils/source-location';
import type { ASTNode } from '../../markup/ast';

interface ButtonProps {
  rawArgs: string;
  children: ASTNode[];
  className?: string;
  id?: string;
}

export function Button({ rawArgs, children, className, id }: ButtonProps) {
  const resolve = useInterpolate();
  className = resolve(className);
  id = resolve(id);
  const scope = useContext(LocalsContext);
  const [, , mergedLocals] = useMergedLocals();

  const handleClick = () => {
    try {
      executeMutation(rawArgs, mergedLocals, scope.update);
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
