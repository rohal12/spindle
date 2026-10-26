/** Runtime-owned passage roles, shared with stateless authoring tools. */
const SPECIAL_PASSAGES = new Set([
  'StoryInit',
  'StoryInterface',
  'StoryVariables',
  'StoryTransients',
  'StoryLoading',
  'SaveTitle',
  'PassageReady',
  'PassageHeader',
  'PassageFooter',
  'PassageDone',
  'StoryContext',
]);

/** Whether `name` is a special passage, which navigation never goes to. */
export function isSpecialPassage(name: string): boolean {
  return SPECIAL_PASSAGES.has(name);
}
