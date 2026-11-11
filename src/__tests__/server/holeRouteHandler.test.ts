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
import { makeModule } from '../publisher/helpers'
import { registry } from '../../core/module-engine/registry'

// ---------------------------------------------------------------------------
// Snapshot fixture
// ---------------------------------------------------------------------------

function makePage(pageId: string, slug: string, text: string) {
  return {
    id: pageId,
    title: `Page ${slug}`,
    slug,
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
  }
}

function makeSnapshot(text = 'Hello from hole', pages = [makePage('page_1', 'test', text)]) {
  return {
    cmsSnapshotVersion: 1 as const,
    pageRowId: pages[0]?.id ?? 'page_1',
    siteSnapshotId: 'site-snapshot',
    site: {
      id: 'site_1',
      name: 'Test Site',
      pages,
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

function holeUrl(nodeId: string, version: string, path = '/test'): URL {
  const url = new URL(`http://localhost/_instatic/hole/${encodeURIComponent(nodeId)}`)
  url.searchParams.set('v', version)
  url.searchParams.set('u', path)
  return url
}

// ---------------------------------------------------------------------------
// Fake DB
// ---------------------------------------------------------------------------

function makeFakeDb(snapshot: ReturnType<typeof makeSnapshot> | null): DbClient {
  const handle = async <Row extends Record<string, unknown> = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ..._values: unknown[]
  ): Promise<DbResult<Row>> => {
    const sql = strings.reduce<string>((acc, str, i) => (i === 0 ? str : `${acc}$${i}${str}`), '')
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()

    if (snapshot && normalized.includes('runtime_assets_json') && !normalized.includes('site_snapshots.site_json')) {
      const page = snapshot.site.pages.find((candidate) => candidate.slug === String(_values[0] ?? ''))
      return {
        rows: page
          ? [{ row_id: page.id, site_snapshot_id: snapshot.siteSnapshotId, runtime_assets_json: null } as unknown as Row]
          : [],
        rowCount: page ? 1 : 0,
      }
    }

    if (normalized.includes('site_snapshots.site_json')) {
      return {
        rows: snapshot
          ? [{
              row_id: snapshot.pageRowId,
              site_snapshot_id: snapshot.siteSnapshotId,
              site_json: snapshot.site,
              runtime_assets_json: null,
              importmap_body: null,
              importmap_sha256: null,
            } as unknown as Row]
          : [],
        rowCount: snapshot ? 1 : 0,
      }
    }

    return { rows: [], rowCount: 0 }
  }

  handle.transaction = async <T>(cb: (tx: DbClient) => Promise<T>): Promise<T> =>
    cb(handle as unknown as DbClient)

  return handle as DbClient
}

function makeVersionedDb(
  latestSnapshot: ReturnType<typeof makeSnapshot>,
  pageSnapshot: ReturnType<typeof makeSnapshot>,
): DbClient {
  const handle = async <Row extends Record<string, unknown> = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<DbResult<Row>> => {
    const sql = strings.reduce<string>((acc, str, i) => (i === 0 ? str : `${acc}$${i}${str}`), '')
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    if (normalized.includes('runtime_assets_json') && !normalized.includes('site_snapshots.site_json')) {
      const page = pageSnapshot.site.pages.find((candidate) => candidate.slug === String(values[0] ?? ''))
      return {
        rows: page
          ? [{ row_id: page.id, site_snapshot_id: pageSnapshot.siteSnapshotId, runtime_assets_json: null } as unknown as Row]
          : [],
        rowCount: page ? 1 : 0,
      }
    }
    if (normalized.includes('site_snapshots.site_json')) {
      const selected = normalized.includes('data_row_versions.slug =') ? pageSnapshot : latestSnapshot
      return {
        rows: [{
          row_id: selected.pageRowId,
          site_snapshot_id: selected.siteSnapshotId,
          site_json: selected.site,
          runtime_assets_json: null,
          importmap_body: null,
          importmap_sha256: null,
        } as unknown as Row],
        rowCount: 1,
      }
    }
    return { rows: [], rowCount: 0 }
  }

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
    ..._values: unknown[]
  ): Promise<DbResult<Row>> => {
    const sql = strings.reduce<string>((acc, str, i) => (i === 0 ? str : `${acc}$${i}${str}`), '')
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    if (normalized.includes('runtime_assets_json') && !normalized.includes('site_snapshots.site_json')) {
      const page = snapshot.site.pages.find((candidate) => candidate.slug === String(_values[0] ?? ''))
      return {
        rows: page
          ? [{ row_id: page.id, site_snapshot_id: snapshot.siteSnapshotId, runtime_assets_json: null } as unknown as Row]
          : [],
        rowCount: page ? 1 : 0,
      }
    }
    if (normalized.includes('site_snapshots.site_json')) {
      loads++
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
      new Request(holeUrl('text-node', version)),
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
      const url = holeUrl('text-node', '0')
      const req = new Request(url, { method })
      const res = await handleHoleRequest(req, url, { db })
      expect(res.status).toBe(405)
    }
  })
})

describe('handleHoleRequest — originating route validation', () => {
  it('rejects a forwarded cross-origin path', async () => {
    const snapshot = makeSnapshot()
    const version = getPublishedSnapshotHash(snapshot.site)
    const url = holeUrl('text-node', version, '//attacker.example/path')

    const res = await handleHoleRequest(new Request(url), url, { db: makeFakeDb(snapshot) })

    expect(res.status).toBe(400)
    expect(await res.text()).toContain('Invalid originating page URL')
  })
})

// ---------------------------------------------------------------------------
// handleHoleRequest — site not published
// ---------------------------------------------------------------------------

describe('handleHoleRequest — site not published', () => {
  it('returns 404 when no published snapshot exists', async () => {
    const db = makeFakeDb(null)
    const url = holeUrl('text-node', 'missing')
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
    const url = holeUrl('text-node', oldHash)
    const res = await handleHoleRequest(new Request(url), url, { db })
    expect(await res.text()).toContain('data-instatic-stale="true"')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.status).toBe(200)
  })

  it('rejects a missing fingerprint', async () => {
    const db = makeFakeDb(makeSnapshot())
    const url = holeUrl('text-node', '')
    const res = await handleHoleRequest(new Request(url), url, { db })
    expect(await res.text()).toContain('instatic-hole-stale')
  })

  it('loads the route page snapshot when its identity differs from the cached site snapshot', async () => {
    const latestSnapshot = makeSnapshot('Latest content')
    latestSnapshot.siteSnapshotId = 'latest-snapshot'
    const pageSnapshot = makeSnapshot('Older route content')
    pageSnapshot.siteSnapshotId = 'older-snapshot'
    const db = makeVersionedDb(latestSnapshot, pageSnapshot)
    const url = holeUrl('text-node', getPublishedSnapshotHash(latestSnapshot.site))

    const res = await handleHoleRequest(new Request(url), url, { db })

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('data-instatic-stale="true"')
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
    const url = holeUrl('no-such-node', currentVersion)
    const req = new Request(url)
    const res = await handleHoleRequest(req, url, { db })
    expect(res.status).toBe(404)
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
    const url = holeUrl('text-node', currentVersion)
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
    const url = holeUrl('text-node', currentVersion)

    const res1 = await handleHoleRequest(new Request(url), url, { db })
    const body1 = await res1.text()

    const res2 = await handleHoleRequest(new Request(url), url, { db })
    const body2 = await res2.text()

    expect(body1).toBe(body2)
    expect(res2.status).toBe(200)
  })

  it('resolves duplicate raw node ids within the requested page route', async () => {
    const snapshot = makeSnapshot('First route: {route.path}', [
      makePage('page_1', 'test', 'First route: {route.path}'),
      makePage('page_2', 'other', 'Second route: {route.path}'),
    ])
    const db = makeFakeDb(snapshot)
    const version = getPublishedSnapshotHash(snapshot.site)

    const firstUrl = holeUrl('text-node', version, '/test')
    const first = await handleHoleRequest(new Request(firstUrl), firstUrl, { db })
    expect(await first.text()).toContain('First route: /test')

    const secondUrl = holeUrl('text-node', version, '/other')
    const second = await handleHoleRequest(new Request(secondUrl), secondUrl, { db })
    expect(await second.text()).toContain('Second route: /other')
  })

  it('keeps an unchanged snapshot valid after a cache generation bump', async () => {
    const snapshot = makeSnapshot()
    const db = makeFakeDb(snapshot)

    const oldVersion = getPublishedSnapshotHash(snapshot.site)
    bumpPublishVersion()

    // The shell still belongs to the same frozen published site.
    const url = holeUrl('text-node', oldVersion)
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
    const url = holeUrl('text-node', currentVersion)

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
    const url0 = holeUrl('text-node', v0)
    await handleHoleRequest(new Request(url0), url0, { db })
    expect(count()).toBe(1)

    bumpPublishVersion()
    const v1 = getPublishedSnapshotHash(snapshot.site)
    const url1 = holeUrl('text-node', v1)
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
    const url = holeUrl('text-node', version)
    const res = await handleHoleRequest(new Request(url), url, { db: makeFakeDb(snapshot) })

    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('data-instatic-page-token=')
    expect(html).toContain('data-instatic-page-id="page_1"')
  })
})
