import { useStoryStore } from '../../store';
import { evaluate } from '../../expression';
import { tokenize } from '../../markup/tokenizer';
import { buildAST } from '../../markup/ast';
import { renderNodes } from '../../markup/render';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import { useInterpolate } from '../../hooks/use-interpolate';
import { currentSourceLocation } from '../../utils/source-location';
import { registerMacro } from '../../registry';
import type { MacroProps } from '../../registry';

export function Include({ rawArgs, className, id }: MacroProps) {
  const resolve = useInterpolate();
  className = resolve(className);
  id = resolve(id);
  const storyData = useStoryStore((s) => s.storyData);
  const [variables, temporary, locals] = useMergedLocals();

  if (!storyData) return null;

  let passageName: string;
  try {
    const result = evaluate(rawArgs, variables, temporary, locals);
    passageName = String(result);
  } catch {
    passageName = rawArgs.replace(/^["']|["']$/g, '');
  }

  const passage = storyData.passages.get(passageName);
  if (passage) {
    useStoryStore.getState().trackRender(passageName);
  }
  if (!passage) {
    return (
      <span class="error">{`{include${currentSourceLocation()}: passage "${passageName}" not found}`}</span>
    );
  }

  const tokens = tokenize(passage.content);
  const ast = buildAST(tokens);
  const content = renderNodes(ast);

  if (className || id)
    return (
      <span
        id={id}
        class={className}
      >
        {content}
      </span>
    );
  return <>{content}</>;
}

registerMacro('include', Include);
