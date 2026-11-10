/**
 * Tests for the `/_instatic/hole/<nodeId>` and `/_instatic/hole-runtime.js` endpoints.
 *
 * Uses a minimal fake DbClient that intercepts `getLatestPublishedSiteSnapshot`
 * queries (the same pattern as publicRouterCache.test.ts).
 *
 * Covers:
 *   - Correct version (matches frozen published site) → 200 + HTML fragment
 *   - Stale version (?v= mismatch) → stale sentinel without caching
 *   - Missing node → 404
 *   - Site not published → 404
 *   - Non-GET method → 405
 *   - Runtime asset endpoint serves HOLE_RUNTIME_JS with correct headers
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db'
import {
  handleHoleRequest,
  isHoleRuntimeAssetPath,
  serveHoleRuntimeAsset,
} from '../../../server/handlers/cms/hole'
import { resetForTests } from '../../../server/publish/renderCache'
import { bumpPublishVersion } from '../../../server/publish/publishState'
import { getPublishedSnapshotHash } from '../../../server/publish/publishedSnapshotCache'
import { HOLE_RUNTIME_JS } from '../../../server/publish/holeRuntime'
import { handleServerRequest } from '../../../server/router'
import type { PublishedPageSnapshot } from '../../../server/repositories/publish'
import { buildPublishedPageRenderContext } from '../../../server/publish/publishedRenderContext'
import { publishPage } from '../../core/publisher'
import '@modules/base'
import { makeNode, makePage as makeFixturePage, makeVC, makeVCNode, makeVCTree } from '../fixtures'
import { makeModule } from '../publisher/helpers'
import { registry } from '../../core/module-engine/registry'

// ---------------------------------------------------------------------------
// Snapshot fixture
// ---------------------------------------------------------------------------

function makeSnapshot(text = 'Hello from hole'): PublishedPageSnapshot {
  return {
    cmsSnapshotVersion: 1 as const,
    pageRowId: 'page_1',
    siteSnapshotId: 'site-snapshot',
    site: {
      id: 'site_1',
      name: 'Test Site',
      pages: [
        {
          id: 'page_1',
          title: 'Test Page',
          slug: 'test',
          rootNodeId: 'root',
          nodes: {
            root: {
              id: 'root',
              moduleId: 'test.body',
              props: {},
              breakpointOverrides: {},
              children: ['text-node'],
              classIds: [],
            },
            'text-node': {
              id: 'text-node',
              moduleId: 'test.text',
              props: { text },
              breakpointOverrides: {},
              children: [],
              classIds: [],
            },
          },
        },
      ],
      files: [],
      visualComponents: [],
      breakpoints: [{ id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' }],
      settings: { metaTitle: 'Test', shortcuts: {} },
      styleRules: {},
      createdAt: 1000,
      updatedAt: 2000,
      packageJson: { dependencies: {}, devDependencies: {} },
      runtime: {
        dependencyLock: { version: 1, packages: {}, updatedAt: 0 },
        scripts: {},
      },
    },
  }
}

function makeTemplateAndComponentSnapshot(): PublishedPageSnapshot {
  const snapshot = makeSnapshot()
  const page = makeFixturePage({
    id: 'page-it',
    title: 'Italian page',
    slug: 'it/page',
    rootNodeId: 'page-root',
    nodes: {
      'page-root': makeNode({ id: 'page-root', moduleId: 'test.body', children: ['page-hole'] }),
      'page-hole': makeNode({
        id: 'page-hole', moduleId: 'test.dynamic', props: { value: '' },
        dynamicBindings: { value: { source: 'route', field: 'path' } },
      }),
    },
  })
  const frenchPage = makeFixturePage({
    id: 'page-fr',
    title: 'French page',
    slug: 'fr/page',
    rootNodeId: 'page-root',
    nodes: {
      'page-root': makeNode({ id: 'page-root', moduleId: 'test.body', children: ['fr-copy'] }),
      'fr-copy': makeNode({ id: 'fr-copy', moduleId: 'test.text', props: { text: 'Bonjour' } }),
    },
    language: 'fr',
  })
  const layout = makeFixturePage({
    id: 'layout-everywhere',
    title: 'Shared layout',
    slug: 'layout',
    rootNodeId: 'layout-root',
    template: { enabled: true, target: { kind: 'everywhere' }, priority: 0 },
    nodes: {
      'layout-root': makeNode({ id: 'layout-root', moduleId: 'test.body', children: ['shared-ref', 'outlet'] }),
      'shared-ref': makeNode({
        id: 'shared-ref', moduleId: 'base.visual-component-ref', props: { componentId: 'shared-dynamic' },
      }),
      outlet: makeNode({ id: 'outlet', moduleId: 'base.outlet' }),
    },
  })
  return {
    ...snapshot,
    pageRowId: page.id,
    site: {
      ...snapshot.site,
      pages: [page, frenchPage, layout],
      visualComponents: [makeVC({
        id: 'shared-dynamic',
        name: 'Shared dynamic component',
        tree: makeVCTree('vc-root', [makeVCNode({
          id: 'vc-root',
          moduleId: 'test.dynamic',
          props: { value: '' },
          dynamicBindings: { value: { source: 'route', field: 'path' } },
        })]),
      })],
    },
  }
}

// ---------------------------------------------------------------------------
// Fake DB
// ---------------------------------------------------------------------------

function makeFakeDb(snapshot: ReturnType<typeof makeSnapshot> | null): DbClient {
  const handle = async <Row extends Record<string, unknown> = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<DbResult<Row>> => {
    const sql = strings.reduce<string>((acc, str, i) => (i === 0 ? str : `${acc}$${i}${str}`), '')
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()

    if (!normalized.includes('site_snapshots.site_json') && normalized.includes('data_row_versions.site_snapshot_id') && normalized.includes('data_row_versions.slug =')) {
      const page = snapshot?.site.pages.find((candidate) => values.includes(candidate.slug))
      return {
        rows: snapshot && page
          ? [{ row_id: page.id, site_snapshot_id: snapshot.siteSnapshotId, runtime_assets_json: null } as unknown as Row]
          : [],
        rowCount: snapshot && page ? 1 : 0,
      }
    }

    if (normalized.includes('site_snapshots.site_json')) {
      const page = normalized.includes('data_row_versions.slug =')
        ? snapshot?.site.pages.find((candidate) => values.includes(candidate.slug))
        : undefined
      return {
        rows: snapshot && (!normalized.includes('data_row_versions.slug =') || page)
          ? [{
              row_id: page?.id ?? snapshot.pageRowId,
              site_snapshot_id: snapshot.siteSnapshotId,
              site_json: snapshot.site,
              runtime_assets_json: null,
              importmap_body: null,
              importmap_sha256: null,
            } as unknown as Row]
          : [],
        rowCount: snapshot && (!normalized.includes('data_row_versions.slug =') || page) ? 1 : 0,
      }
    }

    return { rows: [], rowCount: 0 }
  }

  handle.unsafe = async <Row extends Record<string, unknown> = Record<string, unknown>>() => ({ rows: [] as Row[], rowCount: 0 })

  handle.transaction = async <T>(cb: (tx: DbClient) => Promise<T>): Promise<T> =>
    cb(handle as unknown as DbClient)

  return handle as DbClient
}

/**
 * Fake DB that counts snapshot loads and yields a microtask before resolving,
 * so concurrent hole requests overlap and exercise the version-keyed
 * single-flight in `publishState`. `count()` reports how many times the
 * published-snapshot query actually hit the DB.
 */
function makeCountingDb(snapshot: ReturnType<typeof makeSnapshot>): {
  db: DbClient
  count: () => number
} {
  let loads = 0
  const handle = async <Row extends Record<string, unknown> = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<DbResult<Row>> => {
    const sql = strings.reduce<string>((acc, str, i) => (i === 0 ? str : `${acc}$${i}${str}`), '')
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    if (!normalized.includes('site_snapshots.site_json') && normalized.includes('data_row_versions.site_snapshot_id') && normalized.includes('data_row_versions.slug =')) {
      const page = snapshot.site.pages.find((candidate) => values.includes(candidate.slug))
      return {
        rows: page
          ? [{ row_id: page.id, site_snapshot_id: snapshot.siteSnapshotId, runtime_assets_json: null } as unknown as Row]
          : [],
        rowCount: page ? 1 : 0,
      }
    }
    if (normalized.includes('site_snapshots.site_json')) {
      if (!normalized.includes('data_row_versions.slug =')) loads++
      await Promise.resolve() // let other in-flight callers join before resolving
      return {
        rows: [{
          row_id: snapshot.pageRowId,
          site_snapshot_id: snapshot.siteSnapshotId,
          site_json: snapshot.site,
          runtime_assets_json: null,
          importmap_body: null,
          importmap_sha256: null,
        } as unknown as Row],
        rowCount: 1,
      }
    }
    return { rows: [], rowCount: 0 }
  }
  handle.unsafe = async <Row extends Record<string, unknown> = Record<string, unknown>>() => ({ rows: [] as Row[], rowCount: 0 })
  handle.transaction = async <T>(cb: (tx: DbClient) => Promise<T>): Promise<T> =>
    cb(handle as unknown as DbClient)
  return { db: handle as DbClient, count: () => loads }
}

function makeThrowingDb(): { db: DbClient; wasQueried: () => boolean } {
  let queried = false
  const handle = async <Row extends Record<string, unknown> = Record<string, unknown>>(
    _strings: TemplateStringsArray,
    ..._values: unknown[]
  ): Promise<DbResult<Row>> => {
    queried = true
    throw new Error('unexpected database query while serving hole namespace')
  }
  handle.transaction = async <T>(cb: (tx: DbClient) => Promise<T>): Promise<T> =>
    cb(handle as unknown as DbClient)
  return { db: handle as DbClient, wasQueried: () => queried }
}

// ---------------------------------------------------------------------------
// Setup — register minimal test modules in the singleton registry
// (the hole handler uses the singleton registry to look up module renderers)
// ---------------------------------------------------------------------------

beforeEach(() => {
  // `resetForTests` clears the LRU and delegates to `resetPublishStateForTests`,
  // which resets the publish version AND every version-keyed single-flight memo
  // — including the hole endpoint's snapshot cache. No bespoke hole reset hook.
  resetForTests()

  // Register test-specific module IDs using registerOrReplace so these tests
  // never conflict with base module registrations in other test files.
  registry.registerOrReplace(
    makeModule('test.body', {
      render: (_p, children) => ({ html: `<div>${children.join('')}</div>` }),
    }),
  )
  registry.registerOrReplace(
    makeModule('test.text', {
      render: (p) => ({ html: `<span>${String(p['text'] ?? '')}</span>` }),
    }),
  )
  registry.registerOrReplace(
    makeModule('test.dynamic', {
      dynamic: true,
      render: (p) => ({ html: `<span>${String(p['value'] ?? '')}</span>` }),
    }),
  )
})

// ---------------------------------------------------------------------------
// isHoleRuntimeAssetPath
// ---------------------------------------------------------------------------

describe('isHoleRuntimeAssetPath', () => {
  it('returns true for /_instatic/hole-runtime.js', () => {
    expect(isHoleRuntimeAssetPath('/_instatic/hole-runtime.js')).toBe(true)
  })

  it('returns false for other paths', () => {
    expect(isHoleRuntimeAssetPath('/_instatic/hole/')).toBe(false)
    expect(isHoleRuntimeAssetPath('/_instatic/hole-runtime')).toBe(false)
    expect(isHoleRuntimeAssetPath('/_instatic/assets/loop-runtime.js')).toBe(false)
    expect(isHoleRuntimeAssetPath('/_instatic/hole/some-node-id')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// serveHoleRuntimeAsset
// ---------------------------------------------------------------------------

describe('serveHoleRuntimeAsset', () => {
  it('serves the HOLE_RUNTIME_JS source with correct headers', () => {
    const res = serveHoleRuntimeAsset()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/javascript; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
  })

  it('response body matches HOLE_RUNTIME_JS export', async () => {
    const res = serveHoleRuntimeAsset()
    const body = await res.text()
    expect(body).toBe(HOLE_RUNTIME_JS)
  })
})

// ---------------------------------------------------------------------------
// router integration — namespace ownership
// ---------------------------------------------------------------------------

describe('server router — hole namespace ownership', () => {
  it('serves the hole runtime asset before hole fragments or public routing', async () => {
    const { db, wasQueried } = makeThrowingDb()

    const res = await handleServerRequest(
      new Request('http://localhost/_instatic/hole-runtime.js'),
      { db },
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/javascript; charset=utf-8')
    expect(await res.text()).toBe(HOLE_RUNTIME_JS)
    expect(wasQueried()).toBe(false)
  })

  it('routes hole fragments through the router before public-page fallthrough', async () => {
    const snapshot = makeSnapshot()
    const db = makeFakeDb(snapshot)
    const version = getPublishedSnapshotHash(snapshot.site)

    const res = await handleServerRequest(
      new Request(`http://localhost/_instatic/hole/text-node?v=${version}&u=%2Ftest`),
      { db },
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await res.text()).toContain('Hello from hole')
  })

  it('keeps malformed hole fragment URLs inside the exclusive namespace', async () => {
    const { db, wasQueried } = makeThrowingDb()

    const res = await handleServerRequest(
      new Request('http://localhost/_instatic/hole/?v=0'),
      { db },
    )

    expect(res.status).toBe(400)
    expect(await res.text()).toContain('Missing node id')
    expect(wasQueried()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// handleHoleRequest — method guard
// ---------------------------------------------------------------------------

describe('handleHoleRequest — method guard', () => {
  it('returns 405 for non-GET methods', async () => {
    const db = makeFakeDb(null)

    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const url = new URL('http://localhost/_instatic/hole/text-node?v=0')
      const req = new Request(url, { method })
      const res = await handleHoleRequest(req, url, { db })
      expect(res.status).toBe(405)
    }
  })
})

// ---------------------------------------------------------------------------
// handleHoleRequest — site not published
// ---------------------------------------------------------------------------

describe('handleHoleRequest — site not published', () => {
  it('returns 404 when no published snapshot exists', async () => {
    const db = makeFakeDb(null)
    const url = new URL('http://localhost/_instatic/hole/text-node?v=missing')
    const req = new Request(url)
    const res = await handleHoleRequest(req, url, { db })
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// handleHoleRequest — stale version
// ---------------------------------------------------------------------------

describe('handleHoleRequest — stale version', () => {
  it('rejects a fingerprint from a replaced snapshot without caching', async () => {
    const oldHash = getPublishedSnapshotHash(makeSnapshot('Old content').site)
    const db = makeFakeDb(makeSnapshot('New content'))
    const url = new URL(`http://localhost/_instatic/hole/text-node?v=${oldHash}`)
    const res = await handleHoleRequest(new Request(url), url, { db })
    expect(await res.text()).toContain('data-instatic-stale="true"')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.status).toBe(200)
  })

  it('rejects a missing fingerprint', async () => {
    const db = makeFakeDb(makeSnapshot())
    const url = new URL('http://localhost/_instatic/hole/text-node')
    const res = await handleHoleRequest(new Request(url), url, { db })
    expect(await res.text()).toContain('instatic-hole-stale')
  })
})

// ---------------------------------------------------------------------------
// handleHoleRequest — node not found
// ---------------------------------------------------------------------------

describe('handleHoleRequest — node not found', () => {
  it('returns 404 when nodeId is not present in any page', async () => {
    const snapshot = makeSnapshot()
    const db = makeFakeDb(snapshot)

    const currentVersion = getPublishedSnapshotHash(snapshot.site)
    const url = new URL(`http://localhost/_instatic/hole/no-such-node?v=${currentVersion}&u=%2Ftest`)
    const req = new Request(url)
    const res = await handleHoleRequest(req, url, { db })
    expect(res.status).toBe(404)
  })

  it('returns 404 when the node exists on a different public route only', async () => {
    const snapshot = makeTemplateAndComponentSnapshot()
    const version = getPublishedSnapshotHash(snapshot.site)
    const url = new URL(`http://localhost/_instatic/hole/c0_page-hole?v=${version}&u=%2Ffr%2Fpage`)
    const res = await handleHoleRequest(new Request(url), url, { db: makeFakeDb(snapshot) })
    expect(res.status).toBe(404)
  })
})

describe('handleHoleRequest — originating public route', () => {
  it('requires a local originating page URL', async () => {
    const snapshot = makeSnapshot()
    const version = getPublishedSnapshotHash(snapshot.site)
    const db = makeFakeDb(snapshot)
    const requests = [
      new URL(`http://localhost/_instatic/hole/text-node?v=${version}`),
      new URL(`http://localhost/_instatic/hole/text-node?v=${version}&u=%2F%2Fevil.example%2Fpage`),
      new URL(`http://localhost/_instatic/hole/text-node?v=${version}&u=https%3A%2F%2Fevil.example%2Fpage`),
    ]
    for (const url of requests) {
      const response = await handleHoleRequest(new Request(url), url, { db })
      expect(response.status).toBe(400)
      expect(await response.text()).toContain('originating page URL')
    }
  })
})

// ---------------------------------------------------------------------------
// handleHoleRequest — successful render
// ---------------------------------------------------------------------------

describe('handleHoleRequest — successful render', () => {
  it('returns 200 with rendered HTML fragment for a matching node + version', async () => {
    const snapshot = makeSnapshot()
    const db = makeFakeDb(snapshot)

    const currentVersion = getPublishedSnapshotHash(snapshot.site)
    const url = new URL(`http://localhost/_instatic/hole/text-node?v=${currentVersion}&u=%2Ftest`)
    const req = new Request(url)
    const res = await handleHoleRequest(req, url, { db })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')

    const body = await res.text()
    // The test.text module renders a <span> with the text prop
    expect(body).toContain('Hello from hole')
  })

  it('second request for the same node+version hits the Layer B cache (same body)', async () => {
    const snapshot = makeSnapshot()
    const db = makeFakeDb(snapshot)

    const currentVersion = getPublishedSnapshotHash(snapshot.site)
    const url = new URL(`http://localhost/_instatic/hole/text-node?v=${currentVersion}&u=%2Ftest`)

    const res1 = await handleHoleRequest(new Request(url), url, { db })
    const body1 = await res1.text()

    const res2 = await handleHoleRequest(new Request(url), url, { db })
    const body2 = await res2.text()

    expect(body1).toBe(body2)
    expect(res2.status).toBe(200)
  })

  it('renders template and shared-component holes from the exact composed route', async () => {
    const snapshot = makeTemplateAndComponentSnapshot()
    const version = getPublishedSnapshotHash(snapshot.site)
    const page = snapshot.site.pages.find((candidate) => candidate.id === 'page-it')!
    const context = buildPublishedPageRenderContext(snapshot, page, new URL('http://localhost/it/page'))
    const shell = publishPage(context.page, snapshot.site, registry, {
      templateContext: context.templateContext,
      snapshotHash: version,
    }).html
    expect(shell).toContain('data-instatic-hole="shared-ref"')
    expect(shell).toContain('data-instatic-hole="c0_page-hole"')

    for (const path of ['/it/page', '/fr/page']) {
      const url = new URL(`http://localhost/_instatic/hole/shared-ref?v=${version}&u=${encodeURIComponent(path)}`)
      const response = await handleHoleRequest(new Request(url), url, { db: makeFakeDb(snapshot) })
      expect(response.status).toBe(200)
      expect(await response.text()).toContain(`<span>${path}</span>`)
    }

    const pageHoleUrl = new URL(`http://localhost/_instatic/hole/c0_page-hole?v=${version}&u=%2Fit%2Fpage`)
    const pageHole = await handleHoleRequest(new Request(pageHoleUrl), pageHoleUrl, { db: makeFakeDb(snapshot) })
    expect(pageHole.status).toBe(200)
    expect(await pageHole.text()).toContain('<span>/it/page</span>')
  })

  it('keys the fragment cache on the page path, so a poisoned u= cannot leak across paths (GHSA-f29g)', async () => {
    // The shared template hole has one id across routes, but its route frame
    // and cached fragment must come from the page URL that requested it.
    const snapshot = makeTemplateAndComponentSnapshot()
    const db = makeFakeDb(snapshot)
    const version = getPublishedSnapshotHash(snapshot.site)

    const evilUrl = new URL(`http://localhost/_instatic/hole/shared-ref?v=${version}&u=${encodeURIComponent('/it/page')}`)
    const evil = await handleHoleRequest(new Request(evilUrl), evilUrl, { db })
    const evilBody = await evil.text()
    expect(evil.status).toBe(200)
    expect(evilBody).toContain('/it/page')

    const realUrl = new URL(`http://localhost/_instatic/hole/shared-ref?v=${version}&u=${encodeURIComponent('/fr/page')}`)
    const real = await handleHoleRequest(new Request(realUrl), realUrl, { db })
    const realBody = await real.text()
    expect(real.status).toBe(200)
    expect(realBody).toContain('/fr/page')
    expect(realBody).not.toContain('/it/page')
  })

  it('keeps an unchanged snapshot valid after a cache generation bump', async () => {
    const snapshot = makeSnapshot()
    const db = makeFakeDb(snapshot)

    const oldVersion = getPublishedSnapshotHash(snapshot.site)
    bumpPublishVersion()

    // The shell still belongs to the same frozen published site.
    const url = new URL(`http://localhost/_instatic/hole/text-node?v=${oldVersion}&u=%2Ftest`)
    const req = new Request(url)
    const res = await handleHoleRequest(req, url, { db })

    const body = await res.text()
    expect(body).toContain('Hello from hole')
  })
})

// ---------------------------------------------------------------------------
// handleHoleRequest — version-keyed single-flight (no bespoke reset hook)
// ---------------------------------------------------------------------------

describe('handleHoleRequest — snapshot single-flight', () => {
  it('loads the published snapshot once for concurrent requests at the same version', async () => {
    const snapshot = makeSnapshot()
    const { db, count } = makeCountingDb(snapshot)
    const currentVersion = getPublishedSnapshotHash(snapshot.site)
    const url = new URL(`http://localhost/_instatic/hole/text-node?v=${currentVersion}&u=%2Ftest`)

    // Fire several concurrent requests for the same (nodeId, version). The
    // version-keyed single-flight memo must collapse them into one DB load.
    const results = await Promise.all(
      Array.from({ length: 8 }, () => handleHoleRequest(new Request(url), url, { db })),
    )

    for (const res of results) {
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('Hello from hole')
    }
    expect(count()).toBe(1)
  })

  it('reloads after a version bump (memo is version-keyed)', async () => {
    const snapshot = makeSnapshot()
    const { db, count } = makeCountingDb(snapshot)

    const v0 = getPublishedSnapshotHash(snapshot.site)
    const url0 = new URL(`http://localhost/_instatic/hole/text-node?v=${v0}&u=%2Ftest`)
    await handleHoleRequest(new Request(url0), url0, { db })
    expect(count()).toBe(1)

    bumpPublishVersion()
    const v1 = getPublishedSnapshotHash(snapshot.site)
    const url1 = new URL(`http://localhost/_instatic/hole/text-node?v=${v1}&u=%2Ftest`)
    const res = await handleHoleRequest(new Request(url1), url1, { db })
    expect(await res.text()).toContain('Hello from hole')
    expect(count()).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// handleHoleRequest — CMS form token stamping
// ---------------------------------------------------------------------------

describe('hole fragments and CMS forms', () => {
  it('stamps form page tokens + page id onto CMS-native forms inside fragments', async () => {
    registry.registerOrReplace(
      makeModule('test.cmsform', {
        render: () => ({
          html: '<form data-instatic-form-mode="cms" data-instatic-form-id="contact"></form>',
        }),
      }),
    )
    const snapshot = makeSnapshot()
    snapshot.site.pages[0].nodes['text-node'].moduleId = 'test.cmsform'

    const version = getPublishedSnapshotHash(snapshot.site)
    const url = new URL(`http://localhost/_instatic/hole/text-node?v=${version}&u=%2Ftest`)
    const res = await handleHoleRequest(new Request(url), url, { db: makeFakeDb(snapshot) })

    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('data-instatic-page-token=')
    expect(html).toContain('data-instatic-page-id="page_1"')
  })
})
