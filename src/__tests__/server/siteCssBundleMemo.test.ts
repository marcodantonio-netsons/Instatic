/**
 * buildPublishedSiteCssBundle — version-keyed memoisation of the page-invariant
 * CSS bundles (reset / framework / style).
 *
 * The `framework` file is built by walking EVERY page's node tree to harvest
 * module CSS — work that scales with whole-site size, not the rendered page,
 * and is invariant across renders at the same publish version. These tests
 * prove:
 *
 *  (a) the expensive all-pages walk runs ONCE across many renders at the same
 *      publish version (the page-invariant files are reused by reference, and
 *      the module-render walk is not repeated);
 *  (b) `bumpPublishVersion()` invalidates the memo so a content change can never
 *      serve stale framework/style CSS;
 *  (c) the EMITTED CSS is byte-identical to the un-memoised `buildSiteCssBundle`
 *      — memoisation changes cost, never bytes;
 *  (d) `userStyles` (page-scoped) is rebuilt per call, never memoised.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import {
  buildSiteCssBundle,
  buildPublishedSiteCssBundle,
} from '../../../server/publish/siteCssBundle'
import { buildPublishedSiteModuleJsMap } from '../../../server/publish/moduleJsBundle'
import {
  bumpPublishVersion,
  resetPublishStateForTests,
} from '../../../server/publish/publishState'
import { makeModule, makeRegistry, makePage, makeSite } from '../publisher/helpers'
import type { SiteDocument } from '@core/page-tree'
import type { RenderResolvedMedia } from '@core/publisher'

describe('buildPublishedSiteCssBundle — page-invariant memo', () => {
  let renderCalls = 0
  const styledTextDef = makeModule('base.text', {
    render: (_props, _children) => {
      // Every node visited by the all-pages module-CSS walk runs this. Counting
      // invocations lets a test assert the walk happened exactly once per version.
      renderCalls += 1
      return { html: '<h1>Hi</h1>', css: 'h1 { color: black; }', js: 'TEXT_MODULE_JS' }
    },
  })
  const registry = makeRegistry({ 'base.text': styledTextDef })

  function makeMultiPageSite(): SiteDocument {
    const site = makeSite()
    site.pages = [
      makePage({ id: 'p1', root: { moduleId: 'base.text', props: { text: 'A' } } }),
      makePage({ id: 'p2', root: { moduleId: 'base.text', props: { text: 'B' } } }),
      makePage({ id: 'p3', root: { moduleId: 'base.text', props: { text: 'C' } } }),
    ]
    return site
  }

  function mediaAsset(variantPath: string): ReadonlyMap<string, RenderResolvedMedia> {
    return new Map([
      ['/uploads/hero.png', {
        publicPath: '/uploads/hero.png',
        mimeType: 'image/png',
        width: 640,
        height: 360,
        altText: '',
        blurHash: null,
        variants: [{ width: 640, height: 360, format: 'webp', path: variantPath, sizeBytes: 100 }],
        posterPath: null,
      }],
    ])
  }

  beforeEach(() => {
    resetPublishStateForTests()
    renderCalls = 0
  })

  it('runs the all-pages walk once across many renders at the same version', () => {
    const site = makeMultiPageSite()

    const first = buildPublishedSiteCssBundle(site, registry, site.pages[0])
    const callsAfterFirst = renderCalls
    expect(callsAfterFirst).toBeGreaterThan(0)

    // Render the other two pages at the SAME publish version.
    buildPublishedSiteCssBundle(site, registry, site.pages[1])
    buildPublishedSiteCssBundle(site, registry, site.pages[2])

    // The expensive walk did not run again — the framework/style files came
    // from the memo, not a fresh O(all-pages) traversal.
    expect(renderCalls).toBe(callsAfterFirst)

    // The page-invariant files are the very same objects (memo hit by reference).
    const second = buildPublishedSiteCssBundle(site, registry, site.pages[1])
    expect(second.reset).toBe(first.reset)
    expect(second.framework).toBe(first.framework)
    expect(second.style).toBe(first.style)
  })

  it('rebuilds userStyles per call — never memoised (page-scoped)', () => {
    const site = makeMultiPageSite()
    const a = buildPublishedSiteCssBundle(site, registry, site.pages[0])
    const b = buildPublishedSiteCssBundle(site, registry, site.pages[1])
    // Fresh object each call (page-scoped), even though these fixture pages
    // carry no user stylesheets so the content/hash coincide.
    expect(b.userStyles).not.toBe(a.userStyles)
  })

  it('recomputes after bumpPublishVersion (no stale CSS after publish)', () => {
    const site = makeMultiPageSite()

    const before = buildPublishedSiteCssBundle(site, registry, site.pages[0])
    const callsAfterFirst = renderCalls

    bumpPublishVersion()

    const after = buildPublishedSiteCssBundle(site, registry, site.pages[0])
    // The walk ran again for the new version — the memo was invalidated.
    expect(renderCalls).toBeGreaterThan(callsAfterFirst)
    // New file objects (recomputed, not the stale cached ones).
    expect(after.framework).not.toBe(before.framework)
    expect(after.style).not.toBe(before.style)
  })

  it('uses a distinct walk for a different published site object at the same version', () => {
    const firstSite = makeMultiPageSite()
    const secondSite = makeMultiPageSite()

    const first = buildPublishedSiteCssBundle(firstSite, registry, firstSite.pages[0])
    const callsAfterFirstSite = renderCalls

    const second = buildPublishedSiteCssBundle(secondSite, registry, secondSite.pages[0])

    expect(renderCalls).toBe(callsAfterFirstSite + 3)
    expect(second.framework).not.toBe(first.framework)
    expect(second.style).not.toBe(first.style)
  })

  it('an explicit publishVersion argument (publish-time bake) gets its own memo slot', () => {
    // The bake renders the NEXT version's content before bumpPublishVersion()
    // runs, passing `nextPublishVersion` explicitly — it must not be served the
    // current version's cached bundles.
    const site = makeMultiPageSite()

    const current = buildPublishedSiteCssBundle(site, registry, site.pages[0])
    const callsAfterCurrent = renderCalls

    const next = buildPublishedSiteCssBundle(site, registry, site.pages[0], 1)
    expect(renderCalls).toBeGreaterThan(callsAfterCurrent)
    expect(next.framework).not.toBe(current.framework)
  })

  it('shares one published asset walk across CSS and JS for each explicit version', () => {
    const site = makeMultiPageSite()
    site.styleRules = {
      hero: {
        id: 'hero',
        name: 'hero',
        kind: 'class',
        selector: '.hero',
        order: 0,
        styles: { backgroundImage: 'url(/uploads/hero.png)' },
        contextStyles: {},
        createdAt: 0,
        updatedAt: 0,
      },
    }

    const currentVersion = 0
    const nextVersion = 1
    const firstCss = buildPublishedSiteCssBundle(
      site,
      registry,
      site.pages[0],
      currentVersion,
      { mediaAssets: mediaAsset('/uploads/hero-640-a.webp') },
    )
    const callsAfterCurrentCss = renderCalls
    expect(callsAfterCurrentCss).toBe(3)

    const currentJs = buildPublishedSiteModuleJsMap(site, registry, currentVersion)
    expect([...currentJs]).toEqual([['base.text', 'TEXT_MODULE_JS']])
    expect(renderCalls).toBe(callsAfterCurrentCss)

    // A media-signature change rebuilds CSS, but the module asset walk has no
    // media input and remains shared with the JS channel.
    const changedMediaCss = buildPublishedSiteCssBundle(
      site,
      registry,
      site.pages[0],
      currentVersion,
      { mediaAssets: mediaAsset('/uploads/hero-640-b.webp') },
    )
    expect(changedMediaCss.style).not.toBe(firstCss.style)
    expect(renderCalls).toBe(callsAfterCurrentCss)

    // The publish-time bake renders the next snapshot before the version bump;
    // its explicit version gets one shared walk across CSS and JS too.
    const nextCss = buildPublishedSiteCssBundle(
      site,
      registry,
      site.pages[0],
      nextVersion,
      { mediaAssets: mediaAsset('/uploads/hero-640-b.webp') },
    )
    expect(renderCalls).toBe(callsAfterCurrentCss + 3)
    expect(nextCss.framework).not.toBe(firstCss.framework)

    const nextJs = buildPublishedSiteModuleJsMap(site, registry, nextVersion)
    expect([...nextJs]).toEqual([['base.text', 'TEXT_MODULE_JS']])
    expect(renderCalls).toBe(callsAfterCurrentCss + 3)

    const replacementRegistry = makeRegistry({ 'base.text': styledTextDef })
    const replacementJs = buildPublishedSiteModuleJsMap(site, replacementRegistry, nextVersion)
    expect([...replacementJs]).toEqual([['base.text', 'TEXT_MODULE_JS']])
    expect(renderCalls).toBe(callsAfterCurrentCss + 6)
  })

  it('emits byte-identical CSS to the un-memoised builder', () => {
    const site = makeMultiPageSite()
    const page = site.pages[0]

    const plain = buildSiteCssBundle(site, registry, page)
    const memoised = buildPublishedSiteCssBundle(site, registry, page)

    for (const id of ['reset', 'framework', 'style', 'userStyles'] as const) {
      expect(memoised[id].content).toBe(plain[id].content)
      expect(memoised[id].hash).toBe(plain[id].hash)
      expect(memoised[id].filename).toBe(plain[id].filename)
    }
  })

  it('serves identical bytes from the memo as a fresh build at the same version', () => {
    const site = makeMultiPageSite()
    const page = site.pages[0]

    // Snapshot a representative page's bundle, then read it back from the memo.
    const fresh = buildPublishedSiteCssBundle(site, registry, page)
    const cached = buildPublishedSiteCssBundle(site, registry, page)

    expect(cached.framework.content).toBe(fresh.framework.content)
    expect(cached.style.content).toBe(fresh.style.content)
    expect(cached.reset.content).toBe(fresh.reset.content)
  })
})
