import type { Page } from '@core/page-tree'
import type { MaterializedDataEntry } from '@core/data-read'
import {
  buildTemplateRenderContext,
  composeTemplateChain,
  resolveTemplateChain,
  type TemplateRenderDataContext,
  buildRouteFrame,
} from '@core/templates'
import type { PublishedPageSnapshot } from '../repositories/publishedSnapshot'
import { dataEntryToLoopItem } from '@core/loops'

export interface PublishedRenderContext {
  page: Page
  templateContext: TemplateRenderDataContext
}

/** Full pages and fragments share the same composed tree and authoritative frames. */
export function buildPublishedPageRenderContext(
  snapshot: PublishedPageSnapshot,
  page: Page,
  url?: URL,
): PublishedRenderContext {
  const chain = resolveTemplateChain(snapshot.site, { kind: 'page' })
  const merged = composeTemplateChain(chain, { kind: 'page', page })
  return {
    page: merged,
    templateContext: buildTemplateRenderContext(page, snapshot.site, {
      entryStack: [],
      ...(url ? { route: buildRouteFrame(url.toString()) } : {}),
    }),
  }
}

/** A certified projection seeds the actual native row before any loop iteration. */
export function buildPublishedEntryRenderContext(
  snapshot: PublishedPageSnapshot,
  entry: MaterializedDataEntry,
  url?: URL,
): PublishedRenderContext | null {
  const chain = resolveTemplateChain(snapshot.site, { kind: 'entry', tableSlug: entry.tableSlug })
  if (chain.length === 0) return null
  const page = { ...composeTemplateChain(chain, { kind: 'entry' }), title: entry.title }
  return { page, templateContext: buildTemplateRenderContext(page, snapshot.site, {
    entryStack: [dataEntryToLoopItem(entry)], ...(url ? { route: buildRouteFrame(url.toString()) } : {}),
  }) }
}
