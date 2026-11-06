import { buildTemplateRenderContext } from '@core/templates'
/**
 * Branch preview rendering — the public site as a branch's DRAFT would show
 * it, for visitors carrying a valid preview cookie.
 *
 * Mirrors the editor's own runtime preview rather than the publish path: the
 * page (or entry template) is composed from the branch's draft rows, loops
 * read the branch, runtime scripts are bundled on demand and served from
 * memory, CSS is inlined, and no publish hook fires. Nothing here touches
 * the published snapshots, the render caches, or the disk slots — a preview
 * is a render, never a publish.
 *
 * Every response is `no-store` and `noindex`, and carries a banner naming
 * the branch with an exit link.
 */
import '../../src/modules/base'
import '@core/loops/sources'
import { createHash } from 'node:crypto'
import { registry } from '@core/module-engine'
import { escapeHtml } from '@core/html-sanitize'
import { publishPage, type DocumentMetaOverride, type PublishedRuntimePackageImportmap } from '@core/publisher'
import {
  buildRouteFrame,
  composeTemplateChain,
  isTemplatePage,
  normalizeRouteBase,
  resolveTemplateChain,
  type TemplateRenderDataContext,
} from '@core/templates'
import type { SourceRequestContext } from '@core/loops/types'
import { normalizeSiteRuntimeConfig } from '@core/site-runtime'
import { readEntrySeoOverride } from '@core/data/cells'
import type { Page, SiteDocument } from '@core/page-tree'
import { canonicalJson } from '@core/utils/canonicalJson'
import type { DbClient } from '../db/client'
import type { BranchScope } from '../branches/scope'
import { BRANCH_PREVIEW_EXIT_PATH } from '../branches/previewLinks'
import { getBranch } from '../repositories/branches'
import { DataReadSnapshot, readDataTableIdentityByRouteBase, canReadDataTable } from '../repositories/data'
import { captureDataReadGeneration } from '../repositories/data/generation'
import { findUserById } from '../repositories/users'
import type { BranchPreview } from '../repositories/branchPreviews'
import { userHasCapability } from '../auth/authz'
import { dataEntryToLoopItem } from '@core/loops'
import { jsonResponse } from '../http'
import { getDraftSiteDocument } from '../repositories/publish'
import { buildPublishedSiteModuleJsMap } from './moduleJsBundle'
import { applyPublishedHtmlPipeline } from './publishedHtmlPipeline'
import { prefetchLoopReadView } from './loopPrefetch'
import { prefetchMediaAssets } from './mediaPrefetch'
import { contentRouteFromPath, publicSlugFromPath } from './publicRouter'
import { buildSiteRuntimeScripts } from './runtime/bundleScripts'
import { ensureRuntimeDependencyCache } from './runtime/dependencyCache'
import { buildRuntimePackageImportmap, serializeImportmapForCsp } from './runtime/packageImportmap'
import { hasPreviewBuild, previewAssetBasePath, rememberPreviewBuild } from './branchPreviewAssets'

interface ResolvedPreview {
  merged: Page
  /** The page whose scripts run — the routed page, or the entry template. */
  scriptPage: Page
  templateContext: TemplateRenderDataContext
  /** An entry's SEO title and description; they reach the head only. */
  documentMeta?: DocumentMetaOverride
}

async function resolvePreview(
  snapshot: DataReadSnapshot,
  site: SiteDocument,
  url: URL,
): Promise<ResolvedPreview | null> {
  const slug = publicSlugFromPath(url.pathname)
  const page = site.pages.find((candidate) => candidate.slug === slug && !isTemplatePage(candidate))
  if (page) {
    const chain = resolveTemplateChain(site, { kind: 'page' })
    return {
      merged: composeTemplateChain(chain, { kind: 'page', page }),
      scriptPage: page,
      templateContext: buildTemplateRenderContext(page, site, { entryStack: [], route: buildRouteFrame(url.toString()) }),
    }
  }

  const route = contentRouteFromPath(url.pathname)
  if (!route) return null
  const routeBase = normalizeRouteBase(route.tableRouteBase)
  const identity = await readDataTableIdentityByRouteBase(snapshot.db, snapshot.scope, routeBase)
  if (!identity || !canReadDataTable(snapshot.authority, identity)) return null
  const table = await snapshot.table(identity.id)
  const record = await snapshot.recordBySlug(table, route.rowSlug)
  if (!record) return null
  const entry = (await snapshot.project(table, [record]))[0]

  const chain = resolveTemplateChain(site, { kind: 'entry', tableSlug: table.slug })
  if (chain.length === 0) return null
  const merged = composeTemplateChain(chain, { kind: 'entry' })
  merged.title = entry.title
  const templateContext = buildTemplateRenderContext(merged, site, { entryStack: [], route: buildRouteFrame(url.toString()) })
  return {
    merged,
    scriptPage: chain[chain.length - 1] ?? merged,
    templateContext: { ...templateContext, entryStack: [dataEntryToLoopItem(entry)] },
    documentMeta: readEntrySeoOverride(entry.cells),
  }
}

/**
 * Bundle the page's runtime scripts, reusing a build whose inputs are
 * unchanged. The build id hashes the site runtime config plus the page, so
 * editing a script on the branch mints a new build on the next view.
 */
async function buildPreviewRuntime(site: SiteDocument, page: Page) {
  const runtime = normalizeSiteRuntimeConfig(site.runtime)
  const dependencyCache = Object.keys(runtime.dependencyLock.packages).length > 0
    ? await ensureRuntimeDependencyCache(runtime.dependencyLock)
    : undefined
  const buildId = createHash('sha256')
    .update(canonicalJson({ runtime: site.runtime, page, lock: dependencyCache?.hash ?? null }))
    .digest('hex')
    .slice(0, 24)
  const assetBasePath = previewAssetBasePath(buildId)
  const build = await buildSiteRuntimeScripts({
    site,
    page,
    target: 'publish',
    assetBasePath,
    dependencyCache,
  })
  if (!hasPreviewBuild(buildId)) rememberPreviewBuild(buildId, build.files)

  let runtimePackageImportmap: PublishedRuntimePackageImportmap | undefined
  if (dependencyCache) {
    const built = await buildRuntimePackageImportmap(runtime.dependencyLock, dependencyCache)
    if (built) {
      const serialized = await serializeImportmapForCsp(built.importmap)
      runtimePackageImportmap = { body: serialized.body, sha256: serialized.sha256 }
    }
  }
  return { runtimeAssets: build.runtimeAssets, runtimePackageImportmap }
}

function previewBanner(branchName: string): string {
  return (
    `<div id="instatic-branch-preview" role="status" ` +
    `style="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;align-items:center;` +
    `justify-content:center;gap:12px;padding:10px 16px;background:#111;color:#fff;` +
    `font:600 13px/1.4 system-ui,sans-serif">` +
    `<span>Previewing branch <strong>${escapeHtml(branchName)}</strong> — not live</span>` +
    `<a href="${BRANCH_PREVIEW_EXIT_PATH}" style="color:#9ecbff">Exit preview</a>` +
    `</div>`
  )
}

/**
 * Render `url` from the branch's draft, or null when the branch has nothing
 * at that path (the dispatcher then serves the 404 page).
 */
export async function renderBranchPreview(
  db: DbClient,
  grant: BranchPreview,
  url: URL,
): Promise<Response | null> {
  const scope: BranchScope = { branchId: grant.branchId }
  const generation = await captureDataReadGeneration(db, scope, 'draft')
  if (!grant.createdByUserId) return jsonResponse({ error: 'This preview link has no attributed author; request a new link' }, { status: 409 })
  const issuer = await findUserById(db, grant.createdByUserId)
  if (!issuer || issuer.status !== 'active' || !userHasCapability(issuer, 'site.read')) return jsonResponse({ error: 'This preview link is no longer authorized; request a new link' }, { status: 403 })
  const [branch, site] = await Promise.all([getBranch(db, grant.branchId), getDraftSiteDocument(db, scope)])
  if (!branch || !site) return null
  // Resolve the native route language before data projection; table admission
  // is still performed by the actual issuer's snapshot below.
  const route = contentRouteFromPath(url.pathname)
  const terminalPage = site.pages.find(page => page.slug === publicSlugFromPath(url.pathname) && !isTemplatePage(page))
  const routeTable = route && !terminalPage ? await readDataTableIdentityByRouteBase(db, scope, normalizeRouteBase(route.tableRouteBase)) : null
  if (routeTable && !canReadDataTable({ kind: 'user', principal: issuer }, routeTable)) return null
  const entryChain = routeTable ? resolveTemplateChain(site, { kind: 'entry', tableSlug: routeTable.slug }) : []
  const framePage = terminalPage ?? (entryChain.length ? composeTemplateChain(entryChain, { kind: 'entry' }) : undefined)
  if (!framePage) return null
  const frame = buildTemplateRenderContext(framePage, site, { entryStack: [] })
  const dataSnapshot = await DataReadSnapshot.create(db, scope, 'draft', { kind: 'user', principal: issuer }, {
    generation, language: frame.site?.language, localizationSite: site,
  })
  const resolved = await resolvePreview(dataSnapshot, site, url)
  if (!resolved) return null

  const { merged, scriptPage, templateContext, documentMeta } = resolved
  const { runtimeAssets, runtimePackageImportmap } = await buildPreviewRuntime(site, scriptPage)
  // A preview is one uncached render with the request in hand, so
  // request-dependent nodes resolve inline instead of becoming holes that
  // the hole endpoint would hydrate from main's published data.
  const segments = url.pathname.split('/').filter(Boolean)
  const request: SourceRequestContext = {
    query: Object.fromEntries(url.searchParams),
    path: url.pathname,
    slug: segments.length > 0 ? decodeURIComponent(segments[segments.length - 1]!) : null,
    cookies: {},
  }
  const readView = await prefetchLoopReadView(merged, site, dataSnapshot, url, { request, templateContext })
  const loopData = readView.loopData
  const mediaAssets = await prefetchMediaAssets(merged, site, registry, db, { templateContext, loopData })
  const rendered = publishPage(merged, site, registry, {
    visitorPreferencesStorage: 'memory',
    templateContext,
    ...(documentMeta ? { documentMeta } : {}),
    runtimeAssets,
    runtimePackageImportmap,
    loopData,
    mediaAssets,
    dynamicNodes: 'inline',
    generation,
  })
  // The same pipeline as a published page (plugin frontend assets, form
  // tokens, module scripts, the `publish.*` hooks), so a form or a plugin's
  // client script works on the preview too. The banner goes in last, past
  // the filters.
  const moduleJsMap = buildPublishedSiteModuleJsMap(site, registry)
  const finalHtml = await applyPublishedHtmlPipeline(
    {
      html: rendered.html,
      pageId: merged.id,
      slug: merged.slug,
      siteId: site.id,
      jsModuleIds: rendered.jsModuleIds.filter((id) => moduleJsMap.has(id)),
      generation,
    },
    db,
  )
  await dataSnapshot.assertFresh()
  const banner = previewBanner(branch.name)
  // A function replacement: a `$` in the branch name must not be read as a
  // replacement pattern.
  const html = finalHtml.includes('</body>')
    ? finalHtml.replace('</body>', () => `${banner}</body>`)
    : `${finalHtml}${banner}`

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  })
}
