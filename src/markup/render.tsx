import { createContext } from 'preact';
import { PassageLink } from '../components/PassageLink';
import { VarDisplay } from '../components/macros/VarDisplay';
import { Set } from '../components/macros/Set';
import { Print } from '../components/macros/Print';
import { If } from '../components/macros/If';
import { For } from '../components/macros/For';
import { Do } from '../components/macros/Do';
import { Button } from '../components/macros/Button';
import { StoryTitle } from '../components/macros/StoryTitle';
import { Restart } from '../components/macros/Restart';
import { Back } from '../components/macros/Back';
import { Forward } from '../components/macros/Forward';
import { QuickSave } from '../components/macros/QuickSave';
import { QuickLoad } from '../components/macros/QuickLoad';
import { SettingsButton } from '../components/macros/SettingsButton';
import { Saves } from '../components/macros/Saves';
import { Include } from '../components/macros/Include';
import { Goto } from '../components/macros/Goto';
import { Unset } from '../components/macros/Unset';
import { Textbox } from '../components/macros/Textbox';
import { Numberbox } from '../components/macros/Numberbox';
import { Textarea } from '../components/macros/Textarea';
import { Checkbox } from '../components/macros/Checkbox';
import { Radiobutton } from '../components/macros/Radiobutton';
import { Listbox } from '../components/macros/Listbox';
import { Cycle } from '../components/macros/Cycle';
import { MacroLink } from '../components/macros/MacroLink';
import { Switch } from '../components/macros/Switch';
import { Timed } from '../components/macros/Timed';
import { Repeat } from '../components/macros/Repeat';
import { Stop } from '../components/macros/Stop';
import { Type } from '../components/macros/Type';
import { Widget } from '../components/macros/Widget';
import { WidgetInvocation } from '../components/macros/WidgetInvocation';
import { Computed } from '../components/macros/Computed';
import { Meter } from '../components/macros/Meter';
import { PassageDisplay } from '../components/macros/PassageDisplay';
import { getWidget } from '../widgets/widget-registry';
import { getMacro } from '../registry';
import { markdownToHtml } from './markdown';
import { h } from 'preact';
import type { ASTNode, Branch, HtmlNode, MacroNode, VariableNode } from './ast';
import { useStoryStore } from '../store';
import { useInterpolate } from '../hooks/use-interpolate';

export interface LocalsScope {
  values: Record<string, unknown>;
  update: (key: string, value: unknown) => void;
}

const defaultLocalsScope: LocalsScope = {
  values: {},
  update: () => {},
};

export const LocalsContext = createContext<LocalsScope>(defaultLocalsScope);

const EMPTY_BRANCHES: Branch[] = [];

/**
 * Convert an HTML string (from micromark) to Preact VNodes,
 * replacing <span data-tw="N"> placeholder elements with pre-rendered components.
 */
function htmlToPreact(
  html: string,
  components: preact.ComponentChildren[],
): preact.ComponentChildren {
  const temp = document.createElement('div');
  temp.innerHTML = html.trim();
  const children = Array.from(temp.childNodes).map((child, i) =>
    convertDomNode(child, i, components),
  );
  return <>{children}</>;
}

function convertDomNode(
  node: Node,
  key: number,
  components: preact.ComponentChildren[],
): preact.ComponentChildren {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    // Check if it's a placeholder for a Twine component
    const twIdx = el.getAttribute('data-tw');
    if (twIdx != null) {
      return components[parseInt(twIdx, 10)];
    }

    // Convert attributes
    const props: Record<string, string | number> = { key };
    for (const attr of Array.from(el.attributes)) {
      props[attr.name] = attr.value;
    }

    // Convert children recursively
    const children = Array.from(el.childNodes).map((child, i) =>
      convertDomNode(child, i, components),
    );

    return h(tag, props, ...children);
  }
  return null;
}

function HtmlNodeRenderer({ node }: { node: HtmlNode }) {
  const resolve = useInterpolate();
  const attrs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node.attributes)) {
    attrs[k] = resolve(v) ?? v;
  }
  return h(
    node.tag,
    attrs,
    node.children.length > 0 ? renderNodes(node.children) : undefined,
  );
}

function renderMacro(node: MacroNode, key: number) {
  switch (node.name) {
    case 'set':
      return (
        <Set
          key={key}
          rawArgs={node.rawArgs}
        />
      );

    case 'computed':
      return (
        <Computed
          key={key}
          rawArgs={node.rawArgs}
        />
      );

    case 'print':
      return (
        <Print
          key={key}
          rawArgs={node.rawArgs}
          className={node.className}
          id={node.id}
        />
      );

    case 'meter':
      return (
        <Meter
          key={key}
          rawArgs={node.rawArgs}
          className={node.className}
          id={node.id}
        />
      );

    case 'passage':
      return (
        <PassageDisplay
          key={key}
          className={node.className}
          id={node.id}
        />
      );

    case 'if':
      return (
        <If
          key={key}
          branches={node.branches ?? EMPTY_BRANCHES}
        />
      );

    case 'for':
      return (
        <For
          key={key}
          rawArgs={node.rawArgs}
          children={node.children}
          className={node.className}
          id={node.id}
        />
      );

    case 'do':
      return (
        <Do
          key={key}
          children={node.children}
        />
      );

    case 'button':
      return (
        <Button
          key={key}
          rawArgs={node.rawArgs}
          children={node.children}
          className={node.className}
          id={node.id}
        />
      );

    case 'story-title':
      return (
        <StoryTitle
          key={key}
          className={node.className}
          id={node.id}
        />
      );

    case 'back':
      return (
        <Back
          key={key}
          className={node.className}
          id={node.id}
        />
      );

    case 'forward':
      return (
        <Forward
          key={key}
          className={node.className}
          id={node.id}
        />
      );

    case 'restart':
      return (
        <Restart
          key={key}
          className={node.className}
          id={node.id}
        />
      );

    case 'quicksave':
      return (
        <QuickSave
          key={key}
          className={node.className}
          id={node.id}
        />
      );

    case 'quickload':
      return (
        <QuickLoad
          key={key}
          className={node.className}
          id={node.id}
        />
      );

    case 'settings':
      return (
        <SettingsButton
          key={key}
          className={node.className}
          id={node.id}
        />
      );

    case 'saves':
      return (
        <Saves
          key={key}
          className={node.className}
          id={node.id}
        />
      );

    case 'include':
      return (
        <Include
          key={key}
          rawArgs={node.rawArgs}
          className={node.className}
          id={node.id}
        />
      );

    case 'goto':
      return (
        <Goto
          key={key}
          rawArgs={node.rawArgs}
        />
      );

    case 'unset':
      return (
        <Unset
          key={key}
          rawArgs={node.rawArgs}
        />
      );

    case 'textbox':
      return (
        <Textbox
          key={key}
          rawArgs={node.rawArgs}
          className={node.className}
          id={node.id}
        />
      );

    case 'numberbox':
      return (
        <Numberbox
          key={key}
          rawArgs={node.rawArgs}
          className={node.className}
          id={node.id}
        />
      );

    case 'textarea':
      return (
        <Textarea
          key={key}
          rawArgs={node.rawArgs}
          className={node.className}
          id={node.id}
        />
      );

    case 'checkbox':
      return (
        <Checkbox
          key={key}
          rawArgs={node.rawArgs}
          className={node.className}
          id={node.id}
        />
      );

    case 'radiobutton':
      return (
        <Radiobutton
          key={key}
          rawArgs={node.rawArgs}
          className={node.className}
          id={node.id}
        />
      );

    case 'listbox':
      return (
        <Listbox
          key={key}
          rawArgs={node.rawArgs}
          children={node.children}
          className={node.className}
          id={node.id}
        />
      );

    case 'cycle':
      return (
        <Cycle
          key={key}
          rawArgs={node.rawArgs}
          children={node.children}
          className={node.className}
          id={node.id}
        />
      );

    case 'link':
      return (
        <MacroLink
          key={key}
          rawArgs={node.rawArgs}
          children={node.children}
          className={node.className}
          id={node.id}
        />
      );

    case 'switch':
      return (
        <Switch
          key={key}
          rawArgs={node.rawArgs}
          branches={node.branches ?? EMPTY_BRANCHES}
        />
      );

    case 'timed': {
      const firstBranch = node.branches?.[0];
      return (
        <Timed
          key={key}
          rawArgs={node.rawArgs}
          children={node.children}
          branches={node.branches ?? EMPTY_BRANCHES}
          className={node.className ?? firstBranch?.className}
          id={node.id ?? firstBranch?.id}
        />
      );
    }

    case 'repeat':
      return (
        <Repeat
          key={key}
          rawArgs={node.rawArgs}
          children={node.children}
          className={node.className}
          id={node.id}
        />
      );

    case 'stop':
      return <Stop key={key} />;

    case 'type':
      return (
        <Type
          key={key}
          rawArgs={node.rawArgs}
          children={node.children}
          className={node.className}
          id={node.id}
        />
      );

    case 'widget':
      return (
        <Widget
          key={key}
          rawArgs={node.rawArgs}
          children={node.children}
        />
      );

    // {option}, {case}, {default}, {next} are handled by parent components
    case 'option':
    case 'case':
    case 'default':
    case 'next':
      return null;

    default: {
      // Check widget registry for user-defined widgets
      const widget = getWidget(node.name);
      if (widget) {
        return (
          <WidgetInvocation
            key={key}
            body={widget.body}
            params={widget.params}
            rawArgs={node.rawArgs}
          />
        );
      }

      // Check component registry for custom macros
      const Component = getMacro(node.name);
      if (Component) {
        return (
          <Component
            key={key}
            rawArgs={node.rawArgs}
            className={node.className}
            id={node.id}
          >
            {renderNodes(node.children)}
          </Component>
        );
      }

      return (
        <span
          key={key}
          class="error"
        >
          {`{unknown macro: ${node.name}}`}
        </span>
      );
    }
  }
}

/**
 * Render a non-text AST node to a Preact element.
 */
function renderSingleNode(
  node: ASTNode,
  key: number,
): preact.ComponentChildren {
  switch (node.type) {
    case 'text':
      return node.value;

    case 'link':
      return (
        <PassageLink
          key={key}
          target={node.target}
          className={node.className}
          id={node.id}
        >
          {node.display}
        </PassageLink>
      );

    case 'variable':
      return (
        <VarDisplay
          key={key}
          name={node.name}
          scope={node.scope}
          className={node.className}
          id={node.id}
        />
      );

    case 'macro':
      return renderMacro(node, key);

    case 'html':
      return (
        <HtmlNodeRenderer
          key={key}
          node={node}
        />
      );

    default: {
      const _exhaustive: never = node;
      return _exhaustive;
    }
  }
}

/**
 * Render AST nodes without markdown processing.
 * Used for inline containers (button labels, link text) where block-level
 * markdown (lists, headers) would misinterpret content like "-" or "+".
 */
export function renderInlineNodes(nodes: ASTNode[]): preact.ComponentChildren {
  if (nodes.length === 0) return null;
  return nodes.map((node, i) => renderSingleNode(node, i));
}

function hasUnclosedBacktick(s: string): boolean {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '`') count++;
  }
  return count % 2 === 1;
}

function getVariableTextValue(node: VariableNode): string {
  const state = useStoryStore.getState();
  const parts = node.name.split('.');
  const root = parts[0]!;

  let value: unknown;
  if (node.scope === 'variable') value = state.variables[root];
  else if (node.scope === 'temporary') value = state.temporary[root];

  for (let i = 1; i < parts.length; i++) {
    if (value == null || typeof value !== 'object') return '';
    value = (value as Record<string, unknown>)[parts[i]!];
  }

  return value == null ? '' : String(value);
}

/**
 * Render AST nodes with full CommonMark markdown support.
 *
 * Combines all nodes into a single markdown document, using <tw-N> placeholder
 * elements for non-text nodes (variables, macros, links, HTML). This allows
 * markdown syntax to span across Twine tokens — e.g., markdown tables can
 * contain {$variables} and {macros} in their cells.
 *
 * After micromark processes the combined string, the HTML is parsed back into
 * Preact VNodes with placeholders replaced by the real rendered components.
 */
export function renderNodes(nodes: ASTNode[]): preact.ComponentChildren {
  if (nodes.length === 0) return null;

  // If there's no text at all, render nodes directly without markdown
  const hasText = nodes.some((n) => n.type === 'text');
  if (!hasText) {
    return nodes.map((node, i) => renderSingleNode(node, i));
  }

  // Build combined markdown string with placeholders for non-text nodes
  const components: preact.ComponentChildren[] = [];
  let combined = '';

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.type === 'text') {
      combined += node.value.replace(/^[ \t]{4,}/gm, ' ');
    } else if (node.type === 'variable' && hasUnclosedBacktick(combined)) {
      // Inline variable value to avoid placeholder inside code span
      combined += getVariableTextValue(node);
    } else {
      const phIdx = components.length;
      components.push(renderSingleNode(node, i));
      combined += `<span data-tw="${phIdx}"></span>`;
    }
  }

  // Run combined text through markdown
  const html = markdownToHtml(combined);

  // Convert HTML to Preact VNodes, replacing placeholders with components
  return htmlToPreact(html, components);
}
