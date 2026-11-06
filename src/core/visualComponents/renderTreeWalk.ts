import type { BaseNode, PageNode } from '@core/page-tree-schema'
import { effectiveNodeBindings, resolveDynamicProps, type TemplateRenderDataContext } from '@core/templates'
import type { VisualComponent } from './schemas'
import { instantiateVCAtRef, type InstantiatedVC } from './instantiate'
import { resolveSlotName, safePropOverrides } from './propGuards'

export interface RenderTreeFrame {
  readonly nodes: Readonly<Record<string, BaseNode>>
  readonly ancestors: readonly PageNode[]
  readonly id: string
  readonly parentId: string | null
  readonly componentIds: ReadonlySet<string>
  /** Ancestors in this node map; component expansion starts a new local path. */
  readonly ancestorNodeIds: ReadonlySet<string>
  readonly component?: VisualComponent
  readonly instance?: InstantiatedVC
}

export interface RenderTreeWalkOptions {
  prefix?: string
  parentId?: string | null
  ancestors?: readonly PageNode[]
  componentIds?: ReadonlySet<string>
  ancestorNodeIds?: ReadonlySet<string>
  /** A loop reader pauses here and resumes children with real entry contexts. */
  shouldDescend?: (node: PageNode, frame: RenderTreeFrame) => boolean
}

/** Walk the materialized render tree, including effective VC params and slots. */
export function walkRenderTree(
  nodes: Readonly<Record<string, BaseNode>>,
  rootNodeId: string,
  components: readonly VisualComponent[],
  onNode: (node: PageNode, frame: RenderTreeFrame) => void,
  context?: TemplateRenderDataContext,
  options: RenderTreeWalkOptions = {},
): void {
  const byId = new Map(components.map((component) => [component.id, component]))
  const visit = (
    currentNodes: Readonly<Record<string, BaseNode>>,
    nodeId: string,
    seenComponents: ReadonlySet<string>,
    ancestors: ReadonlySet<string>,
    renderAncestors: readonly PageNode[],
    prefix: string,
    parentId: string | null,
  ): void => {
    const storedNode = currentNodes[nodeId]
    if (!storedNode || storedNode.hidden || ancestors.has(nodeId)) return
    const node = storedNode.moduleId === 'base.visual-component-ref' && context
      ? { ...storedNode, props: resolveDynamicProps(storedNode.props, effectiveNodeBindings(storedNode), context) }
      : storedNode
    const id = prefix + node.id
    const frame: RenderTreeFrame = { nodes: currentNodes, ancestors: renderAncestors, id, parentId, componentIds: seenComponents, ancestorNodeIds: ancestors }
    const nextRenderAncestors = [...renderAncestors, node]
    if (node.moduleId === 'base.visual-component-ref') {
      const componentId = typeof node.props.componentId === 'string' ? node.props.componentId.trim() : ''
      const component = byId.get(componentId)
      if (!component || seenComponents.has(componentId)) { onNode(node, frame); return }
      const slots: Record<string, string[]> = {}
      for (const childId of node.children) {
        const child = currentNodes[childId]
        if (child?.moduleId === 'base.slot-instance') slots[resolveSlotName(child.props)] = child.children
      }
      const tree = instantiateVCAtRef(component, safePropOverrides(node.props), slots, currentNodes, node.id)
      const instanceFrame = { ...frame, component, instance: tree }
      onNode(node, instanceFrame)
      if (options.shouldDescend?.(node, instanceFrame) === false) return
      visit(tree.nodes, tree.rootNodeId, new Set(seenComponents).add(componentId), new Set(), nextRenderAncestors, id + ':', id)
      return
    }
    onNode(node, frame)
    if (options.shouldDescend?.(node, frame) === false) return
    const nextAncestors = new Set(ancestors).add(nodeId)
    for (const childId of node.children) visit(currentNodes, childId, seenComponents, nextAncestors, nextRenderAncestors, prefix, id)
  }
  visit(nodes, rootNodeId, options.componentIds ?? new Set(), options.ancestorNodeIds ?? new Set(),
    options.ancestors ?? [], options.prefix ?? '', options.parentId ?? null)
}
