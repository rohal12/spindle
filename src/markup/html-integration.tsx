import {
  createPortal,
  h,
  type ComponentChildren,
  type RefObject,
} from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

export function isHtmlEncoding(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^(?:text\/html|application\/xhtml\+xml)$/i.test(value)
  );
}

export function authorElement(
  tag: string,
  attributes: Record<string, unknown>,
  children: ComponentChildren,
  math: boolean,
) {
  return math && tag === 'annotation-xml' ? (
    <HtmlAnnotation
      key={attributes.key as string | number | undefined}
      attributes={attributes}
    >
      {children}
    </HtmlAnnotation>
  ) : (
    h(tag, attributes, children)
  );
}

/**
 * Preact handles MathML text integration points, but does not yet switch the
 * namespace for HTML-encoded annotation-xml. A portal's container can supply
 * that namespace without adding a wrapper or changing the MathML element.
 */
function HtmlAnnotation({
  attributes,
  children,
}: {
  attributes: Record<string, unknown>;
  children: ComponentChildren;
}) {
  const elementRef = useRef<Element>(null);
  const [container, setContainer] = useState<
    | (Pick<
        Element,
        | 'nodeType'
        | 'parentNode'
        | 'firstChild'
        | 'childNodes'
        | 'ownerDocument'
        | 'insertBefore'
        | 'appendChild'
        | 'removeChild'
      > & { namespaceURI: string })
    | null
  >(null);
  useLayoutEffect(() => {
    const element = elementRef.current!;
    setContainer({
      nodeType: 1,
      namespaceURI: 'http://www.w3.org/1999/xhtml',
      ownerDocument: element.ownerDocument,
      get parentNode() {
        return element.parentNode;
      },
      get firstChild() {
        return element.firstChild;
      },
      get childNodes() {
        return element.childNodes;
      },
      insertBefore: element.insertBefore.bind(element),
      appendChild: element.appendChild.bind(element),
      removeChild: element.removeChild.bind(element),
    });
  }, []);
  return (
    <>
      {h(
        'annotation-xml',
        {
          ...attributes,
          ref: (element: Element | null) => {
            elementRef.current = element;
            const forwarded = attributes.ref as
              RefObject<Element | null> | undefined;
            if (forwarded) forwarded.current = element;
          },
        },
        isHtmlEncoding(attributes.encoding) ? undefined : children,
      )}
      {container &&
        isHtmlEncoding(attributes.encoding) &&
        createPortal(children, container)}
    </>
  );
}
