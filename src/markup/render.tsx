import { createContext } from 'preact';
import { PassageLink } from '../components/PassageLink';
import { VarDisplay } from '../components/macros/VarDisplay';
import { WidgetInvocation } from '../components/macros/WidgetInvocation';
import { getWidget } from '../widgets/widget-registry';
import { getMacro, isSubMacro } from '../registry';
import { markdownToHtml } from './markdown';
import { h } from 'preact';
import type { ASTNode, HtmlNode, MacroNode, VariableNode } from './ast';
import { useStoryStore } from '../store';
import { useInterpolate } from '../hooks/use-interpolate';

export interface LocalsUpdater {
  update: (key: string, value: unknown) => void;
  getValues: () => Record<string, unknown>;
}

const defaultUpdater: LocalsUpdater = {
  update: () => {},
  getValues: () => ({}),
};

export const LocalsValuesContext = createContext<Record<string, unknown>>({});
export const LocalsUpdateContext = createContext<LocalsUpdater>(defaultUpdater);

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
  if (isSubMacro(node.name)) return null;

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

  const Component = getMacro(node.name);
  if (Component) {
    return (
      <Component
        key={key}
        rawArgs={node.rawArgs}
        className={node.className}
        id={node.id}
        children={node.children}
        branches={node.branches}
      />
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
