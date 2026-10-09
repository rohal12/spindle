import { useContext, useMemo } from 'preact/hooks';
import { LocalsValuesContext } from '../../markup/render';
import { defineMacro } from '../../define-macro';
import { MacroError } from './MacroError';
import { stableKey } from '../../utils/stable-key';
import {
  ItemEditContext,
  controlEditVersion,
  editedItems,
} from '../../utils/control-edits';
import type { ASTNode } from '../../markup/ast';
import { checkVariableName } from '../../utils/namespace';
import { readState } from '../../execute-mutation';
import { LocalsScope } from './locals-scope';

/**
 * Check the arguments of "@item, @i of $list" or "@item of $list".
 */
function loopArgs(
  rawArgs: string,
  args: { variables?: string[]; of: boolean; list?: string },
): {
  itemVar: string;
  indexVar: string | null;
  listExpr: string;
} {
  if (!args.of) {
    throw new Error(`{for} requires "of" keyword: {for ${rawArgs}}`);
  }

  const [itemVar = '', indexVar = null] = args.variables ?? [];
  const listExpr = args.list ?? '';

  if (!itemVar.startsWith('@')) {
    throw new Error(`{for} loop variable must use @ prefix: got "${itemVar}"`);
  }
  if (indexVar && !indexVar.startsWith('@')) {
    throw new Error(
      `{for} index variable must use @ prefix: got "${indexVar}"`,
    );
  }

  checkVariableName(itemVar.slice(1), itemVar);
  if (indexVar) checkVariableName(indexVar.slice(1), indexVar);

  return {
    itemVar: itemVar.slice(1),
    indexVar: indexVar ? indexVar.slice(1) : null,
    listExpr,
  };
}

function ForIteration({
  parentValues,
  itemVar,
  itemValue,
  indexVar,
  indexValue,
  children,
}: {
  parentValues: Record<string, unknown>;
  itemVar: string;
  itemValue: unknown;
  indexVar: string | null;
  indexValue: number;
  children: ASTNode[];
}) {
  const ownKeys = useMemo(
    () => ({
      [itemVar]: itemValue,
      ...(indexVar ? { [indexVar]: indexValue } : undefined),
    }),
    [itemVar, itemValue, indexVar, indexValue],
  );

  return (
    <LocalsScope
      body={children}
      parentValues={parentValues}
      ownKeys={ownKeys}
    />
  );
}

/** What {for} remembers of its iterations between renders. */
interface IterationKeys {
  contents: string[];
  generations: number[];
  next: number;
  edits: number;
}

defineMacro({
  name: 'for',
  block: true,
  interpolate: true,
  merged: true,
  parameters: [
    { name: 'variables', type: 'names', required: true },
    { name: 'of', type: 'separator' },
    { name: 'list', type: 'expression', required: true },
  ],
  render({ rawArgs, children = [] }, ctx) {
    const parentValues = useContext(LocalsValuesContext);
    const keys = ctx.hooks.useRef<IterationKeys>({
      contents: [],
      generations: [],
      next: 0,
      edits: controlEditVersion(),
    }).current;

    let loop: ReturnType<typeof loopArgs>;
    let list: unknown[];
    try {
      loop = loopArgs(rawArgs, ctx.args);
      const result = ctx.evaluate!(loop.listExpr);
      if (!Array.isArray(result)) {
        return (
          <span class="error">
            {`{for error: expression did not evaluate to an array}`}
          </span>
        );
      }
      list = result;
    } catch (err) {
      return (
        <MacroError
          macro="for"
          error={err}
        />
      );
    }

    const { itemVar, indexVar } = loop;
    // An iteration is remounted when its item's contents change, so mount-only
    // macros run again for the new item (#45) -- unless the change is an edit
    // of the item (see control-edits): a reader typing into a control, which
    // a remount would take the focus from, or code the iterations ran, which
    // a remount would run again (#400).
    const edited = editedItems(keys.edits, readState());
    keys.edits = controlEditVersion();
    const generations = list.map((item, i) => {
      const contents = stableKey(item);
      if (
        keys.generations[i] === undefined ||
        (contents !== keys.contents[i] && !edited(list, item, i))
      ) {
        keys.generations[i] = keys.next++;
      }
      keys.contents[i] = contents;
      return keys.generations[i]!;
    });
    keys.contents.length = keys.generations.length = list.length;
    const content = list.map((item, i) => (
      <ForIteration
        key={`${i}-${generations[i]}`}
        parentValues={parentValues}
        itemVar={itemVar}
        itemValue={item}
        indexVar={indexVar}
        indexValue={i}
        children={children}
      />
    ));

    return ctx.wrap(
      <ItemEditContext.Provider value={true}>
        {content}
      </ItemEditContext.Provider>,
    );
  },
  text({ rawArgs, children = [] }, ctx) {
    const { itemVar, indexVar, listExpr } = loopArgs(rawArgs, ctx.args);
    const list = ctx.evaluate(listExpr);
    if (!Array.isArray(list)) {
      throw new Error('expression did not evaluate to an array');
    }
    return list
      .map((item, i) =>
        ctx.renderText(children, {
          [itemVar]: item,
          ...(indexVar ? { [indexVar]: i } : undefined),
        }),
      )
      .join('');
  },
});
