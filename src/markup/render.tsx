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
import { Save } from '../components/macros/Save';
import { Load } from '../components/macros/Load';
import { SettingsButton } from '../components/macros/SettingsButton';
import { getMacro } from '../registry';
import type { ASTNode, MacroNode } from './ast';

export const LocalsContext = createContext<Record<string, unknown>>({});

/**
 * Render text with paragraph-style line breaks:
 * - Single newline → space (source formatting, not visual break)
 * - Double newline (blank line) → <br /> (intentional paragraph break)
 */
function renderText(text: string) {
  const paragraphs = text.split(/\n{2,}/);
  if (paragraphs.length === 1) {
    return <>{text.replace(/\n/g, ' ')}</>;
  }

  return (
    <>
      {paragraphs.map((para, i) => (
        <span key={i}>
          {para.replace(/\n/g, ' ')}
          {i < paragraphs.length - 1 && <br />}
        </span>
      ))}
    </>
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

    case 'print':
      return (
        <Print
          key={key}
          rawArgs={node.rawArgs}
          className={node.className}
          id={node.id}
        />
      );

    case 'if':
      return (
        <If
          key={key}
          branches={node.branches!}
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

    case 'restart':
      return (
        <Restart
          key={key}
          className={node.className}
          id={node.id}
        />
      );

    case 'save':
      return (
        <Save
          key={key}
          className={node.className}
          id={node.id}
        />
      );

    case 'load':
      return (
        <Load
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

    default: {
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

export function renderNodes(nodes: ASTNode[]): preact.ComponentChildren {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return <span key={i}>{renderText(node.value)}</span>;

      case 'link':
        return (
          <PassageLink
            key={i}
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
            key={i}
            name={node.name}
            scope={node.scope}
            className={node.className}
            id={node.id}
          />
        );

      case 'macro':
        return renderMacro(node, i);
    }
  });
}
