/**
 * Compile-time check: the hand-written published types (types/*.d.ts) must
 * stay in sync with the source they describe. If this file fails to
 * compile, the published types have drifted from the implementation.
 *
 * Run: npx tsc --noEmit
 */
import type { StoryAPI as SourceAPI } from './story-api';
import type { parseStoryVariables as SourceParse } from './story-variables';
import type {
  MacroContext as SourceMacroContext,
  MacroDefinition as SourceMacroDefinition,
} from './define-macro';
import type { MacroProps as SourceMacroProps } from './registry';
import type { ASTNode as SourceASTNode } from './markup/ast';
import type { bootStory as SourceBootStory } from './headless';
import type {
  StoryAPI as PublishedAPI,
  MacroContext as PublishedMacroContext,
  MacroDefinition as PublishedMacroDefinition,
  MacroProps as PublishedMacroProps,
  ASTNode as PublishedASTNode,
} from '../types/index';
import type {
  parseStoryVariables as PublishedParse,
  formatDiagnostic as PublishedFormatDiagnostic,
  MarkupDiagnostic as PublishedMarkupDiagnostic,
  MarkupPassage as PublishedMarkupPassage,
  validateMarkup as PublishedValidateMarkup,
} from '../types/tooling';
import type {
  formatDiagnostic as SourceFormatDiagnostic,
  MarkupDiagnostic as SourceMarkupDiagnostic,
  MarkupPassage as SourceMarkupPassage,
  validateStoryMarkup as SourceValidateStoryMarkup,
} from './tooling';
import type { bootStory as PublishedBootStory } from '../types/headless';
import type * as SourceTooling from './tooling';
import type * as PublishedTooling from '../types/tooling';

/** What the source declares, by published name. */
interface Source {
  StoryAPI: SourceAPI;
  // Tooling entry point (`@rohal12/spindle/tooling`): the parser that
  // dist/pkg/tooling.js re-exports.
  parseStoryVariables: typeof SourceParse;
  // Its markup validator (pkg/tooling.js binds validateStoryMarkup to the
  // macro metadata, so validateMarkup itself takes only the passages).
  MarkupPassage: SourceMarkupPassage;
  MarkupDiagnostic: SourceMarkupDiagnostic;
  formatDiagnostic: typeof SourceFormatDiagnostic;
  // Custom macro API: the MacroContext/MacroDefinition defineMacro()
  // actually passes and accepts.
  MacroContext: SourceMacroContext;
  MacroDefinition: SourceMacroDefinition;
  MacroProps: SourceMacroProps;
  ASTNode: SourceASTNode;
  // Headless entry point (`@rohal12/spindle/headless`).
  bootStory: typeof SourceBootStory;
}

/** What types/index.d.ts, tooling.d.ts and headless.d.ts publish. */
interface Published {
  StoryAPI: PublishedAPI;
  parseStoryVariables: typeof PublishedParse;
  MarkupPassage: PublishedMarkupPassage;
  MarkupDiagnostic: PublishedMarkupDiagnostic;
  formatDiagnostic: typeof PublishedFormatDiagnostic;
  MacroContext: PublishedMacroContext;
  MacroDefinition: PublishedMacroDefinition;
  MacroProps: PublishedMacroProps;
  ASTNode: PublishedASTNode;
  bootStory: typeof PublishedBootStory;
}

// Both directions — if either fails, the types have drifted.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _sourceToPublished: Published = {} as Source;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _publishedToSource: Source = {} as Published;

/** `true` if `A` and `B` are assignable to each other, else `false`. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// The rest of the tooling entry point: what it parses and returns (tokens,
// pieces, pairing, declarations) and the stateless checks. Each must be the
// same type in the source and in types/tooling.d.ts, or `false` here is no
// `true`.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _toolingTypes: [
  Same<SourceTooling.MarkupError, PublishedTooling.MarkupError>,
  Same<SourceTooling.Token, PublishedTooling.Token>,
  Same<SourceTooling.Piece, PublishedTooling.Piece>,
  Same<SourceTooling.PairedNode, PublishedTooling.PairedNode>,
  Same<SourceTooling.PairingError, PublishedTooling.PairingError>,
  Same<SourceTooling.Declaration, PublishedTooling.Declaration>,
  Same<SourceTooling.DeclarationError, PublishedTooling.DeclarationError>,
  Same<SourceTooling.ToolingMacro, PublishedTooling.ToolingMacro>,
  Same<typeof SourceTooling.pairMarkup, typeof PublishedTooling.pairMarkup>,
  Same<
    typeof SourceTooling.passagePieces,
    typeof PublishedTooling.passagePieces
  >,
  Same<
    typeof SourceTooling.parseDeclarations,
    typeof PublishedTooling.parseDeclarations
  >,
  Same<
    typeof SourceTooling.validateStoryMarkup,
    typeof PublishedTooling.validateStoryMarkup
  >,
  Same<
    typeof SourceTooling.collectStoryPassageReferences,
    typeof PublishedTooling.collectStoryPassageReferences
  >,
] = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];

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

// pkg/tooling.js's validateMarkup is validateStoryMarkup bound to the macro
// metadata.
declare const validateStoryMarkup: typeof SourceValidateStoryMarkup;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _validateMarkup: typeof PublishedValidateMarkup = (passages, options) =>
  validateStoryMarkup(passages, [], options);
