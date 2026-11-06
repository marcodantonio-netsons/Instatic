import type { Page } from '@core/page-tree'
import type { DataRowRouteIdentity } from '@core/data-read'
import { RelationResolutionError } from '@core/data-read'
import { buildTemplateRenderContext, composeTemplateChain, resolveTemplateChain, publishedRenderScopes } from '@core/templates'
import type { SourceRequestContext } from '@core/loops'
import type { DbClient } from '../db/client'
import { MAIN_SCOPE } from '../branches/scope'
import { DataReadSnapshot } from '../repositories/data'
import type { PublishedPageSnapshot } from '../repositories/publishedSnapshot'
import { buildPublishedPageRenderContext, buildPublishedEntryRenderContext } from './publishedRenderContext'
import { prefetchLoopReadView } from './loopPrefetch'

export interface PublishedReadViewOptions {
  generation: string
  url?: URL
  request?: SourceRequestContext
  /** Fragment lookup includes only future pages of the exact originating query. */
  mode?: 'render' | 'targets'
}

async function publicReadSnapshot(
  db: DbClient, snapshot: PublishedPageSnapshot, scopeId: string, page: Page, options: PublishedReadViewOptions,
) {
  if (!snapshot.dataReadPlan) throw new RelationResolutionError('dataReadPlan', 'uncertified_read_plan', 'This published content has no certified data read plan')
  const context = buildTemplateRenderContext(page, snapshot.site, { entryStack: [] })
  return DataReadSnapshot.create(db, MAIN_SCOPE, 'public', { kind: 'public', plan: snapshot.dataReadPlan, scopeId }, {
    generation: options.generation, language: context.site?.language, localizationSite: snapshot.site,
  })
}

/** Terminal source-page frames and the certified scope come from the same native composition. */
export async function readPublishedPageRenderView(
  db: DbClient, snapshot: PublishedPageSnapshot, sourcePage: Page, options: PublishedReadViewOptions,
) {
  const scope = [...publishedRenderScopes(snapshot.site)].find(candidate => candidate.kind !== 'entry' && candidate.sourcePage.id === sourcePage.id)
  if (!scope || scope.kind === 'entry') throw new RelationResolutionError('page', 'relation_unavailable', 'The public page render scope is unavailable')
  const dataSnapshot = await publicReadSnapshot(db, snapshot, `${scope.kind}:${sourcePage.id}`, sourcePage, options)
  const context = buildPublishedPageRenderContext(snapshot, sourcePage, options.url)
  const readView = await prefetchLoopReadView(context.page, snapshot.site, dataSnapshot, options.url, {
    templateContext: context.templateContext, request: options.request, mode: options.mode,
  })
  return { ...context, readView, dataSnapshot }
}

/** The identity lookup conveys no payload authority; one certified read produces the real entry. */
export async function readPublishedEntryRenderView(
  db: DbClient, snapshot: PublishedPageSnapshot, identity: DataRowRouteIdentity, options: PublishedReadViewOptions,
) {
  const chain = resolveTemplateChain(snapshot.site, { kind: 'entry', tableSlug: identity.tableSlug })
  if (!chain.length) return null
  const page = composeTemplateChain(chain, { kind: 'entry' })
  const dataSnapshot = await publicReadSnapshot(db, snapshot, `entry:${identity.tableSlug}`, page, options)
  const table = await dataSnapshot.table(identity.tableId)
  const record = (await dataSnapshot.records(table.id, [identity.rowId]))[0]
  if (!record || table.slug !== identity.tableSlug || record.row.slug !== identity.slug ||
    record.version?.id !== identity.version?.id || record.version?.number !== identity.version?.number) {
    throw new RelationResolutionError('entry', 'relation_unavailable', 'The published entry view is unavailable')
  }
  const entry = (await dataSnapshot.project(table, [record]))[0]
  const context = buildPublishedEntryRenderContext(snapshot, entry, options.url)
  if (!context) return null
  const readView = await prefetchLoopReadView(context.page, snapshot.site, dataSnapshot, options.url, {
    templateContext: context.templateContext, request: options.request, mode: options.mode,
  })
  return { ...context, entry, readView, dataSnapshot }
}
