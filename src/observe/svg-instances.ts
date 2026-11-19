// Keep the isolated browsing context across observations. Repeatedly inserting
// and removing it would retrigger author MutationObservers that call observe().
const frames = new WeakMap<Document, HTMLIFrameElement>();
const detachedDocuments = new WeakMap<Document, Document>();

/**
 * Resolve a use instance's styles in an isolated tree. Source computed styles
 * inherit from the definition's ancestors, whereas SVG instances inherit from
 * their use host and match selectors within their own shadow tree.
 */
export class SvgInstances {
  private document?: Document;
  private hosts: Element[] = [];
  private sources = new WeakMap<Element, Element>();
  private stylesheets = new WeakMap<Node, string>();
  private remaining = 10_000;

  source(element: Element): Element {
    return this.sources.get(element) ?? element;
  }

  private stylesheet(use: Element): string {
    const root = this.source(use).getRootNode() as Document | ShadowRoot;
    const cached = this.stylesheets.get(root);
    if (cached !== undefined) return cached;
    const rules = (sheet: CSSStyleSheet): string => {
      try {
        return [...sheet.cssRules]
          .map((rule) => {
            if (rule.type === 3) {
              const imported = rule as CSSImportRule;
              if (!imported.styleSheet) return '';
              const text = rules(imported.styleSheet);
              let wrapped = imported.media.mediaText
                ? `@media ${imported.media.mediaText}{${text}}`
                : text;
              if (imported.supportsText) {
                wrapped = `@supports (${imported.supportsText}){${wrapped}}`;
              }
              if (
                imported.layerName !== null &&
                imported.layerName !== undefined
              ) {
                wrapped = `@layer ${imported.layerName}{${wrapped}}`;
              }
              return wrapped;
            }
            return rule.cssText;
          })
          .join('\n');
      } catch {
        // As elsewhere in headless observations, inaccessible external CSS
        // cannot be inspected. Inline styles and presentation attributes work.
        return '';
      }
    };
    const text = [
      ...(root.styleSheets ?? []),
      ...(root.adoptedStyleSheets ?? []),
    ]
      .filter((sheet) => !sheet.disabled)
      .map((sheet) => {
        const text = rules(sheet);
        return sheet.media.mediaText
          ? `@media ${sheet.media.mediaText}{${text}}`
          : text;
      })
      .join('\n');
    this.stylesheets.set(root, text);
    return text;
  }

  expand(use: Element, target: Element): Element | undefined {
    if (this.remaining <= 0) return;
    if (!this.document) {
      const doc = use.ownerDocument;
      const detached = doc.implementation.createHTMLDocument('');
      const probe = detached.createElement('div');
      probe.style.visibility = 'hidden';
      detached.body.appendChild(probe);
      // DOMs without layout can resolve styles in a detached document. Avoid
      // creating a browsing context there (headless hosts disable iframes).
      if (
        (doc.defaultView ?? globalThis.window)?.getComputedStyle(probe)
          .visibility === 'hidden'
      ) {
        probe.remove();
        let isolated = detachedDocuments.get(doc);
        if (!isolated) {
          // Headless DOM constructors provide an independent custom-element
          // registry. createHTMLDocument alone still shares the author's one.
          const view = doc.defaultView ?? globalThis.window;
          isolated = detached;
          try {
            const context = Reflect.construct((view as typeof window).Window, [
              {
                settings: {
                  disableJavaScriptEvaluation: true,
                  disableCSSFileLoading: true,
                  disableIframePageLoading: true,
                },
              },
            ]) as Window;
            isolated = context.document ?? detached;
          } catch {
            // Other DOMs (including jsdom) expose a nonconstructible Window;
            // their inert documents already have an isolated element registry.
          }
          detachedDocuments.set(doc, isolated);
        }
        this.document = isolated;
      } else {
        let frame = frames.get(doc);
        if (!frame?.isConnected) {
          frame = doc.createElement('iframe');
          // A separate registry avoids running author custom-element constructors;
          // sandboxing and CSP also prevent cloned content from executing scripts
          // or fetching resources. Nothing in the author's source tree is changed.
          frame.setAttribute('sandbox', 'allow-same-origin');
          frame.setAttribute('aria-hidden', 'true');
          frame.tabIndex = -1;
          frame.style.cssText =
            'all:initial!important;display:block!important;position:fixed!important;' +
            'left:-100000px!important;top:0!important;' +
            'visibility:hidden!important;pointer-events:none!important;border:0!important;' +
            `width:${doc.defaultView?.innerWidth ?? 1024}px!important;` +
            `height:${doc.defaultView?.innerHeight ?? 768}px!important;`;
          doc.documentElement.insertBefore(frame, doc.body);
          frames.set(doc, frame);
          const isolated = frame.contentDocument;
          if (isolated) {
            const meta = isolated.createElement('meta');
            meta.httpEquiv = 'Content-Security-Policy';
            meta.content = "default-src 'none'; style-src 'unsafe-inline'";
            isolated.head.appendChild(meta);
          }
        }
        this.document = frame.contentDocument ?? undefined;
        if (!this.document) return;
        // Only write changed dimensions, so observing from a MutationObserver
        // does not create another mutation on every call.
        const width = `${doc.defaultView?.innerWidth ?? 1024}px`;
        const height = `${doc.defaultView?.innerHeight ?? 768}px`;
        if (frame.style.width !== width)
          frame.style.setProperty('width', width, 'important');
        if (frame.style.height !== height)
          frame.style.setProperty('height', height, 'important');
      }
    }
    const doc = this.document;
    const host = doc.createElement('div');
    const computed = (
      use.ownerDocument.defaultView ?? globalThis.window
    )?.getComputedStyle(use);
    // Custom properties can drive visibility/display in the referenced tree.
    if (computed) {
      host.style.visibility =
        computed.visibility ||
        (use as SVGElement).style.visibility ||
        use.getAttribute('visibility') ||
        '';
      host.style.display =
        computed.display || (use as SVGElement).style.display;
      for (const name of Array.from(computed)) {
        if (name.startsWith('--')) {
          host.style.setProperty(name, computed.getPropertyValue(name));
        }
      }
    }
    doc.body.appendChild(host);
    this.hosts.push(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = this.stylesheet(use);
    const copy = (node: Node): Node | undefined => {
      if (--this.remaining < 0) return;
      let clone: Node;
      if (node.nodeType === 1) {
        const element = node as Element;
        clone = doc.createElementNS(element.namespaceURI, element.localName);
        for (const attribute of element.attributes) {
          (clone as Element).setAttributeNS(
            attribute.namespaceURI,
            attribute.name,
            attribute.value,
          );
        }
        this.sources.set(clone as Element, this.source(node as Element));
      } else if (node.nodeType === 3) {
        clone = doc.createTextNode(node.textContent ?? '');
      } else {
        return;
      }
      for (const child of node.childNodes) {
        if (this.remaining <= 0) break;
        const copied = copy(child);
        if (copied) clone.appendChild(copied);
      }
      return clone;
    };
    const clone = copy(target) as Element | undefined;
    if (clone) shadow.appendChild(clone);
    shadow.appendChild(style);
    return clone;
  }

  dispose(): void {
    for (const host of this.hosts) host.remove();
  }
}
