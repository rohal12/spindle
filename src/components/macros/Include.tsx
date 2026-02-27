import { useStoryStore } from '../../store';
import { evaluate } from '../../expression';
import { tokenize } from '../../markup/tokenizer';
import { buildAST } from '../../markup/ast';
import { renderNodes } from '../../markup/render';

interface IncludeProps {
  rawArgs: string;
  className?: string;
  id?: string;
}

export function Include({ rawArgs, className, id }: IncludeProps) {
  const storyData = useStoryStore((s) => s.storyData);
  const variables = useStoryStore((s) => s.variables);
  const temporary = useStoryStore((s) => s.temporary);

  if (!storyData) return null;

  let passageName: string;
  try {
    const result = evaluate(rawArgs, variables, temporary);
    passageName = String(result);
  } catch {
    passageName = rawArgs.replace(/^["']|["']$/g, '');
  }

  const passage = storyData.passages.get(passageName);
  if (!passage) {
    return (
      <span class="error">{`{include: passage "${passageName}" not found}`}</span>
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
