import {
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'preact/hooks';
import { tokenize } from '../markup/tokenizer';
import { buildAST, type ASTNode } from '../markup/ast';
import { renderNodes, NobrContext } from '../markup/render';
import { useStoryStore } from '../store';
import type { Passage as PassageData } from '../parser';
import { sourceLocationOf } from '../utils/source-location';
import { emitFromRender } from '../event-emitter';
import { markPassageRendered } from '../passage-render-state';
import { errorMessage } from '../utils/error-message';

/**
 * Parsed AST per passage. The renderer keys children by AST node identity,
 * so re-rendering a passage (e.g. PassageReady on every PassageDisplay
 * render) must reuse its AST — a fresh parse would remount every macro in
 * it and re-run its {set}/{do} side effects (#175).
 */
const astCache = new WeakMap<
  PassageData,
  { content: string; ast: ASTNode[] }
>();

function parsePassage(passage: PassageData): ASTNode[] {
  const cached = astCache.get(passage);
  if (cached && cached.content === passage.content) return cached.ast;
  const ast = buildAST(tokenize(passage.content));
  astCache.set(passage, { content: passage.content, ast });
  return ast;
}

export function renderPassageContent(passage: PassageData) {
  const ast = parsePassage(passage);
  const nobr = passage.tags.includes('nobr');
  return renderNodes(ast, nobr ? { nobr: true } : undefined);
}

/**
 * The content of a special passage shown with every passage (PassageHeader,
 * PassageFooter, PassageDone), or null. One that fails to render is logged
 * and left out, so it can't take the passage down with it.
 */
function renderSpecialPassage(passage: PassageData | undefined) {
  if (!passage) return null;
  try {
    return renderPassageContent(passage);
  } catch (err) {
    console.error(`spindle: Error in ${passage.name}:`, err);
    return null;
  }
}

interface PassageProps {
  passage: PassageData;
  dataTransition?: string;
  /** The navigation this passage displays; omitted for placeholders. */
  navigationId?: number;
}

const CODE_PASSAGES = new Set([
  'PassageReady',
  'PassageHeader',
  'PassageFooter',
  'PassageDone',
]);

export function Passage({
  passage,
  dataTransition,
  navigationId,
}: PassageProps) {
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
          {sourceLocationOf(passage)}: {errorMessage(err)}
        </div>
      );
    }
  }, [passage.content, passage.name]);

  // Code passages are shown without the special passages
  const special = (name: string) =>
    isCodePassage ? undefined : storyData?.passages.get(name);
  const headerPassage = special('PassageHeader');
  const footerPassage = special('PassageFooter');
  const donePassage = special('PassageDone');

  const headerContent = useMemo(
    () => renderSpecialPassage(headerPassage),
    [headerPassage?.content],
  );
  const footerContent = useMemo(
    () => renderSpecialPassage(footerPassage),
    [footerPassage?.content],
  );

  // Defer PassageDone to after DOM commit
  useEffect(() => {
    if (donePassage) setDoneReady(true);
    return () => setDoneReady(false);
  }, [passage.name]);

  const doneContent = useMemo(
    () => (doneReady ? renderSpecialPassage(donePassage) : null),
    [doneReady, donePassage?.content],
  );

  // Signal that this passage's DOM is committed (after descendants' layout
  // effects, before paint). Runs once per mount: PassageDisplay keys the
  // Passage so every navigation that shows a passage mounts a new one.
  const elRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (navigationId !== undefined) markPassageRendered(navigationId);
    if (elRef.current) {
      emitFromRender('passagerender', passage.name, elRef.current);
    }
  }, [passage.name, navigationId]);

  const nobr = passage.tags.includes('nobr');

  const inner = (
    <div
      ref={elRef}
      class="passage"
      data-passage={passage.name}
      data-tags={passage.tags.join(' ')}
      data-transition={dataTransition}
    >
      {headerContent && <div class="passage-header">{headerContent}</div>}
      {content}
      {footerContent && <div class="passage-footer">{footerContent}</div>}
      {doneContent && <div hidden>{doneContent}</div>}
    </div>
  );

  return nobr ? (
    <NobrContext.Provider value={true}>{inner}</NobrContext.Provider>
  ) : (
    inner
  );
}
