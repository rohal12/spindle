export type TransitionType = 'none' | 'fade' | 'fade-through' | 'crossfade';

export interface TransitionConfig {
  type: TransitionType;
  duration?: number;
  pause?: number;
}

export type ResolvedTransition = Required<TransitionConfig>;

const TRANSITION_TYPES = new Set<TransitionType>([
  'none',
  'fade',
  'fade-through',
  'crossfade',
]);

export const BUILT_IN_DEFAULT: ResolvedTransition = {
  type: 'fade-through',
  duration: 300,
  pause: 50,
};

export function resolveTransitionFromTags(
  tags: string[],
): TransitionConfig | null {
  const typeTag = tags.find((t) => t.startsWith('transition:'));
  if (!typeTag) return null;

  const rawType = typeTag.slice('transition:'.length);
  if (!TRANSITION_TYPES.has(rawType as TransitionType)) {
    console.warn(`Unknown transition type: "${rawType}"`);
    return null;
  }

  const config: TransitionConfig = { type: rawType as TransitionType };

  for (const tag of tags) {
    if (tag.startsWith('duration:')) {
      const n = Number(tag.slice('duration:'.length));
      if (!Number.isNaN(n)) config.duration = n;
    } else if (tag.startsWith('pause:')) {
      const n = Number(tag.slice('pause:'.length));
      if (!Number.isNaN(n)) config.pause = n;
    }
  }

  return config;
}

export function fillDefaults(partial: TransitionConfig): ResolvedTransition {
  return {
    type: partial.type,
    duration: partial.duration ?? BUILT_IN_DEFAULT.duration,
    pause: partial.pause ?? BUILT_IN_DEFAULT.pause,
  };
}

export function resolveTransition(
  targetTags: string[],
  nextTransition: TransitionConfig | null,
  storeDefault: TransitionConfig | null,
): ResolvedTransition {
  const fromTags = resolveTransitionFromTags(targetTags);
  if (fromTags) return fillDefaults(fromTags);
  if (nextTransition) return fillDefaults(nextTransition);
  if (storeDefault) return fillDefaults(storeDefault);
  return { ...BUILT_IN_DEFAULT };
}
