/**
 * Compile-time check: the hand-written types/index.d.ts must stay in sync
 * with the source StoryAPI interface.  If this file fails to compile,
 * the published types have drifted from the implementation.
 *
 * Run: npx tsc --noEmit
 */
import type { StoryAPI as SourceAPI } from './story-api';
import type { StoryAPI as PublishedAPI } from '../types/index';

// Both directions — if either fails, the types have drifted.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _sourceToPublished: PublishedAPI = {} as SourceAPI;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _publishedToSource: SourceAPI = {} as PublishedAPI;

// Tooling entry point (`@rohal12/spindle/tooling`): types/tooling.d.ts must
// match the parser that dist/pkg/tooling.js re-exports.
import type { parseStoryVariables as SourceParse } from './story-variables';
import type { parseStoryVariables as PublishedParse } from '../types/tooling';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _parseSourceToPublished: typeof PublishedParse = {} as typeof SourceParse;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _parsePublishedToSource: typeof SourceParse = {} as typeof PublishedParse;

// Custom macro API: the published MacroContext/MacroDefinition must match the
// ones defineMacro() actually passes and accepts.
import type {
  MacroContext as SourceMacroContext,
  MacroDefinition as SourceMacroDefinition,
} from './define-macro';
import type { MacroProps as SourceMacroProps } from './registry';
import type { ASTNode as SourceASTNode } from './markup/ast';
import type {
  MacroContext as PublishedMacroContext,
  MacroDefinition as PublishedMacroDefinition,
  MacroProps as PublishedMacroProps,
  ASTNode as PublishedASTNode,
} from '../types/index';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _ctxSourceToPublished: PublishedMacroContext = {} as SourceMacroContext;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _ctxPublishedToSource: SourceMacroContext = {} as PublishedMacroContext;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _defSourceToPublished: PublishedMacroDefinition =
  {} as SourceMacroDefinition;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _defPublishedToSource: SourceMacroDefinition =
  {} as PublishedMacroDefinition;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _propsSourceToPublished: PublishedMacroProps = {} as SourceMacroProps;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _propsPublishedToSource: SourceMacroProps = {} as PublishedMacroProps;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _astSourceToPublished: PublishedASTNode = {} as SourceASTNode;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _astPublishedToSource: SourceASTNode = {} as PublishedASTNode;

// A typical custom macro written against the published types must type-check,
// and misuse of the hooks must not (no `any` leaking through).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _exampleMacro: PublishedMacroDefinition = {
  name: 'counter',
  block: true,
  render(props, ctx) {
    const [count, setCount] = ctx.hooks.useState(0);
    const countIsNumber: number = count;
    setCount((n) => n + 1);
    // @ts-expect-error -- state setter is typed by the initial value
    setCount('one');
    const ref = ctx.hooks.useRef<HTMLSpanElement>(null);
    ctx.hooks.useEffect(() => {
      ref.current?.focus();
      return () => undefined;
    }, [count]);
    // @ts-expect-error -- deps must be an array
    ctx.hooks.useEffect(() => undefined, 'count');
    const doubled: number = ctx.hooks.useMemo(() => count * 2, [count]);
    const body = ctx.renderNodes(props.children ?? [], { nobr: true });
    const label: string = ctx.collectText(props.children ?? []);
    return ctx.wrap(
      ctx.h(
        'span',
        { ref, class: ctx.cls, title: label },
        body,
        countIsNumber,
        doubled,
      ),
    );
  },
};
