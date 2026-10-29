import type { BaseNode, Page, SiteDocument } from '@core/page-tree'
import { buildTemplateRenderContext, publishedRenderScopes } from '@core/templates'
import { walkRenderTree } from '@core/visualComponents'

const interactive = new Set(['base.scroll-rail', 'base.scroll-controls', 'base.scroll-button', 'base.section-nav', 'base.tabs', 'base.tab', 'base.tab-panel', 'base.tab-link'])
const transparent = new Set(['base.body', 'base.visual-component-ref', 'base.slot-instance', 'base.slot-outlet'])
export class ScrollNavigationConfigurationError extends Error {
  readonly path: string
  constructor(message: string, path: string) { super(`${path}: ${message}`); this.name = 'ScrollNavigationConfigurationError'; this.path = path }
}

/** Validate the emitted structural relationships, after Visual Component/slot composition. */
export function assertScrollNavigationForest(forest: { nodes: Readonly<Record<string, BaseNode>>; rootNodeIds: readonly string[] }, path = 'nodes'): void {
  type Element = { node: BaseNode; parent: Element | null; children: Element[] }
  const all: Element[] = []
  function expand(id: string, parent: Element | null): Element[] {
    const node = forest.nodes[id]
    if (!node || node.hidden) return []
    if (transparent.has(node.moduleId) || (node.moduleId === 'base.text' && node.props.tag === 'none')) return node.children.flatMap(child => expand(child, parent))
    const item: Element = { node, parent, children: [] }
    all.push(item); item.children = node.children.flatMap(child => expand(child, item))
    return [item]
  }
  const roots = forest.rootNodeIds.flatMap(id => expand(id, null))
  const fail = (element: Element, message: string): never => { throw new ScrollNavigationConfigurationError(message, `${path}.${element.node.id}`) }
  function closest(element: Element, moduleId: string): Element | null {
    let current = element.parent
    while (current && current.node.moduleId !== moduleId) current = current.parent
    return current
  }
  function localDescendants(element: Element, stopAtTabs = false): Element[] {
    return element.children.flatMap(child => [child, ...(stopAtTabs && child.node.moduleId === 'base.tabs' ? [] : localDescendants(child, stopAtTabs))])
  }
  for (const element of all) {
    const { node } = element
    if (node.moduleId === 'base.scroll-rail') {
      const attrs = node.props.htmlAttributes
      const authoredId = attrs && typeof attrs === 'object' ? Reflect.get(attrs, 'id') : undefined
      if (typeof authoredId === 'string' && authoredId && all.filter(candidate => {
        const attributes = candidate.node.props.htmlAttributes
        return attributes && typeof attributes === 'object' && Reflect.get(attributes, 'id') === authoredId
      }).length !== 1) fail(element, 'Authored Scroll rail IDs must be unique; omit the ID for per-instance runtime identities')
    }
    if (node.moduleId === 'base.scroll-controls') {
      const siblings = element.parent?.children ?? roots, position = siblings.indexOf(element)
      if (position < 1 || siblings[position - 1].node.moduleId !== 'base.scroll-rail') fail(element, 'Scroll controls must immediately follow their sibling Scroll rail')
      if (!localDescendants(element).some(child => child.node.moduleId === 'base.scroll-button')) fail(element, 'Scroll controls require at least one Scroll button')
    }
    if (node.moduleId === 'base.scroll-button' && !closest(element, 'base.scroll-controls')) fail(element, 'Scroll buttons must be inside Scroll controls')
    if (node.moduleId === 'base.tab' || node.moduleId === 'base.tab-panel') {
      const owner = closest(element, 'base.tabs')
      if (!owner) fail(element, 'Tabs and Tab panels must belong to a Tabs owner')
      if (node.moduleId === 'base.tab-panel' && element.parent !== owner) fail(element, 'Tab panels must be direct children of their Tabs owner')
    }
    if (node.moduleId === 'base.tabs') {
      const groupId = String(node.props.groupId || '')
      if (groupId && all.filter(candidate => candidate.node.moduleId === 'base.tabs' && candidate.node.props.groupId === groupId).length !== 1) fail(element, 'Named Tabs group IDs must be unique on the rendered page')
      const lists = element.children.filter(child => {
        const attrs = child.node.props.htmlAttributes
        return Boolean(attrs && typeof attrs === 'object' && Reflect.get(attrs, 'role') === 'tablist')
      })
      if (lists.length !== 1) fail(element, 'Tabs require exactly one direct child with role="tablist"')
      const tabs = localDescendants(lists[0], true).filter(child => child.node.moduleId === 'base.tab' && closest(child, 'base.tabs') === element)
      const allTabs = localDescendants(element, true).filter(child => child.node.moduleId === 'base.tab' && closest(child, 'base.tabs') === element)
      const panels = element.children.filter(child => child.node.moduleId === 'base.tab-panel')
      const keys = tabs.map(tab => String(tab.node.props.tabKey || '')).filter(Boolean)
      if (new Set(keys).size !== keys.length) fail(element, 'Named tab keys must be unique within their group')
      if (!tabs.length || tabs.length !== allTabs.length || tabs.length !== panels.length) fail(element, 'The tab list needs one ordered direct panel per Tab, with no tabs outside the list')
      const selected = tabs.flatMap((tab, index) => tab.node.props.initiallySelected === true ? [index] : [])
      if (selected.length !== 1) fail(element, 'Tabs require exactly one initial selection')
      if (panels.some((panel, index) => panel.node.props.initiallyHidden !== (index !== selected[0]))) fail(element, 'Initial panel visibility must match the selected Tab')
    }
    if (node.moduleId === 'base.tab-link') {
      const groupId = String(node.props.groupId || ''), key = String(node.props.tabKey || '')
      const groups = all.filter(candidate => candidate.node.moduleId === 'base.tabs' && candidate.node.props.groupId === groupId)
      if (!groupId || !key || groups.length !== 1) fail(element, 'Tab links require one named target group and tab key')
      const tabs = localDescendants(groups[0], true).filter(candidate => candidate.node.moduleId === 'base.tab' && closest(candidate, 'base.tabs') === groups[0] && candidate.node.props.tabKey === key)
      if (tabs.length !== 1) fail(element, 'Tab link key must identify one tab in the target group')
      if (!/^#[^#]+$/.test(String(node.props.href || ''))) fail(element, 'Tab links require an authored local fragment URL')
      let fragment: string
      try { fragment = decodeURIComponent(String(node.props.href).slice(1)) } catch { fail(element, 'Tab link fragment must have valid URI encoding') }
      const targets = all.filter(candidate => {
        const attributes = candidate.node.props.htmlAttributes
        return candidate.node.props.id === fragment || attributes && typeof attributes === 'object' && Reflect.get(attributes, 'id') === fragment
      })
      if (targets.length !== 1) fail(element, 'Tab link fragment must identify one rendered target')
    }
  }
}

export function assertPageScrollNavigation(page: Page, site: SiteDocument): void {
  const visited = new Set<string>()
  function contains(nodes: Readonly<Record<string, BaseNode>>): boolean {
    return Object.values(nodes).some(node => {
      if (interactive.has(node.moduleId)) return true
      if (node.moduleId !== 'base.visual-component-ref') return false
      const id = String(node.props.componentId)
      if (visited.has(id)) return false
      visited.add(id)
      const definition = site.visualComponents.find(component => component.id === id)
      return definition ? contains(definition.tree.nodes) : false
    })
  }
  if (!contains(page.nodes)) return
  const nodes: Record<string, BaseNode> = {}, roots: string[] = []
  const context = buildTemplateRenderContext(page, site, undefined)
  walkRenderTree(page.nodes, page.rootNodeId, site.visualComponents, (node, frame) => {
    const copy: BaseNode = { ...node, id: frame.id, parentId: frame.parentId, children: [] }
    nodes[copy.id] = copy
    if (frame.parentId) nodes[frame.parentId].children.push(copy.id)
    else roots.push(copy.id)
  }, context)
  assertScrollNavigationForest({ nodes, rootNodeIds: roots }, `pages.${page.id}.nodes`)
}
export function assertSiteScrollNavigation(site: SiteDocument): void {
  for (const scope of publishedRenderScopes(site)) assertPageScrollNavigation(scope.page, site)
}
