/**
 * Tests for the `/_instatic/module-js/<moduleId>.js` asset endpoint.
 * Fake DbClient intercepts the published-snapshot query — same pattern as
 * holeRouteHandler.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DbClient, DbResult } from '../../../server/db'
import {
  handleModuleJsAssetRequest,
  isModuleJsAssetPath,
} from '../../../server/handlers/cms/moduleJs'
import { resetForTests } from '../../../server/publish/renderCache'
import { makeModule } from '../publisher/helpers'
import { registry } from '../../core/module-engine/registry'
import { moduleJsAssetPath } from '../../../server/publish/moduleJsBundle'
import { prepareInactiveSlot, swapSlot, writeStaticAsset } from '../../../server/publish/staticArtefact'
import { createFakeDb } from './dbTestFake'

let uploadsDir: string | undefined
afterEach(async () => {
  if (uploadsDir) await rm(uploadsDir, { recursive: true, force: true })
  uploadsDir = undefined
})

const noSnapshotReads = createFakeDb(async () => { throw new Error('Static module assets must not read the database') })

function makeSnapshot() {
  return {
    cmsSnapshotVersion: 1 as const,
    pageRowId: 'page_1',
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
              children: ['widget'],
              classIds: [],
            },
            widget: {
              id: 'widget',
              moduleId: 'test.jsy',
              props: {},
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

function makeFakeDb(snapshot: ReturnType<typeof makeSnapshot> | null): DbClient {
  const handle = async <Row extends Record<string, unknown> = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ..._values: unknown[]
  ): Promise<DbResult<Row>> => {
    const sql = strings.reduce<string>((acc, str, i) => (i === 0 ? str : `${acc}$${i}${str}`), '')
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    // The snapshot getters join site_snapshots and reassemble the
    // PublishedPageSnapshot shape from this row (see repositories/publish.ts).
    if (normalized.includes('site_snapshots.site_json')) {
      return {
        rows: snapshot
          ? [{
              row_id: snapshot.pageRowId,
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

function moduleJsRequest(path: string, method = 'GET'): [Request, URL] {
  const url = new URL(`http://localhost${path}`)
  return [new Request(url, { method }), url]
}

beforeEach(() => {
  resetForTests()
  registry.registerOrReplace(
    makeModule('test.body', {
      canHaveChildren: true,
      render: (_p, children) => ({ html: `<div>${children.join('')}</div>` }),
    }),
  )
  registry.registerOrReplace(
    makeModule('test.jsy', {
      assets: { js: '(function(){/* test runtime */})();' },
      render: () => ({ html: '<div></div>' }),
    }),
  )
})

describe('isModuleJsAssetPath', () => {
  it('matches the namespace prefix only', () => {
    expect(isModuleJsAssetPath('/_instatic/module-js/test.jsy.js')).toBe(true)
    expect(isModuleJsAssetPath('/_instatic/module-js/')).toBe(true)
    expect(isModuleJsAssetPath('/_instatic/module-js')).toBe(false)
    expect(isModuleJsAssetPath('/_instatic/hole-runtime.js')).toBe(false)
  })
})

describe('handleModuleJsAssetRequest', () => {
  it('serves the active generation after a process-cache reset without reading the site or registry', async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), 'module-js-route-'))
    const prepared = await prepareInactiveSlot(uploadsDir)
    const path = moduleJsAssetPath('test.jsy')
    await writeStaticAsset(prepared.slotDir, path, new TextEncoder().encode('PUBLISHED_GENERATION'))
    await swapSlot(uploadsDir, prepared.slot)
    resetForTests()
    registry.unregister('test.jsy')
    const [req, url] = moduleJsRequest(path + '?v=1')
    const response = await handleModuleJsAssetRequest(req, url, { db: noSnapshotReads, uploadsDir })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('PUBLISHED_GENERATION')
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('public, no-cache')
    const same = new Request(url, { headers: { 'if-none-match': response.headers.get('etag')! } })
    const revalidated = await handleModuleJsAssetRequest(same, url, { db: noSnapshotReads, uploadsDir })
    expect(revalidated.status).toBe(304)
    expect(await revalidated.text()).toBe('')

    // A missing script is authoritative when disk publication is enabled.
    const [unknown, unknownUrl] = moduleJsRequest(moduleJsAssetPath('test.unknown'))
    expect((await handleModuleJsAssetRequest(unknown, unknownUrl, { db: noSnapshotReads, uploadsDir })).status).toBe(404)
    const [invalid, invalidUrl] = moduleJsRequest('/_instatic/module-js/%E0%A4%A.js')
    expect((await handleModuleJsAssetRequest(invalid, invalidUrl, { db: noSnapshotReads, uploadsDir })).status).toBe(404)
  })

  it('serves changed module bytes only after activating the next complete slot', async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), 'module-js-swap-'))
    const path = moduleJsAssetPath('test.jsy')
    const initial = await prepareInactiveSlot(uploadsDir)
    await writeStaticAsset(initial.slotDir, path, new TextEncoder().encode('OLD'))
    await swapSlot(uploadsDir, initial.slot)
    const next = await prepareInactiveSlot(uploadsDir)
    await writeStaticAsset(next.slotDir, path, new TextEncoder().encode('NEW'))
    const [req, url] = moduleJsRequest(path + '?v=1')
    const old = await handleModuleJsAssetRequest(req, url, { db: noSnapshotReads, uploadsDir })
    expect(await old.text()).toBe('OLD')
    await swapSlot(uploadsDir, next.slot)
    resetForTests() // A restarted server can publish the same process-local version.
    const reusingVersion = new Request(url, { headers: { 'if-none-match': old.headers.get('etag')! } })
    const changed = await handleModuleJsAssetRequest(reusingVersion, url, { db: noSnapshotReads, uploadsDir })
    expect(changed.status).toBe(200)
    expect(changed.headers.get('etag')).not.toBe(old.headers.get('etag'))
    expect(await changed.text()).toBe('NEW')
  })

  it('serves a known module with text/javascript and mandatory cache revalidation', async () => {
    const [req, url] = moduleJsRequest('/_instatic/module-js/test.jsy.js?v=0')
    const res = await handleModuleJsAssetRequest(req, url, { db: makeFakeDb(makeSnapshot()) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('public, no-cache')
    expect(await res.text()).toContain('test runtime')
  })

  it('404s for a moduleId with no published js', async () => {
    const [req, url] = moduleJsRequest('/_instatic/module-js/test.body.js')
    const res = await handleModuleJsAssetRequest(req, url, { db: makeFakeDb(makeSnapshot()) })
    expect(res.status).toBe(404)
  })

  it('404s for malformed / traversal-shaped ids without touching the map', async () => {
    for (const path of [
      '/_instatic/module-js/..%2F..%2Fetc%2Fpasswd.js',
      '/_instatic/module-js/UPPER.Case.js',
      '/_instatic/module-js/no-namespace.js',
      '/_instatic/module-js/test.jsy', // missing .js extension
      '/_instatic/module-js/',
      '/_instatic/module-js/%E0%A4%A.js', // invalid URI encoding
    ]) {
      const [req, url] = moduleJsRequest(path)
      const res = await handleModuleJsAssetRequest(req, url, { db: makeFakeDb(makeSnapshot()) })
      expect(res.status).toBe(404)
    }
  })

  it('404s when the site has never been published', async () => {
    const [req, url] = moduleJsRequest('/_instatic/module-js/test.jsy.js')
    const res = await handleModuleJsAssetRequest(req, url, { db: makeFakeDb(null) })
    expect(res.status).toBe(404)
  })

  it('405s non-GET methods', async () => {
    const [req, url] = moduleJsRequest('/_instatic/module-js/test.jsy.js', 'POST')
    const res = await handleModuleJsAssetRequest(req, url, { db: makeFakeDb(makeSnapshot()) })
    expect(res.status).toBe(405)
  })
})
