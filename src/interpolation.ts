const INTERP_RE = /\{(\$[\w.]+|_[\w.]+|@[\w.]+)\}/g;
const INTERP_TEST = /\{[\$_@][\w.]+\}/;

export function hasInterpolation(s: string): boolean {
  return INTERP_TEST.test(s);
}

function resolveDotPath(root: unknown, parts: string[]): unknown {
  let value = root;
  for (let i = 1; i < parts.length; i++) {
    if (value == null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[parts[i]!];
  }
  return value;
}

export function interpolate(
  template: string,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown>,
): string {
  return template.replace(INTERP_RE, (_match, ref: string) => {
    const prefix = ref[0]!;
    const path = ref.slice(1);
    const parts = path.split('.');
    const root = parts[0]!;

    let value: unknown;
    if (prefix === '$') {
      value = variables[root];
    } else if (prefix === '_') {
      value = temporary[root];
    } else {
      value = locals[root];
    }

    if (parts.length > 1) {
      value = resolveDotPath(value, parts);
    }

    return value == null ? '' : String(value);
  });
}
