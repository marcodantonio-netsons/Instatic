/** Native properties that address tree nodes, rather than authored HTML IDs. */
const NODE_REFERENCE_PROPERTIES: Readonly<Record<string, Readonly<Record<string, 'single' | 'space-separated'>>>> = {
  'base.loop-more': { loopId: 'single' },
  'base.loop-count': { loopIds: 'space-separated' },
  'base.loop-conditional': { loopIds: 'space-separated' },
}

/**
 * Remap declared node references with the same map as the tree structure.
 * Unknown targets belong to another scope (or remain invalid for preflight).
 * Copy, URLs, HTML IDs, form identifiers and parameter/binding IDs are content,
 * not node references, and must never be rewritten by string resemblance.
 */
export function remapNodeReferenceProps(
  moduleId: string,
  props: Readonly<Record<string, unknown>>,
  idMap: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const result = { ...props }
  for (const [key, cardinality] of Object.entries(NODE_REFERENCE_PROPERTIES[moduleId] ?? {})) {
    const value = props[key]
    if (typeof value !== 'string') continue
    result[key] = cardinality === 'single'
      ? idMap.get(value) ?? value
      : value.replace(/\S+/g, target => idMap.get(target) ?? target)
  }
  return result
}
