import type { Page, PageNode, SiteDocument } from '@core/page-tree'
import { parseTokenString, publishedRenderScopes } from '@core/templates'
import { walkRenderTree } from '@core/visualComponents'
import { mapJsonStrings } from '@core/utils/jsonStrings'
import { readLoopQueryBindings, resolveLoopQueryFilters, readSummaryLoopIds, LoopQueryConfigurationError } from '@core/loops'
import { loopSourceRegistry } from '@core/loops/registry'
import { normalizeIdentifierValue } from '@core/utils/identifier'

export interface LoopRenderScope {
  node: PageNode
  nodes: Readonly<Record<string, PageNode>>
  nested: boolean
}

const SOURCE_CONFIGURATION_KEYS = ['sourceId', 'filters', 'orderBy', 'direction', 'limit', 'offset', 'pagination', 'pageSize', 'loadMoreMode', 'queryBindings'] as const
type LoopScopeIssue = { kind: 'nested' | 'duplicate' } | { kind: 'binding'; propKey: typeof SOURCE_CONFIGURATION_KEYS[number]; property: 'props' | 'dynamicBindings' }

export class LoopScopeConfigurationError extends Error {
  readonly path: string

  constructor(page: Page, scope: LoopRenderScope, issue: LoopScopeIssue) {
    const detail = issue.kind === 'binding'
      ? `has a dynamic binding on authored source configuration "${issue.propKey}"; source configuration is fixed before prefetch`
      : issue.kind === 'nested'
      ? 'is inside another loop; infinite loading requires a route-level entry context'
      : 'has multiple instances on the same public page; infinite loading requires a unique loop id'
    const name = issue.kind === 'binding' ? 'Loop' : 'Infinite loop'
    super(`${name} "${scope.node.id}" on page "${page.title}" ${detail}`)
    this.name = 'LoopScopeConfigurationError'
    const property = issue.kind === 'binding' ? `${issue.property}.${issue.propKey}` : 'props.pagination'
    this.path = `pages.${page.id}.nodes.${scope.node.id}.${property}`
  }
}

/** The effective native tree owns both publication checks and fragment lookup. */
export function collectLoopRenderScopes(page: Page, site: SiteDocument): LoopRenderScope[] {
  const result: LoopRenderScope[] = []
  walkRenderTree(page.nodes, page.rootNodeId, site.visualComponents, (node, frame) => {
    if (node.moduleId !== 'base.loop') return
    result.push({ node, nodes: frame.nodes, nested: frame.ancestors.some((ancestor) => ancestor.moduleId === 'base.loop') })
  })
  return result
}

/** An entry route's initial stack is supported; an outer loop's iteration is not. */
export function assertLoopRenderScopes(page: Page, scopes: readonly LoopRenderScope[]): void {
  const counts = new Map<string, number>()
  for (const scope of scopes) counts.set(scope.node.id, (counts.get(scope.node.id) ?? 0) + 1)
  for (const scope of scopes) {
    for (const propKey of SOURCE_CONFIGURATION_KEYS) {
      if (scope.node.dynamicBindings?.[propKey]) {
        throw new LoopScopeConfigurationError(page, scope, { kind: 'binding', propKey, property: 'dynamicBindings' })
      }
      mapJsonStrings(scope.node.props[propKey], value => {
        if (parseTokenString(value).some((segment) => segment.kind === 'token')) throw new LoopScopeConfigurationError(page, scope, { kind: 'binding', propKey, property: 'props' })
        return value
      })
    }
    loopSourceRegistry.get(String(scope.node.props.sourceId))?.assertFilters?.(scope.node.props.filters && typeof scope.node.props.filters === 'object' ? scope.node.props.filters as Record<string, unknown> : {})
    const bindings = readLoopQueryBindings(scope.node.props.queryBindings)
    if (bindings.length) {
      if (scope.node.props.pagination !== 'infinite') throw new LoopQueryConfigurationError('Visitor filters require infinite pagination', `pages.${page.id}.nodes.${scope.node.id}.props.pagination`)
      resolveLoopQueryFilters({}, bindings, {}, loopSourceRegistry.get(String(scope.node.props.sourceId))?.queryFilterKeys ?? [])
      const parameters = new Set<string>()
      for (const binding of bindings) {
        if (!/^[\w-]+$/.test(binding.queryParameter) || parameters.has(binding.queryParameter)) throw new LoopQueryConfigurationError('Visitor query parameters must be distinct simple names')
        parameters.add(binding.queryParameter)
      }
    }
    if (scope.node.props.pagination !== 'infinite') continue
    if (scope.nested) throw new LoopScopeConfigurationError(page, scope, { kind: 'nested' })
    if (counts.get(scope.node.id)! > 1) throw new LoopScopeConfigurationError(page, scope, { kind: 'duplicate' })
  }
}

export function assertPageLoopScopes(page: Page, site: SiteDocument): void {
  const scopes = collectLoopRenderScopes(page, site)
  assertLoopRenderScopes(page, scopes)
  const forms = new Map<string, Set<string>>()
  const rendered: PageNode[] = []
  const moreCounts=new Map<string,number>()
  walkRenderTree(page.nodes, page.rootNodeId, site.visualComponents, (node, frame) => {
    rendered.push(node)
    if(node.moduleId==='base.loop-more') {
      const target=String(node.props.loopId??''),count=(moreCounts.get(target)??0)+1;moreCounts.set(target,count)
      if(count>1||frame.ancestors.some(ancestor=>ancestor.moduleId==='base.loop'&&ancestor.id===target))throw new LoopQueryConfigurationError('Load-more controls require one external instance per target loop',`pages.${page.id}.nodes.${node.id}.props.loopId`)
    }
    if (node.moduleId === 'base.form') forms.set(normalizeIdentifierValue(String(node.props.formId || 'form'), 'form'), new Set(Object.keys(node.props.calculations && typeof node.props.calculations === 'object' ? node.props.calculations : {})))
    if (['base.input', 'base.select', 'base.textarea', 'base.checkbox', 'base.radio'].includes(node.moduleId)) {
      const form = [...frame.ancestors].reverse().find(ancestor => ancestor.moduleId === 'base.form')
      if (form) forms.get(normalizeIdentifierValue(String(form.props.formId || 'form'), 'form'))?.add(String(node.props.name || node.props.fieldId || ''))
    }
  })
  for (const scope of scopes) for (const binding of readLoopQueryBindings(scope.node.props.queryBindings)) {
    if (!forms.get(binding.formId)?.has(binding.fieldName)) throw new LoopQueryConfigurationError('Visitor filter requires an existing associated form control', `pages.${page.id}.nodes.${scope.node.id}.props.queryBindings`)
  }
  const ids = new Set(scopes.map(scope => scope.node.id))
  for (const node of rendered) if (node.moduleId === 'base.loop-count' || node.moduleId === 'base.loop-conditional') {
    const referenced = readSummaryLoopIds(node.props.loopIds)
    if (!referenced.length || referenced.some(id => !ids.has(id))) throw new LoopQueryConfigurationError('Loop summaries require existing rendered loops', `pages.${page.id}.nodes.${node.id}.props.loopIds`)
  }
  for(const [id] of moreCounts)if(!scopes.some(scope=>scope.node.id===id&&scope.node.props.pagination==='infinite'))throw new LoopQueryConfigurationError('Load-more control requires an existing infinite loop',`pages.${page.id}.loopMore.${id}`)
}

/** Raw unused templates/components and hidden or orphan nodes are not public scopes. */
export function assertSiteLoopScopes(site: SiteDocument): void {
  for (const scope of publishedRenderScopes(site)) assertPageLoopScopes(scope.page, site)
}
