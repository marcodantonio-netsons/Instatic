/**
 * Published module-JS channel — server-side builder + injector.
 *
 * `ModuleDefinition.assets.js` declares an invariant type payload. Real
 * render output activates it through `assetUsage`; the publisher dedupes
 * active payloads per moduleId into `RenderAccumulators.jsMap`. This file
 * owns the site-wide map, shared asset paths and page-level script injection.
 * Full publication writes this map into the prepared static generation:
 *
 * - `buildSiteModuleJsMap` rebuilds the map from scratch (preview, tests).
 * - `buildPublishedSiteModuleJsMap` memoises it by publishVersion + site
 *   object — the same pattern (and the same invalidation via
 *   `bumpPublishVersion()` / `registerVersionedCacheReset`) as
 *   `buildPublishedSiteCssBundle` in `siteCssBundle.ts`.
 * - `injectModuleScripts` is the post-render pipeline step: appends one
 *   `<script src="/_instatic/module-js/<id>.js?v=<version>" defer>` tag per
 *   moduleId (sorted for determinism) before `</body>` and relaxes the page
 *   CSP `script-src` to `'self'` iff at least one tag was injected.
 *
 * The matching asset route lives in `server/handlers/cms/moduleJs.ts`.
 */
import type { SiteDocument } from '@core/page-tree'
import type { IModuleRegistry } from '@core/module-engine'
import { addCspSources, escapeHtml, rewriteCspMeta } from '@core/publisher'
import { collectSiteModuleAssets } from './siteModuleAssets'
import { getPublishVersion, registerVersionedCacheReset } from './publishState'

export const MODULE_JS_PATH_PREFIX = '/_instatic/module-js/'
const MODULE_JS_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/

/** One path contract for staged files, document references and the public route. */
export function moduleJsAssetPath(moduleId: string): string {
  if (!MODULE_JS_ID_PATTERN.test(moduleId)) throw new Error(`Invalid module-JS module ID: ${moduleId}`)
  return `${MODULE_JS_PATH_PREFIX}${encodeURIComponent(moduleId)}.js`
}

/** Validate the untrusted path before filesystem or published-site access. */
export function moduleJsIdFromAssetPath(pathname: string): string | null {
  if (!pathname.startsWith(MODULE_JS_PATH_PREFIX)) return null
  let filename: string
  try {
    filename = decodeURIComponent(pathname.slice(MODULE_JS_PATH_PREFIX.length))
  } catch (error) {
    if (error instanceof URIError) return null
    throw error
  }
  const moduleId = filename.endsWith('.js') ? filename.slice(0, -3) : ''
  return MODULE_JS_ID_PATTERN.test(moduleId) ? moduleId : null
}

/** Build the moduleId → JS map fresh. Use for draft/preview/arbitrary sites. */
export function buildSiteModuleJsMap(
  site: SiteDocument,
  registry: IModuleRegistry,
): ReadonlyMap<string, string> {
  return collectSiteModuleAssets(site, registry).jsMap
}

// Memo keyed by publish version + site object, mirroring the page-invariant
// CSS bundle memo. A bump invalidates it; the shared test-reset hook clears it.
let moduleJsCache: {
  version: number
  site: SiteDocument
  map: ReadonlyMap<string, string>
} | null = null
registerVersionedCacheReset(() => {
  moduleJsCache = null
})

/**
 * Published-render variant: memoised per publishVersion + site object so the
 * O(all-pages) walk runs once per published snapshot, not once per render.
 * Safe ONLY for the published-snapshot render path (same caveat as
 * `buildPublishedSiteCssBundle`).
 */
export function buildPublishedSiteModuleJsMap(
  site: SiteDocument,
  registry: IModuleRegistry,
): ReadonlyMap<string, string> {
  const version = getPublishVersion()
  if (moduleJsCache && moduleJsCache.version === version && moduleJsCache.site === site) {
    return moduleJsCache.map
  }
  const map = buildSiteModuleJsMap(site, registry)
  moduleJsCache = { version, site, map }
  return map
}

/**
 * Append the page's module-JS `<script>` tags before `</body>` and relax the
 * CSP `script-src` to `'self'` iff at least one tag was injected.
 *
 * `jsModuleIds` must already be intersected with the site module-JS map (the
 * renderer does this — see `publicRenderer.ts`), so every emitted URL is
 * guaranteed to resolve. Sorted + de-duplicated here for deterministic output;
 * idempotent under repeated pipeline passes.
 */
export function injectModuleScripts(
  html: string,
  jsModuleIds: readonly string[],
  publishVersion: number,
): string {
  if (jsModuleIds.length === 0 || html.includes('data-instatic-module-js=')) return html
  const ids = [...new Set(jsModuleIds)].sort()
  const tags = ids
    .map(
      (id) =>
        `<script src="${moduleJsAssetPath(id)}?v=${publishVersion}" defer data-instatic-module-js="${escapeHtml(id)}"></script>`,
    )
    .join('\n')
  const withScripts = html.includes('</body>')
    ? html.replace('</body>', `${tags}\n</body>`)
    : `${html}\n${tags}`
  // External same-origin scripts only need `script-src 'self'` — merged as
  // data so ordering stays deterministic next to plugin/media relaxations.
  return rewriteCspMeta(withScripts, (csp) => addCspSources(csp, 'script-src', ["'self'"]))
}
