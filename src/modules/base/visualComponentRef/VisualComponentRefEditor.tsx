/**
 * base.visual-component-ref editor preview component.
 *
 * Component-only file so React Fast Refresh can hot-patch edits without
 * re-running module registration.
 *
 * Class application:
 * - The page-level ref node's own classIds arrive here via `mcClassName`
 *   (resolved by NodeRenderer). We forward that string as `rootMcClassName`
 *   to VCInlineTree so it lands on the VC's root element — same contract as
 *   the publisher's `injectClassIntoRootElement`.
 * - The site's `classes` registry is also forwarded so VCInlineTree can
 *   resolve each inlined VC node's classIds → class names.
 *
 * Slot content lives in the active page tree as `base.slot-instance` children
 * of this VC ref node (Task 4 Tree Unification). We look up those nodes in
 * the active canvas tree and build `slotInstancesByName` (slotName → child IDs)
 * to pass to `instantiateVCAtRef`.
 */
import React from 'react'
import type { ModuleComponentProps } from '@core/module-engine'
import { useEditorStore } from '@site/store/store'
import { instantiateVCAtRef, inspectVCRequiredParameters, resolveSlotName, safePropOverrides } from '@core/visualComponents'
import { CanvasNodeTreeContext, CanvasTemplateContext } from '@site/canvas/CanvasContexts'
import { BracesIcon } from 'pixel-art-icons/icons/braces'
import { CanvasModulePlaceholder } from '@ui/components/CanvasModulePlaceholder'
import { VCInlineTree } from './VCInlineTree'
import type { VisualComponentRefStoredProps } from './props'

export const VisualComponentRefEditor: React.FC<ModuleComponentProps<VisualComponentRefStoredProps>> = ({
  props,
  nodeId,
  mcClassName,
  nodeWrapperProps,
}) => {
  const componentId = typeof props.componentId === 'string' ? props.componentId : ''
  const propOverrides = safePropOverrides(props)
  const pageNodes = React.use(CanvasNodeTreeContext)
  const templateContext = React.use(CanvasTemplateContext)

  const vc = useEditorStore(
    (s) => s.site?.visualComponents?.find((v) => v.id === componentId) ?? null,
  )

  // Class registry — VCInlineTree resolves each inlined node's classIds against this.
  // Subscribing to the registry object keeps the rendered VC ref reactive to class
  // edits made elsewhere in the editor.
  const classes = useEditorStore((s) => s.site?.styleRules ?? null)

  if (!vc || !pageNodes) {
    return (
      <CanvasModulePlaceholder
        {...nodeWrapperProps}
        className={mcClassName}
        variant="inline"
        icon={<BracesIcon size={12} color="currentColor" />}
        label={!pageNodes ? 'Component preview has no render tree' : componentId ? `Unknown component: ${componentId}` : 'No component selected'}
      />
    )
  }

  // Build slotInstancesByName from the VC ref node's base.slot-instance children
  // in the active canvas tree. This replaces the old slotContent prop approach.
  const vcRefNode = pageNodes[nodeId]
  const slotInstancesByName: Record<string, string[]> = {}
  if (vcRefNode) {
    for (const childId of vcRefNode.children) {
      const child = pageNodes[childId]
      if (child?.moduleId === 'base.slot-instance') {
        slotInstancesByName[resolveSlotName(child.props)] = child.children
      }
    }
  }

  const instance = instantiateVCAtRef(vc, propOverrides, slotInstancesByName, pageNodes, nodeId)
  const issues = inspectVCRequiredParameters(vc, instance, nodeId, templateContext, vcRefNode?.dynamicBindings?.propOverrides)
  const issue = issues.find((candidate) => candidate.reason !== 'unresolved') ?? issues[0]
  if (issue) {
    return (
      <CanvasModulePlaceholder
        {...nodeWrapperProps}
        className={mcClassName}
        variant="inline"
        icon={<BracesIcon size={12} color="currentColor" />}
        label={issue.reason === 'unresolved' ? `Preview waiting for ${issue.parameterName}` : issue.message}
        role={issue.reason === 'unresolved' ? 'status' : 'alert'}
        data-component-parameter={issue.parameterId}
        data-component-parameter-state={issue.reason}
      />
    )
  }
  const { nodes, rootNodeId } = instance

  return (
    <VCInlineTree
      nodes={nodes}
      rootNodeId={rootNodeId}
      classes={classes}
      rootMcClassName={mcClassName}
      rootNodeWrapperProps={nodeWrapperProps}
      readonly={{ label: `${vc.name} component`, kind: 'component', targetId: vc.id }}
    />
  )
}
