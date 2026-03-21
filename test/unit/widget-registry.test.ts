import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerWidget,
  getWidget,
  clearWidgets,
  isBlockWidget,
} from '../../src/widgets/widget-registry';
import type { ASTNode } from '../../src/markup/ast';

describe('widget-registry', () => {
  beforeEach(() => {
    clearWidgets();
  });

  it('registers and retrieves a widget by name', () => {
    const body: ASTNode[] = [{ type: 'text', value: 'Hello from widget' }];
    registerWidget('greeting', body, []);
    const widget = getWidget('greeting');
    expect(widget?.body).toBe(body);
    expect(widget?.params).toEqual([]);
  });

  it('returns undefined for unregistered widget', () => {
    expect(getWidget('nonexistent')).toBeUndefined();
  });

  it('is case-insensitive', () => {
    const body: ASTNode[] = [{ type: 'text', value: 'test' }];
    registerWidget('MyWidget', body, []);
    expect(getWidget('mywidget')?.body).toBe(body);
    expect(getWidget('MYWIDGET')?.body).toBe(body);
  });

  it('overwrites a widget with the same name', () => {
    const body1: ASTNode[] = [{ type: 'text', value: 'v1' }];
    const body2: ASTNode[] = [{ type: 'text', value: 'v2' }];
    registerWidget('w', body1, []);
    registerWidget('w', body2, []);
    expect(getWidget('w')?.body).toBe(body2);
  });

  it('stores parameter names', () => {
    const body: ASTNode[] = [{ type: 'text', value: 'test' }];
    registerWidget('greet', body, ['$name', '$age']);
    const widget = getWidget('greet');
    expect(widget?.params).toEqual(['$name', '$age']);
  });

  it('clearWidgets removes all widgets', () => {
    registerWidget('a', [{ type: 'text', value: 'A' }], []);
    registerWidget('b', [{ type: 'text', value: 'B' }], []);
    clearWidgets();
    expect(getWidget('a')).toBeUndefined();
    expect(getWidget('b')).toBeUndefined();
  });

  it('stores isBlock flag as true when provided', () => {
    const body: ASTNode[] = [{ type: 'text', value: 'block widget' }];
    registerWidget('myblock', body, [], true);
    expect(getWidget('myblock')?.isBlock).toBe(true);
  });

  it('isBlock defaults to false when not provided', () => {
    const body: ASTNode[] = [{ type: 'text', value: 'inline widget' }];
    registerWidget('myinline', body, []);
    expect(getWidget('myinline')?.isBlock).toBe(false);
  });

  it('isBlockWidget() returns true for block widgets (case-insensitive)', () => {
    registerWidget('BlockCard', [{ type: 'text', value: 'test' }], [], true);
    expect(isBlockWidget('BlockCard')).toBe(true);
    expect(isBlockWidget('blockcard')).toBe(true);
    expect(isBlockWidget('BLOCKCARD')).toBe(true);
  });

  it('isBlockWidget() returns false for non-block widgets', () => {
    registerWidget('InlineBtn', [{ type: 'text', value: 'test' }], [], false);
    expect(isBlockWidget('InlineBtn')).toBe(false);
  });

  it('isBlockWidget() returns false for unregistered widgets', () => {
    expect(isBlockWidget('doesNotExist')).toBe(false);
  });

  it('strips @children from params list', () => {
    const body: ASTNode[] = [{ type: 'text', value: 'test' }];
    registerWidget('card', body, ['$title', '@children', '$class'], true);
    expect(getWidget('card')?.params).toEqual(['$title', '$class']);
  });
});
