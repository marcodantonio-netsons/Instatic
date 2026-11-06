import type { Page, PageNode, SiteDocument } from '@core/page-tree'
import { parseTokenString, publishedRenderScopes } from '@core/templates'
import { walkRenderTree } from '@core/visualComponents'

export interface LoopRenderScope {
  node: PageNode
  nodes: Readonly<Record<string, PageNode>>
  nested: boolean
}

const SOURCE_CONFIGURATION_KEYS = ['sourceId', 'filters', 'orderBy', 'direction', 'limit', 'offset', 'pagination', 'pageSize'] as const
type LoopScopeIssue = { kind: 'binding'; propKey: typeof SOURCE_CONFIGURATION_KEYS[number]; property: 'props' | 'dynamicBindings' }

export class LoopScopeConfigurationError extends Error {
  readonly path: string

  constructor(page: Page, scope: LoopRenderScope, issue: LoopScopeIssue) {
    super(`Loop "${scope.node.id}" on page "${page.title}" has a dynamic binding on authored source configuration "${issue.propKey}"; source configuration is fixed before prefetch`)
    this.name = 'LoopScopeConfigurationError'
    const property = `${issue.property}.${issue.propKey}`
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

/** Actual entry-frame locators support nested and repeated instances; source configuration stays fixed. */
export function assertLoopRenderScopes(page: Page, scopes: readonly LoopRenderScope[]): void {
  for (const scope of scopes) assertLoopSourceConfiguration(page, scope)
}

/** Shared by preflight and the actual-entry read executor. */
export function assertLoopSourceConfiguration(page: Page, scope: LoopRenderScope): void {
  for (const propKey of SOURCE_CONFIGURATION_KEYS) {
    if (scope.node.dynamicBindings?.[propKey]) {
      throw new LoopScopeConfigurationError(page, scope, { kind: 'binding', propKey, property: 'dynamicBindings' })
    }
    const value = scope.node.props[propKey]
    if (typeof value === 'string' && parseTokenString(value).some(segment => segment.kind === 'token')) {
      throw new LoopScopeConfigurationError(page, scope, { kind: 'binding', propKey, property: 'props' })
    }
  }
}

export function assertPageLoopScopes(page: Page, site: SiteDocument): void {
  assertLoopRenderScopes(page, collectLoopRenderScopes(page, site))
}

/** Raw unused templates/components and hidden or orphan nodes are not public scopes. */
export function assertSiteLoopScopes(site: SiteDocument): void {
  for (const scope of publishedRenderScopes(site)) assertPageLoopScopes(scope.page, site)
}
