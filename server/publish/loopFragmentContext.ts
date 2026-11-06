import type { DbClient } from '../db/client'
import { reindexNodeParents } from '@core/page-tree'
import { resolveNotFoundTemplate } from '@core/templates'
import type { SourceRequestContext } from '@core/loops'
import { resolveDataRenderTarget } from '../repositories/data'
import { assertDataReadGeneration } from '../repositories/data/generation'
import { MAIN_SCOPE } from '../branches/scope'
import { resolvePublicRoute, resolvePublishedNotFoundRoute } from './publicRouteResolution'
import { readPublishedPageRenderView, readPublishedEntryRenderView } from './publishedReadView'

export class LoopFragmentContextError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message)
    this.name = 'LoopFragmentContextError'
  }
}

/** Require the actual local public URL, never an arbitrary consumer selected by node ID. */
export function readLoopPageUrl(pagePath: string, endpointUrl: URL): URL {
  if (!pagePath.startsWith('/') || pagePath.startsWith('//')) throw new LoopFragmentContextError('The originating page URL must be a local absolute path', 400)
  let pageUrl: URL
  try { pageUrl = new URL(pagePath, endpointUrl.origin) }
  catch (cause) { throw new LoopFragmentContextError(`Invalid originating page URL: ${cause instanceof Error ? cause.message : 'invalid URL'}`, 400) }
  if (pageUrl.origin !== endpointUrl.origin || pageUrl.hash) throw new LoopFragmentContextError('Invalid originating page URL', 400)
  try { decodeURIComponent(pageUrl.pathname) }
  catch { throw new LoopFragmentContextError('Invalid originating page URL', 400) }
  return pageUrl
}

/** Full HTML, holes and continuation resolve one certified origin route and actual entry view. */
export async function resolvePublishedFragmentContext(
  db: DbClient, pageUrl: URL, nodeId: string,
  options: { generation: string; locator: string; request?: SourceRequestContext },
) {
  await assertDataReadGeneration(db, MAIN_SCOPE, 'public', options.generation)
  const resolution = await resolvePublicRoute(db, pageUrl)
  if (resolution.kind === 'redirect') throw new LoopFragmentContextError('The originating page has moved', 409)
  const readOptions = { generation: options.generation, url: pageUrl, request: options.request, mode: 'targets' as const }
  let published
  let context
  if (resolution.kind === 'not-found') {
    published = await resolvePublishedNotFoundRoute(db)
    const sourcePage = published && resolveNotFoundTemplate(published.site)
    if (!published || !sourcePage) throw new LoopFragmentContextError('Published page not found', 404)
    // Preserve the actual missing URL/query; the 404 artefact path is storage, not a route frame.
    context = await readPublishedPageRenderView(db, published, sourcePage, readOptions)
  } else {
    published = resolution.snapshot
    if (resolution.kind === 'row') context = await readPublishedEntryRenderView(db, published, resolution.row, readOptions)
    else {
      const sourcePage = published.site.pages.find(candidate => candidate.id === published.pageRowId)
      if (!sourcePage) throw new LoopFragmentContextError('Published page not found', 404)
      context = await readPublishedPageRenderView(db, published, sourcePage, readOptions)
    }
    if (!context) throw new LoopFragmentContextError('Published entry template not found', 404)
  }
  const target = resolveDataRenderTarget(context.readView, options.locator, nodeId)
  const nodes = structuredClone(target.frame.nodes)
  reindexNodeParents(nodes)
  const page = { ...context.page, nodes, rootNodeId: target.node.id }
  return {
    ...target, page, site: published.site, published, pageUrl,
    dataSnapshot: context.dataSnapshot, readView: context.readView,
    walk: {
      prefix: target.renderTreePrefix, parentId: target.frame.parentId,
      ancestors: target.frame.ancestors, componentIds: target.frame.componentIds,
      ancestorNodeIds: target.frame.ancestorNodeIds,
    },
  }
}
