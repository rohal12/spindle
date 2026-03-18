// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  resolveTransitionFromTags,
  resolveTransition,
  fillDefaults,
  BUILT_IN_DEFAULT,
} from '../../src/transition';

describe('resolveTransitionFromTags', () => {
  it('returns null when no transition: tag present', () => {
    expect(resolveTransitionFromTags(['widget', 'nobr'])).toBeNull();
    expect(resolveTransitionFromTags([])).toBeNull();
  });

  it('parses transition type from tag', () => {
    expect(resolveTransitionFromTags(['transition:crossfade'])).toEqual({
      type: 'crossfade',
    });
  });

  it('parses duration and pause tags', () => {
    const tags = ['transition:fade-through', 'duration:600', 'pause:200'];
    expect(resolveTransitionFromTags(tags)).toEqual({
      type: 'fade-through',
      duration: 600,
      pause: 200,
    });
  });

  it('ignores duration/pause without transition: tag', () => {
    expect(resolveTransitionFromTags(['duration:600', 'pause:200'])).toBeNull();
  });

  it('returns null and warns for invalid type', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveTransitionFromTags(['transition:sparkle'])).toBeNull();
    expect(spy).toHaveBeenCalledWith('Unknown transition type: "sparkle"');
    spy.mockRestore();
  });

  it('ignores NaN duration values', () => {
    const tags = ['transition:fade', 'duration:abc'];
    expect(resolveTransitionFromTags(tags)).toEqual({ type: 'fade' });
  });

  it('treats empty string after colon as valid zero', () => {
    const tags = ['transition:fade', 'pause:'];
    expect(resolveTransitionFromTags(tags)).toEqual({ type: 'fade', pause: 0 });
  });
});

describe('fillDefaults', () => {
  it('fills missing duration and pause from built-in default', () => {
    expect(fillDefaults({ type: 'crossfade' })).toEqual({
      type: 'crossfade',
      duration: 300,
      pause: 50,
    });
  });

  it('preserves explicitly set values', () => {
    expect(
      fillDefaults({ type: 'fade-through', duration: 600, pause: 0 }),
    ).toEqual({
      type: 'fade-through',
      duration: 600,
      pause: 0,
    });
  });
});

describe('resolveTransition', () => {
  it('uses tags when present (highest priority)', () => {
    const result = resolveTransition(
      ['transition:none'],
      { type: 'crossfade', duration: 600 },
      { type: 'fade' },
    );
    expect(result.type).toBe('none');
  });

  it('uses nextTransition when no tags', () => {
    const result = resolveTransition(
      [],
      { type: 'crossfade', duration: 600 },
      { type: 'fade' },
    );
    expect(result).toEqual({ type: 'crossfade', duration: 600, pause: 50 });
  });

  it('uses storeDefault when no tags and no nextTransition', () => {
    const result = resolveTransition([], null, { type: 'fade' });
    expect(result).toEqual({ type: 'fade', duration: 300, pause: 50 });
  });

  it('uses built-in default when nothing configured', () => {
    const result = resolveTransition([], null, null);
    expect(result).toEqual(BUILT_IN_DEFAULT);
  });

  it('fills defaults from built-in, not from lower priority levels', () => {
    const result = resolveTransition(['transition:crossfade'], null, {
      type: 'fade',
      duration: 600,
    });
    expect(result.duration).toBe(300);
  });
});
