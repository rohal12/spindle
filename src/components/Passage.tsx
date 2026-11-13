import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { parseMarkup } from '../markup/parse';
import type { ASTNode } from '../markup/ast';
import {
  renderNodes,
  NobrContext,
  ViewScopeContext,
  InterfaceContext,
  useViewScope,
} from '../markup/render';
import { useStoryFields } from '../hooks/use-story-fields';
import type { Passage as PassageData } from '../parser';
import { sourceLocationOf } from '../utils/source-location';
import { emitFromRender } from '../event-emitter';
import { duringEntryRender } from '../triggers';
import type { ComponentChildren } from 'preact';
import { memo } from 'preact/compat';
import {
  EntryRenderContext,
  markPassageRendered,
} from '../passage-render-state';
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
  const ast = parseMarkup(passage.content);
  astCache.set(passage, { content: passage.content, ast });
  return ast;
}

export function renderPassageContent(passage: PassageData) {
  const ast = parsePassage(passage);
  const nobr = passage.tags.includes('nobr');
  return renderNodes(ast, nobr ? { nobr: true } : undefined);
}

/**
 * A passage's rendered content, drawn again only when the passage or its
 * text changes (the props are compared shallowly, so a parent re-rendering
 * with the same passage skips it).
 *
 * It is a component and not a vnode kept by `useMemo`. A kept vnode that is
 * placed again carries Preact's links (its parent, its rendered children) to
 * the tree it was first placed in. A navigation's tree reaches the kept vnode
 * of the passage on its way out, so every tree held the one before it and
 * none was ever freed. The `content` prop is only here so that an edit of
 * the passage text in place draws it again.
 */
const PassageBody = memo(function PassageBody({
  passage,
}: {
  passage: PassageData;
  content: string;
}) {
  try {
    return <>{renderPassageContent(passage)}</>;
  } catch (err) {
    return (
      <div class="error">
        Error parsing passage &ldquo;{passage.name}&rdquo;
        {sourceLocationOf(passage)}: {errorMessage(err)}
      </div>
    );
  }
});

/**
 * A special passage shown with every passage (PassageHeader, PassageFooter,
 * PassageDone), in its wrapper; nothing if it has no content. One that fails
 * to render is logged and left out, so it can't take the passage down with
 * it. Memoized like PassageBody.
 */
const SpecialPassage = memo(function SpecialPassage({
  passage,
  kind,
}: {
  passage: PassageData;
  content: string;
  kind: 'header' | 'footer' | 'done';
}) {
  let content: ComponentChildren;
  try {
    content = renderPassageContent(passage);
  } catch (err) {
    console.error(`spindle: Error in ${passage.name}:`, err);
    return null;
  }
  if (!content) return null;
  if (kind === 'done') {
    return (
      <EntryRenderBoundary>
        <div hidden>{content}</div>
      </EntryRenderBoundary>
    );
  }
  return <div class={`passage-${kind}`}>{content}</div>;
});

export interface PassageProps {
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

/** PassageDone mounts after the main passage committed, but replays on load. */
function EntryRenderBoundary({ children }: { children: ComponentChildren }) {
  const phase = useRef({ pending: true });
  useLayoutEffect(() => {
    phase.current.pending = false;
  }, []);
  return (
    <EntryRenderContext.Provider value={phase.current}>
      {children}
    </EntryRenderContext.Provider>
  );
}

export function Passage({
  passage,
  dataTransition,
  navigationId,
}: PassageProps) {
  const { storyData } = useStoryFields('storyData');
  const isCodePassage = CODE_PASSAGES.has(passage.name);
  const [doneReady, setDoneReady] = useState(false);

  // Code passages are shown without the special passages
  const special = (name: string) =>
    isCodePassage ? undefined : storyData?.passages.get(name);
  const specialPassage = (name: string, kind: 'header' | 'footer' | 'done') => {
    const found = special(name);
    return found ? (
      <SpecialPassage
        passage={found}
        content={found.content}
        kind={kind}
      />
    ) : null;
  };
  const donePassage = special('PassageDone');

  // Defer PassageDone to after DOM commit
  useEffect(() => {
    if (donePassage) setDoneReady(true);
    return () => setDoneReady(false);
  }, [passage.name]);

  // Signal that this passage's DOM is committed (after descendants' layout
  // effects, before paint). Runs once per mount: PassageDisplay keys the
  // Passage so every navigation that shows a passage mounts a new one.
  const elRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (navigationId !== undefined) markPassageRendered(navigationId);
    if (elRef.current) {
      const element = elRef.current;
      const emit = () => emitFromRender('passagerender', passage.name, element);
      if (navigationId !== undefined) duringEntryRender(emit);
      else emit();
    }
  }, [passage.name, navigationId]);

  const nobr = passage.tags.includes('nobr');
  const viewScope = useViewScope();

  const inner = (
    <InterfaceContext.Provider value={false}>
      <ViewScopeContext.Provider value={viewScope}>
        <div
          ref={elRef}
          class="passage"
          data-passage={passage.name}
          data-tags={passage.tags.join(' ')}
          data-transition={dataTransition}
        >
          {specialPassage('PassageHeader', 'header')}
          <PassageBody
            passage={passage}
            content={passage.content}
          />
          {specialPassage('PassageFooter', 'footer')}
          {doneReady && specialPassage('PassageDone', 'done')}
        </div>
      </ViewScopeContext.Provider>
    </InterfaceContext.Provider>
  );

  return nobr ? (
    <NobrContext.Provider value={true}>{inner}</NobrContext.Provider>
  ) : (
    inner
  );
}
