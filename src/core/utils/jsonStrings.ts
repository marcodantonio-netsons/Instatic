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

/** Visit JSON string leaves without transforming or copying the input. */
export function visitJsonStrings(value: unknown, visit: (value: string, path: string) => void, path = ''): void {
  if (typeof value === 'string') {
    visit(value, path)
    return
  }
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (index in value) visitJsonStrings(value[index], visit, `${path}.${index}`)
    }
    return
  }
  for (const key in value) {
    if (Object.hasOwn(value, key)) {
      visitJsonStrings((value as Record<string, unknown>)[key], visit, path ? `${path}.${key}` : key)
    }
  }
}
