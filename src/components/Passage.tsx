import { useMemo } from 'preact/hooks';
import { tokenize } from '../markup/tokenizer';
import { buildAST } from '../markup/ast';
import { renderNodes } from '../markup/render';
import type { Passage as PassageData } from '../parser';

interface PassageProps {
  passage: PassageData;
}

export function Passage({ passage }: PassageProps) {
  const content = useMemo(() => {
    try {
      const tokens = tokenize(passage.content);
      const ast = buildAST(tokens);
      return renderNodes(ast);
    } catch (err) {
      return (
        <div class="error">
          Error parsing passage &ldquo;{passage.name}&rdquo;:{' '}
          {(err as Error).message}
        </div>
      );
    }
  }, [passage.content, passage.name]);

  return (
    <div
      class="passage"
      data-passage={passage.name}
      data-tags={passage.tags.join(' ')}
    >
      {content}
    </div>
  );
}
