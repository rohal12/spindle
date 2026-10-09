import { useContext } from 'preact/hooks';
import {
  InlineContext,
  LocalsValuesContext,
  NobrContext,
  RawTextContext,
  StructuralContext,
} from '../markup/render';

/**
 * The renderNodes() options of the enclosing content: nobr, inline and raw
 * rendering and the locals in scope. A macro or widget body rendered with
 * them renders as the content around it does.
 */
export function useRenderOptions(): {
  nobr: boolean;
  inline: boolean;
  raw: boolean;
  structural: boolean;
  locals: Record<string, unknown>;
} {
  return {
    nobr: useContext(NobrContext),
    inline: useContext(InlineContext),
    raw: useContext(RawTextContext),
    structural: useContext(StructuralContext),
    locals: useContext(LocalsValuesContext),
  };
}
