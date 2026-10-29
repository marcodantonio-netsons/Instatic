/** Transform string leaves in JSON-shaped values; unchanged branches retain identity. */
export function mapJsonStrings(value: unknown, transform: (value: string, path: string) => string, path = ''): unknown {
  if (typeof value === 'string') return transform(value, path)
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((child, index) => { const mapped = mapJsonStrings(child, transform, `${path}.${index}`); changed ||= mapped !== child; return mapped })
    return changed ? next : value
  }
  let next: Record<string, unknown> | undefined
  for (const [key, child] of Object.entries(value)) {
    const mapped = mapJsonStrings(child, transform, path ? `${path}.${key}` : key)
    if (mapped !== child) { next ??= { ...value }; next[key] = mapped }
  }
  return next ?? value
}
