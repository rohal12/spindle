import { useMemo, useEffect, useState } from 'preact/hooks';
import { tokenize } from '../markup/tokenizer';
import { buildAST } from '../markup/ast';
import { renderNodes } from '../markup/render';
import { useStoryStore } from '../store';
import type { Passage as PassageData } from '../parser';
import { sourceLocationOf } from '../utils/source-location';

export function renderPassageContent(passage: PassageData) {
  const tokens = tokenize(passage.content);
  const ast = buildAST(tokens);
  return renderNodes(ast);
}

interface PassageProps {
  passage: PassageData;
}

const CODE_PASSAGES = new Set([
  'PassageReady',
  'PassageHeader',
  'PassageFooter',
  'PassageDone',
]);

export function Passage({ passage }: PassageProps) {
  const storyData = useStoryStore((s) => s.storyData);
  const isCodePassage = CODE_PASSAGES.has(passage.name);
  const [doneReady, setDoneReady] = useState(false);

  const content = useMemo(() => {
    try {
      return renderPassageContent(passage);
    } catch (err) {
      return (
        <div class="error">
          Error parsing passage &ldquo;{passage.name}&rdquo;
          {sourceLocationOf(passage)}: {(err as Error).message}
        </div>
      );
    }
  }, [passage.content, passage.name]);

  const headerPassage = isCodePassage
    ? undefined
    : storyData?.passages.get('PassageHeader');
  const footerPassage = isCodePassage
    ? undefined
    : storyData?.passages.get('PassageFooter');
  const donePassage = isCodePassage
    ? undefined
    : storyData?.passages.get('PassageDone');

  const headerContent = useMemo(() => {
    if (!headerPassage) return null;
    try {
      return renderPassageContent(headerPassage);
    } catch (err) {
      console.error('spindle: Error in PassageHeader:', err);
      return null;
    }
  }, [headerPassage?.content]);

  const footerContent = useMemo(() => {
    if (!footerPassage) return null;
    try {
      return renderPassageContent(footerPassage);
    } catch (err) {
      console.error('spindle: Error in PassageFooter:', err);
      return null;
    }
  }, [footerPassage?.content]);

  // Defer PassageDone to after DOM commit
  useEffect(() => {
    if (donePassage) setDoneReady(true);
    return () => setDoneReady(false);
  }, [passage.name]);

  const doneContent = useMemo(() => {
    if (!doneReady || !donePassage) return null;
    try {
      return renderPassageContent(donePassage);
    } catch (err) {
      console.error('spindle: Error in PassageDone:', err);
      return null;
    }
  }, [doneReady, donePassage?.content]);

  return (
    <div
      class="passage"
      data-passage={passage.name}
      data-tags={passage.tags.join(' ')}
    >
      {headerContent && <div class="passage-header">{headerContent}</div>}
      {content}
      {footerContent && <div class="passage-footer">{footerContent}</div>}
      {doneContent && <div hidden>{doneContent}</div>}
    </div>
  );
}
