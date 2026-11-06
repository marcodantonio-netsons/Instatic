import type { Page, PageNode, SiteDocument } from '@core/page-tree'
import type { TemplateRenderDataContext } from '@core/templates'
import type { RenderTreeFrame } from '@core/visualComponents'
import { loopReadKey } from '@core/loops'
import { RelationResolutionError, RelationValidationError } from '@core/data-read'
import { readDataRenderTree, type DataRenderReadOptions } from './renderRead'
import type { DataReadSnapshot } from './snapshot'

export interface DataRenderTarget {
  node: PageNode
  frame: RenderTreeFrame
  templateContext: TemplateRenderDataContext
  renderTreePrefix: string
}

/** The fragment locator indexes the exact same materialized view as full rendering. */
export async function readDataRenderView(
  snapshot: DataReadSnapshot, page: Page, site: SiteDocument, options: DataRenderReadOptions,
) {
  const targets = new Map<string, DataRenderTarget>()
  const loopData = await readDataRenderTree(snapshot, page, site, {
    ...options,
    onNode(node, frame, templateContext) {
      const locator = loopReadKey(frame.id, templateContext.entryStack)
      targets.set(locator, { node, frame, templateContext, renderTreePrefix: frame.id.slice(0, -node.id.length) })
      options.onNode?.(node, frame, templateContext)
    },
  })
  return { loopData, targets, generation: snapshot.generation }
}

/** The visitor supplies a locator, never authority or a independently loaded row frame. */
export function resolveDataRenderTarget(
  view: Awaited<ReturnType<typeof readDataRenderView>>, locator: string, nodeId: string,
): DataRenderTarget {
  if (!locator || locator.length > 16_384 || !nodeId) throw new RelationValidationError('locator', 'invalid_collection_query', 'A fragment requires its originating render locator')
  const target = view.targets.get(locator)
  if (!target || target.node.id !== nodeId) throw new RelationResolutionError('locator', 'relation_unavailable', 'The requested fragment is unavailable on this published route')
  return target
}
