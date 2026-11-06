import type { Page, SiteDocument } from '@core/page-tree'
import { assertValidNodeTree } from '@core/page-tree'
import { RelationResolutionError } from '@core/data-read'
import type { AuthoringRenderContext } from '@core/render-preview-schema'
import { buildTemplateRenderContext, buildRouteFrame, composeTemplateChain, resolveTemplateChain } from '@core/templates'
import { dataEntryToLoopItem, type SourceRequestContext } from '@core/loops'
import { flattenVCToVirtualPage, parseVirtualVCPageId } from '@core/visualComponents'
import type { DbClient } from '../db/client'
import type { BranchScope } from '../branches/scope'
import type { DataAccessUser } from '../auth/dataAccess'
import { userHasCapability } from '../auth/authz'
import { DataReadSnapshot, readDataRowIdentity, readDataTableIdentities, canReadDataTable } from '../repositories/data'
import { captureDataReadGeneration } from '../repositories/data/generation'
import { getLatestPublishedSiteSnapshot } from '../repositories/publishedSnapshot'
import { registerPublicFilePreview } from './publicFilePreview'
import { prefetchLoopReadView } from './loopPrefetch'

export interface AuthoringReadViewOptions {
  generation?: string
  url?: URL
  request?: SourceRequestContext
  mode?: 'render' | 'targets'
}

/** The native tree validator is strict here; an invalid preview is never repaired. */
function assertPreviewTrees(site: SiteDocument): void {
  for (const page of site.pages) assertValidNodeTree(page, `site.pages.${page.id}`)
  for (const component of site.visualComponents) assertValidNodeTree(component.tree, `site.visualComponents.${component.id}.tree`)
  for (const layout of site.layouts) assertValidNodeTree(layout, `site.layouts.${layout.id}`)
}

function previewPage(site: SiteDocument, pageId: string): Page {
  const page = site.pages.find(candidate => candidate.id === pageId)
  if (page) return page
  const componentId = parseVirtualVCPageId(pageId)
  const component = componentId && site.visualComponents.find(candidate => candidate.id === componentId)
  if (component) return flattenVCToVirtualPage(component)
  throw new RelationResolutionError('pageId', 'relation_unavailable', 'The requested preview page is unavailable')
}

/**
 * Both initial authoring documents and continuations admit real rows through
 * one snapshot. The input selects content; the authenticated principal owns
 * all table, row, catalogue and relation authority.
 */
export async function readAuthoringRenderView(
  db: DbClient, scope: BranchScope, principal: DataAccessUser,
  context: AuthoringRenderContext, options: AuthoringReadViewOptions = {},
) {
  const generation = options.generation ?? await captureDataReadGeneration(db, scope, 'draft')
  let site: SiteDocument
  let sourcePage: Page
  let page: Page
  let entryLocator: { tableId: string; rowId: string } | undefined
  if (context.kind === 'page') {
    if (!userHasCapability(principal, 'site.read')) throw new RelationResolutionError('preview', 'relation_unavailable', 'The requested preview is unavailable')
    site = structuredClone(context.site)
    assertPreviewTrees(site)
    sourcePage = previewPage(site, context.pageId)
    // Runtime preview renders the authored canvas page, including a virtual
    // component page, rather than implicitly adding another template wrapper.
    page = sourcePage
    entryLocator = context.entry
  } else {
    const identity = await readDataRowIdentity(db, scope, context.rowId)
    if (!identity) throw new RelationResolutionError('rowId', 'relation_unavailable', 'The requested entry is unavailable')
    const published = await getLatestPublishedSiteSnapshot(db)
    if (!published) throw new RelationResolutionError('preview', 'uncertified_read_plan', 'Publish a site template before previewing an entry')
    site = published.site
    // Resolve only schema-free identity before constructing the one read view.
    const [table] = await readDataTableIdentities(db, scope, [identity.tableId])
    if (!table || !canReadDataTable({ kind: 'user', principal }, table)) throw new RelationResolutionError('entry', 'relation_unavailable', 'The requested preview entry is unavailable')
    const chain = resolveTemplateChain(site, { kind: 'entry', tableSlug: table.slug })
    if (!chain.length) throw new RelationResolutionError('template', 'relation_unavailable', 'The collection has no entry preview template')
    sourcePage = chain[chain.length - 1]!
    page = composeTemplateChain(chain, { kind: 'entry' })
    entryLocator = { tableId: table.id, rowId: identity.rowId }
  }
  const framePage = context.language ? { ...sourcePage, language: context.language } : sourcePage
  const route = options.url ? buildRouteFrame(options.url.toString()) : undefined
  const native = buildTemplateRenderContext(framePage, site, { entryStack: [], ...(route ? { route } : {}) })
  const dataSnapshot = await DataReadSnapshot.create(db, scope, 'draft', { kind: 'user', principal }, {
    generation, language: native.site?.language, localizationSite: site,
  })
  let entry
  if (entryLocator) {
    const table = await dataSnapshot.table(entryLocator.tableId)
    if (context.kind === 'entry' && context.cells) entry = await dataSnapshot.previewDraftCells(table.id, entryLocator.rowId, context.cells)
    else {
      const record = (await dataSnapshot.records(table.id, [entryLocator.rowId]))[0]
      if (!record) throw new RelationResolutionError('entry', 'relation_unavailable', 'The requested preview entry is unavailable')
      entry = (await dataSnapshot.project(table, [record]))[0]
    }
    if (context.kind === 'entry') page = { ...page, title: entry.title }
  }
  const expectedPath = context.kind === 'entry' ? entry?.url : native.page!.permalink
  if (!expectedPath) throw new RelationResolutionError('preview', 'relation_unavailable', 'The preview has no native entry route')
  const url = options.url ?? new URL(expectedPath, 'http://localhost')
  if (url.pathname !== new URL(expectedPath, url.origin).pathname) throw new RelationResolutionError('pagePath', 'invalid_collection_query', 'The originating path does not match this preview')
  const templateContext = buildTemplateRenderContext(framePage, site, {
    ...native, entryStack: entry ? [dataEntryToLoopItem(entry)] : [],
    route: buildRouteFrame(url.toString()),
    ...(context.kind === 'entry' && entry ? { page: { ...native.page!, title: entry.title } } : {}),
    // Only a Site-authorized preview can create private unsaved file URLs.
    ...(context.kind === 'page' ? { files: registerPublicFilePreview(principal.id, site.files) } : {}),
  })
  const readView = await prefetchLoopReadView(page, site, dataSnapshot, url, {
    templateContext, request: options.request, mode: options.mode,
  })
  return { site, page, scriptPage: sourcePage, templateContext, dataSnapshot, readView, entry, url }
}
