/**
 * CanvasComposedTree — render the active document the way it publishes: inside
 * its matching template chain.
 *
 * When the document being edited is wrapped by one or more templates (an
 * `everywhere` layout around a page or a postTypes template), those wrappers
 * render READ-ONLY around the editable document via `ReadOnlyNodeTree`, with the
 * editable document spliced into the innermost wrapper's `base.outlet` — exactly
 * where the publisher would splice it. The wrapper chrome (nav, footer, …) is
 * pixel-identical to the published page but non-interactive; only the active
 * document's own nodes stay fully editable (selection, hover, DnD), so every
 * existing editor subsystem keeps operating on the unchanged active-page tree.
 *
 * Body ownership mirrors the publisher: every template/page body contributes
 * presentation to the one real document body. The outermost body owns the
 * structural identity; attributes and inline styles are merged with the
 * closest inner document winning conflicts, and class IDs are deduplicated.
 *
 * When nothing wraps the document (editing the `everywhere` layout itself, or a
 * site with no matching template), it renders exactly as before — a plain
 * `NodeRenderer` at the document root, whose `base.body` claims the iframe body
 * as usual. Its own outlet, if any, still previews matched content through
 * `OutletEditor`.
 */

import { use, useEffect, type ReactNode } from 'react'
import type { BaseNode, Page } from '@core/page-tree'
import { classNamesForClassIds } from '@core/page-tree'
import { composeDocumentBody, resolveDynamicProps, effectiveNodeBindings } from '@core/templates'
import { useEditorStore } from '@site/store/store'
import { ReadOnlyNodeTree } from '@modules/base/utils/ReadOnlyNodeTree'
import { normalizeHtmlAttributes } from '@core/htmlAttributes'
import { useResponsiveBackgroundStyle } from '@admin/pages/media/hooks/useResponsiveBackgroundStyle'
import { NodeRenderer } from './NodeRenderer'
import { resolveEditorWrapperTemplates } from './canvasComposition'
import { CanvasDocumentContext, CanvasTemplateContext, CanvasNodeTreeContext } from './CanvasContexts'
import { applyIframeBodyPresentation } from './iframeBodyPresentation'

const NO_WRAPPERS: Page[] = []

interface CanvasComposedTreeProps {
  /** The active document being edited (the editable page / template). */
  page: Page
}

export function CanvasComposedTree({ page }: CanvasComposedTreeProps) {
  const site = useEditorStore((s) => s.site)
  const isVcMode = useEditorStore((s) => s.activeDocument?.kind === 'visualComponent')
  const styleRules = useEditorStore((s) => s.site?.styleRules ?? null)
  const templateContext = use(CanvasTemplateContext)

  // Templates wrapping the active document (outermost-first). A Visual
  // Component edit surface is never a published route, so it is never wrapped.
  const wrappers = !isVcMode && site ? resolveEditorWrapperTemplates(site, page) : NO_WRAPPERS

  // No wrapping templates → render the document exactly as before; its own
  // base.body claims the iframe <body>.
  if (wrappers.length === 0) {
    return <CanvasNodeTreeContext.Provider value={page.nodes}><NodeRenderer nodeId={page.rootNodeId} /></CanvasNodeTreeContext.Provider>
  }

  // Editable content = the active document's body children, rendered editable.
  // The active document's base.body is intentionally NOT rendered here — it is
  // dropped just as the publisher drops the inner body when splicing.
  const bodyNode = page.nodes[page.rootNodeId]
  const editableContent = bodyNode
    ? bodyNode.children.map((childId) => <NodeRenderer key={childId} nodeId={childId} />)
    : null

  // Nest the read-only wrappers from innermost outward; each wrapper's outlet
  // hosts the next inner layer, the innermost hosting the editable content.
  let composed: ReactNode = <CanvasNodeTreeContext.Provider value={page.nodes}>{editableContent}</CanvasNodeTreeContext.Provider>
  for (let i = wrappers.length - 1; i >= 0; i--) {
    const wrapper = wrappers[i]
    composed = (
      <ReadOnlyNodeTree
        nodes={wrapper.nodes as Record<string, BaseNode>}
        rootNodeId={wrapper.rootNodeId}
        classes={styleRules}
        outletSlot={composed}
        readonly={{ label: `${wrapper.title} template`, kind: 'page', targetId: wrapper.id }}
        templateContext={templateContext}
      />
    )
  }

  // Merge through the same body composer as publication, without rekeying
  // editable content or introducing an element around template outlets.
  const documentBody = composeDocumentBody([...wrappers.map(wrapper => wrapper.nodes[wrapper.rootNodeId]), bodyNode])
  const bodyClassName = classNamesForClassIds(styleRules, documentBody.classIds).join(' ')
  const bodyProps = resolveDynamicProps(documentBody.props, effectiveNodeBindings(documentBody), templateContext)

  return (
    <>
      <IframeBodyPresentationOwner
        className={bodyClassName}
        inlineStyles={documentBody.inlineStyles}
        htmlAttributes={bodyProps.htmlAttributes}
      />
      {composed}
    </>
  )
}

/**
 * Apply the composed document body's presentation to the host iframe's `<body>` while
 * mounted (and restore it on unmount). The frame supplies its final srcDoc
 * through context, so this owner contributes no editor-only body child. Only
 * used in the wrapped case, where no `base.body` editor runs to own the body.
 */
function IframeBodyPresentationOwner({
  className,
  inlineStyles,
  htmlAttributes,
}: {
  className: string
  inlineStyles?: BaseNode['inlineStyles']
  htmlAttributes?: unknown
}) {
  const iframeDocument = use(CanvasDocumentContext)
  const style = useResponsiveBackgroundStyle(inlineStyles)
  useEffect(() => {
    const body = iframeDocument?.body
    if (!body) return
    return applyIframeBodyPresentation(body, {
      className,
      style,
      attributes: normalizeHtmlAttributes(htmlAttributes),
    })
  }, [className, htmlAttributes, iframeDocument, style])
  return null
}
