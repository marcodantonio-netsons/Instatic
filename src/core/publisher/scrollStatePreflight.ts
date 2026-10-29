import type { BaseNode, Page, SiteDocument } from '@core/page-tree'
import { buildTemplateRenderContext, publishedRenderScopes } from '@core/templates'
import { walkRenderTree } from '@core/visualComponents'
import { resolveHtmlTag, VOID_HTML_ELEMENTS, MODULE_GENERATED_ATTRIBUTE_NAMES } from '@core/htmlAttributes'

export class ScrollStateConfigurationError extends Error {
  readonly path: string
  constructor(message: string, path: string) { super(`${path}: ${message}`); this.name = 'ScrollStateConfigurationError'; this.path = path }
}

export function assertScrollStateForest(forest: { nodes: Readonly<Record<string, BaseNode>>; rootNodeIds: readonly string[] }, path = 'nodes'): void {
  const visible: BaseNode[] = []
  function visit(id: string) {
    const node = forest.nodes[id]
    if (!node || node.hidden) return
    visible.push(node)
    node.children.forEach(visit)
  }
  forest.rootNodeIds.forEach(visit)
  for (const node of visible) if (node.moduleId === 'base.scroll-state') {
    const location = `${path}.${node.id}`, targetId = node.props.targetId
    if (typeof targetId !== 'string' || !targetId.trim()) throw new ScrollStateConfigurationError('Scroll state requires an authored target ID', location)
    const targets = visible.filter(target => {
      if (['base.visual-component-ref', 'base.slot-instance', 'base.slot-outlet'].includes(target.moduleId) || target.moduleId === 'base.text' && target.props.tag === 'none' || MODULE_GENERATED_ATTRIBUTE_NAMES[target.moduleId]?.includes('id')) return false
      const attributes = target.props.htmlAttributes
      return attributes && typeof attributes === 'object' && Reflect.get(attributes, 'id') === targetId
    })
    if (targets.length !== 1 || targets[0] === node) throw new ScrollStateConfigurationError('Target ID must identify one other rendered element', location)
    if (VOID_HTML_ELEMENTS.has(resolveHtmlTag(String(node.props.tag), String(node.props.customTag)))) throw new ScrollStateConfigurationError('Scroll state requires a non-void element', location)
  }
}

export function assertPageScrollState(page: Page, site: SiteDocument): void {
  const seen = new Set<string>()
  function contains(nodes: Readonly<Record<string, BaseNode>>): boolean {
    return Object.values(nodes).some(node => {
      if (node.moduleId === 'base.scroll-state') return true
      if (node.moduleId !== 'base.visual-component-ref') return false
      const id = String(node.props.componentId)
      if (seen.has(id)) return false
      seen.add(id)
      const component = site.visualComponents.find(component => component.id === id)
      return component ? contains(component.tree.nodes) : false
    })
  }
  if (!contains(page.nodes)) return
  const nodes: Record<string, BaseNode> = {}, rootNodeIds: string[] = []
  walkRenderTree(page.nodes, page.rootNodeId, site.visualComponents, (node, frame) => {
    const copy = { ...node, id: frame.id, parentId: frame.parentId, children: [] }
    nodes[frame.id] = copy
    if (frame.parentId) nodes[frame.parentId].children.push(frame.id)
    else rootNodeIds.push(frame.id)
  }, buildTemplateRenderContext(page, site, undefined))
  assertScrollStateForest({ nodes, rootNodeIds }, `pages.${page.id}.nodes`)
}
export function assertSiteScrollState(site: SiteDocument): void {
  for (const scope of publishedRenderScopes(site)) assertPageScrollState(scope.page, site)
}
