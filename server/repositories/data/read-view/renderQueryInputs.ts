import type { PageNode } from '@core/page-tree'
import { effectiveNodeBindings, parseTokenString } from '@core/templates'
import { loopPageQueryKey, loopSourceRegistry } from '@core/loops'
import { dataLoopQueryParameterNames, type DataRenderQueryInputs } from '@core/data-read'

/** Accumulated only by the actual/deferred native render executor. */
export function collectDataRenderQueryInputs(input: DataRenderQueryInputs, node: PageNode): DataRenderQueryInputs {
  if (input.kind === 'all') return input
  const names = new Set(input.names)
  let all = false
  const collect = (source: string, field: string) => {
    if (source !== 'route') return
    if (field === 'query') all = true
    else if (field.startsWith('query.')) names.add(field.slice(6).split('.')[0])
  }
  for (const binding of Object.values(effectiveNodeBindings(node) ?? {})) collect(binding.source, binding.field)
  const strings = Object.entries(node.props).flatMap(([key, value]) => {
    if (typeof value === 'string') return [value]
    return key === 'htmlAttributes' && value && typeof value === 'object' && !Array.isArray(value)
      ? Object.values(value).filter(value => typeof value === 'string') : []
  })
  for (const value of strings) for (const segment of parseTokenString(value)) if (segment.kind === 'token') collect(segment.source, segment.field)
  if (node.moduleId === 'base.loop') {
    if (node.props.pagination === 'infinite') names.add(loopPageQueryKey(node.id))
    if (node.props.sourceId === 'data.rows') for (const name of dataLoopQueryParameterNames(node)) names.add(name)
    else {
      const source = typeof node.props.sourceId === 'string' ? loopSourceRegistry.get(node.props.sourceId) : undefined
      if (source?.requestDependent || source?.perVisitor) all = true
    }
  }
  return all ? { kind: 'all' } : { kind: 'declared', names: [...names].sort() }
}
