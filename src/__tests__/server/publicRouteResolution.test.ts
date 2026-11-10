import { beforeEach, describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db'
import { resolvePublicRoute } from '../../../server/publish/publicRouteResolution'
import { resetPublishStateForTests } from '../../../server/publish/publishState'
import type { PublishedPageSnapshot } from '../../../server/repositories/publish'
import { makePage, makeSite } from '../publisher/helpers'

const runtimeAssets = {
  scripts: [{
    fileId: 'script-page',
    src: '/_instatic/assets/script-page.js',
    format: 'module' as const,
    placement: 'body-end' as const,
    timing: 'dom-ready' as const,
    priority: 100,
  }],
}

function makeSnapshot(
  siteSnapshotId: string,
  name: string,
  pageRuntimeAssets: PublishedPageSnapshot['runtimeAssets'] | null = runtimeAssets,
): PublishedPageSnapshot {
  const page = makePage({ root: { moduleId: 'base.body', children: [] } })
  page.id = 'page-route'
  page.slug = 'about'
  return {
    cmsSnapshotVersion: 1,
    pageRowId: page.id,
    siteSnapshotId,
    site: makeSite({ pages: [page], name }),
    ...(pageRuntimeAssets ? { runtimeAssets: pageRuntimeAssets } : {}),
  }
}

function makeDb(routeSnapshot: PublishedPageSnapshot, latestSnapshot: PublishedPageSnapshot) {
  let fullPageJsonReads = 0
  const handle = async <Row extends Record<string, unknown> = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ..._values: unknown[]
  ): Promise<DbResult<Row>> => {
    const sql = strings.join(' ').replace(/\s+/g, ' ').trim().toLowerCase()
    if (sql.includes('site_snapshots.site_json')) {
      if (sql.includes('data_row_versions.slug =')) {
        fullPageJsonReads += 1
        return {
          rows: [{
            row_id: routeSnapshot.pageRowId,
            site_snapshot_id: routeSnapshot.siteSnapshotId,
            site_json: routeSnapshot.site,
            runtime_assets_json: routeSnapshot.runtimeAssets ?? null,
            importmap_body: null,
            importmap_sha256: null,
          } as unknown as Row],
          rowCount: 1,
        }
      }
      return {
        rows: [{
          row_id: latestSnapshot.pageRowId,
          site_snapshot_id: latestSnapshot.siteSnapshotId,
          site_json: latestSnapshot.site,
          runtime_assets_json: null,
          importmap_body: null,
          importmap_sha256: null,
        } as unknown as Row],
        rowCount: 1,
      }
    }
    if (sql.includes('data_row_versions.site_snapshot_id') && sql.includes('data_row_versions.slug =')) {
      return {
        rows: [{
          row_id: routeSnapshot.pageRowId,
          site_snapshot_id: routeSnapshot.siteSnapshotId,
          runtime_assets_json: routeSnapshot.runtimeAssets ?? null,
        } as unknown as Row],
        rowCount: 1,
      }
    }
    return { rows: [], rowCount: 0 }
  }
  handle.transaction = async <T>(callback: (tx: DbClient) => Promise<T>): Promise<T> =>
    callback(handle as unknown as DbClient)
  handle.unsafe = async <Row extends Record<string, unknown> = Record<string, unknown>>() => ({ rows: [] as Row[], rowCount: 0 })
  return { db: handle as DbClient, fullPageJsonReads: () => fullPageJsonReads }
}

describe('resolvePublicRoute snapshot reuse', () => {
  beforeEach(resetPublishStateForTests)

  it('reuses the memoized site document when the active page references the same immutable snapshot', async () => {
    const routeSnapshot = makeSnapshot('snapshot-current', 'Published current site')
    const latestSnapshot = makeSnapshot('snapshot-current', 'Published current site')
    const { db, fullPageJsonReads } = makeDb(routeSnapshot, latestSnapshot)

    const result = await resolvePublicRoute(db, new URL('https://example.test/about'))

    expect(result.kind).toBe('page')
    if (result.kind !== 'page') throw new Error('Expected a page route')
    expect(result.snapshot.site).toBe(latestSnapshot.site)
    expect(result.snapshot.pageRowId).toBe(routeSnapshot.pageRowId)
    expect(result.snapshot.runtimeAssets).toEqual(runtimeAssets)
    expect(fullPageJsonReads()).toBe(0)
  })

  it('loads the exact page snapshot when its immutable id differs from the memoized site snapshot', async () => {
    const routeSnapshot = makeSnapshot('snapshot-page-version', 'Page version site')
    const latestSnapshot = makeSnapshot('snapshot-current', 'Current site')
    const { db, fullPageJsonReads } = makeDb(routeSnapshot, latestSnapshot)

    const result = await resolvePublicRoute(db, new URL('https://example.test/about'))

    expect(result.kind).toBe('page')
    if (result.kind !== 'page') throw new Error('Expected a page route')
    expect(result.snapshot.site).toEqual(routeSnapshot.site)
    expect(result.snapshot.site.name).toBe('Page version site')
    expect(result.snapshot.siteSnapshotId).toBe('snapshot-page-version')
    expect(result.snapshot.runtimeAssets).toEqual(runtimeAssets)
    expect(fullPageJsonReads()).toBe(1)
  })

  it('does not inherit a site-level runtime manifest when the page route has none', async () => {
    const routeSnapshot = makeSnapshot('snapshot-current', 'Published current site', null)
    const latestSnapshot = makeSnapshot('snapshot-current', 'Published current site', runtimeAssets)
    const { db } = makeDb(routeSnapshot, latestSnapshot)

    const result = await resolvePublicRoute(db, new URL('https://example.test/about'))

    expect(result.kind).toBe('page')
    if (result.kind !== 'page') throw new Error('Expected a page route')
    expect(result.snapshot.runtimeAssets).toBeUndefined()
  })
})
