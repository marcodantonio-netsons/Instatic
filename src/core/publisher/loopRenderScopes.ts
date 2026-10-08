import type { Page, PageNode, SiteDocument } from '@core/page-tree'
import { publishedRenderScopes } from '@core/templates'
import { walkRenderTree } from '@core/visualComponents'

export interface LoopRenderScope {
  node: PageNode
  nodes: Readonly<Record<string, PageNode>>
  nested: boolean
}

export class LoopScopeConfigurationError extends Error {
  readonly path: string

  constructor(page: Page, scope: LoopRenderScope, reason: 'nested' | 'duplicate') {
    const detail = reason === 'nested'
      ? 'is inside another loop; infinite loading requires a route-level entry context'
      : 'has multiple instances on the same public page; infinite loading requires a unique loop id'
    super(`Infinite loop "${scope.node.id}" on page "${page.title}" ${detail}`)
    this.name = 'LoopScopeConfigurationError'
    this.path = `pages.${page.id}.nodes.${scope.node.id}.props.pagination`
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
export function assertInfiniteLoopRenderScopes(page: Page, scopes: readonly LoopRenderScope[]): void {
  const counts = new Map<string, number>()
  for (const scope of scopes) counts.set(scope.node.id, (counts.get(scope.node.id) ?? 0) + 1)
  for (const scope of scopes) {
    if (scope.node.props.pagination !== 'infinite') continue
    if (scope.nested) throw new LoopScopeConfigurationError(page, scope, 'nested')
    if (counts.get(scope.node.id)! > 1) throw new LoopScopeConfigurationError(page, scope, 'duplicate')
  }
}

export function assertPageInfiniteLoopScopes(page: Page, site: SiteDocument): void {
  assertInfiniteLoopRenderScopes(page, collectLoopRenderScopes(page, site))
}

/** Raw unused templates/components and hidden or orphan nodes are not public scopes. */
export function assertSiteInfiniteLoopScopes(site: SiteDocument): void {
  for (const scope of publishedRenderScopes(site)) assertPageInfiniteLoopScopes(scope.page, site)
}
