/**
 * Site-wide module-asset walk.
 *
 * Walks every page's node tree with the canonical render walker and returns
 * the shared accumulators — `cssMap` feeds the framework CSS bundle
 * (`siteCssBundle.ts`), `jsMap` feeds the published module-JS map
 * (`moduleJsBundle.ts`). One walker, two consumers, so the two channels can
 * never drift on traversal semantics.
 *
 * The HTML produced by `renderNode` is thrown away — discarding it is cheaper
 * than maintaining a separate assets-only walker that would drift from the
 * canonical render path over time. The accumulators are shared across pages,
 * so each module contributes at most one CSS and one JS entry for the whole
 * site even if it appears on every page.
 *
 * Known mirror of the CSS channel's semantics: loop bodies render empty here
 * (no prefetched loop data), so a module that appears ONLY inside loop bodies
 * contributes neither CSS nor JS — pre-existing behaviour, unchanged.
 */
import type { SiteDocument } from '@core/page-tree'
import type { IModuleRegistry } from '@core/module-engine'
import { renderNode } from '@core/publisher'
import type { RenderConfig, RenderAccumulators } from '@core/publisher'
import { buildPageFrame, buildRouteFrame, buildSiteFrame } from '@core/templates/contextFrames'
import { registerVersionedCacheReset } from './publishState'

type PublishedAssets = { generation: number; versions: Map<number, RenderAccumulators> }
let publishedAssets = new WeakMap<SiteDocument, WeakMap<IModuleRegistry, PublishedAssets>>()
registerVersionedCacheReset(() => { publishedAssets = new WeakMap() })

/** CSS and JS share one asset walk for each immutable published snapshot. */
export function getPublishedSiteModuleAssets(site: SiteDocument, registry: IModuleRegistry, version: number): RenderAccumulators {
  let registries = publishedAssets.get(site)
  if (!registries) { registries = new WeakMap(); publishedAssets.set(site, registries) }
  let entry = registries.get(registry)
  if (!entry || entry.generation !== registry.generation()) {
    entry = { generation: registry.generation(), versions: new Map() }
    registries.set(registry, entry)
  }
  let assets = entry.versions.get(version)
  if (!assets) { assets = collectSiteModuleAssets(site, registry); entry.versions.set(version, assets) }
  return assets
}

export function collectSiteModuleAssets(
  site: SiteDocument,
  registry: IModuleRegistry,
): RenderAccumulators {
  const acc: RenderAccumulators = {
    cssMap: new Map<string, string>(),
    jsMap: new Map<string, string>(),
    infiniteLoopIds: new Set<string>(),
    holeNodeIds: new Set<string>(),
    cspSources: new Map<string, Set<string>>(),
  }
  const siteFrame = buildSiteFrame(site)
  for (const page of site.pages) {
    const pageFrame = buildPageFrame(page)
    const config: RenderConfig = {
      page,
      site,
      registry,
      breakpointId: undefined,
      templateContext: {
        entryStack: [],
        page: pageFrame,
        site: siteFrame,
        route: buildRouteFrame(pageFrame.permalink),
      },
    }
    renderNode(page.rootNodeId, config, acc)
  }
  return acc
}
