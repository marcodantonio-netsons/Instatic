import { beforeEach, describe, expect, it } from 'bun:test'
import { handleLoopRequest } from '../../../server/handlers/cms/loop'
import { renderPublishedSnapshot, renderPublishedDataRowTemplate, renderPublishedNotFound } from '../../../server/publish/publicRenderer'
import { getLatestPublishedSiteSnapshot, getPublishedPageBySlug } from '../../../server/repositories/publish'
import { getPublishedDataRowByRoute } from '../../../server/repositories/data/publish'
import { bumpPublishVersion, getPublishVersion, resetPublishStateForTests } from '../../../server/publish/publishState'
import { readEnvelope } from '@core/http'
import { LoopPageResponseSchema } from '@core/loops-schema'
import { createPublishedLoopFixture, LOOP_TEST_LANGUAGES, publishedLoopSite } from '../helpers/publishedLoopFixture'
import { makeNode, makePage } from '../fixtures'
import type { DbClient } from '../../../server/db'
import { getPublishedSnapshotHash } from '../../../server/publish/publishedSnapshotCache'
import { prepareInactiveSlot, readArtefact, swapSlot, writeArtefact } from '../../../server/publish/staticArtefact'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loopSourceRegistry } from '@core/loops/registry'

beforeEach(() => resetPublishStateForTests())

async function request(db: DbClient, pagePath: string | null, loopId = 'shared-loop', extra: Record<string, string> = {}) {
  const url = new URL(`http://localhost/_instatic/loop/${loopId}`)
  url.searchParams.set('page', '2')
  const snapshot = await getPublishedPageBySlug(db, 'en/listing') ?? await getLatestPublishedSiteSnapshot(db)
  if (!snapshot) throw new Error('The test requires a published site')
  url.searchParams.set('v', getPublishedSnapshotHash(snapshot.site))
  if (pagePath !== null) url.searchParams.set('pagePath', pagePath)
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value)
  return handleLoopRequest(new Request(url), url, { db })
}

describe('published loop fragments', () => {
  it('renders the same shared component in nine language routes with effective params, slots, file and native frames', async () => {
    const fixture = await createPublishedLoopFixture()
    try {
      const before = structuredClone(fixture.site)
      for (const language of LOOP_TEST_LANGUAGES) {
        const path = `/${language}/listing?category=cloud&loop_other_page=3`
        const snapshot = await getPublishedPageBySlug(fixture.db, `${language}/listing`)
        const rendered = await renderPublishedSnapshot(snapshot!, { db: fixture.db, url: new URL(path, 'http://localhost') })
        expect(rendered.html).toContain(`data-instatic-loop-load-more-label="${language} more"`)
        expect(rendered.html).toContain(`data-instatic-loop-loading-label="${language} loading"`)
        expect(rendered.html).toContain(`data-instatic-loop-retry-label="${language} retry"`)
        const fragment = await readEnvelope(await request(fixture.db, path), LoopPageResponseSchema, 'Loop failed')
        expect(fragment.pageNumber).toBe(2)
        expect(fragment.hasMore).toBe(true)
        expect(fragment.html).toContain(`Heading ${language}`)
        expect(fragment.html).toContain(`${language} card|${language}|${language}|Page ${language}|/${language}/listing|Published loop site|/${language}/listing|Beta`)
        expect(fragment.html).toContain('href="/manual.pdf"')
        expect(fragment.html).toContain('Slot Beta/')
        expect(fragment.html).not.toContain('{')
        expect(fragment.html).not.toContain('Draft')
      }
      expect(fixture.site).toEqual(before)
    } finally { await fixture.cleanup() }
  })

  it('uses the published row as the parent entry on an entry route wrapped by a layout', async () => {
    const site = publishedLoopSite()
    const template = makePage({ id: 'entry', slug: 'entry', language: 'en', title: 'Entry template',
      template: { enabled: true, target: { kind: 'postTypes', tableSlugs: ['posts'] }, priority: 1 }, nodes: {
        root: makeNode({ id: 'root', moduleId: 'base.body', children: ['ref', 'outlet'] }),
        ref: makeNode({ id: 'ref', moduleId: 'base.visual-component-ref', props: { componentId: 'listing', propOverrides: { heading: 'Entry heading' } }, children: ['fill'] }),
        fill: makeNode({ id: 'fill', moduleId: 'base.slot-instance', props: { slotName: 'cards' }, children: ['slot-entry'] }),
        'slot-entry': makeNode({ id: 'slot-entry', moduleId: 'base.text', props: { text: '{parentEntry.title}/{currentEntry.title}' } }),
        outlet: makeNode({ id: 'outlet', moduleId: 'base.outlet' }),
      },
    })
    site.pages.push(template)
    const fixture = await createPublishedLoopFixture(site)
    try {
      const snapshot = await getPublishedPageBySlug(fixture.db, 'entry')
      const row = await getPublishedDataRowByRoute(fixture.db, '/posts', 'alpha')
      const initial = await renderPublishedDataRowTemplate(snapshot!, row!, { db: fixture.db, url: new URL('http://localhost/posts/alpha?category=cloud') })
      expect(initial?.html).toContain('en card|en|en|Alpha|')
      const fragment = await readEnvelope(await request(fixture.db, '/posts/alpha?category=cloud'), LoopPageResponseSchema, 'Loop failed')
      expect(fragment.html).toContain('en card|en|en|Alpha|')
      expect(fragment.html).toContain('|/posts/alpha|Beta')
      expect(fragment.html).toContain('Alpha/Beta')
    } finally { await fixture.cleanup() }
  })

  it('uses the canonical 404 render context when the public URL renders the not-found template', async () => {
    const site = publishedLoopSite()
    const page = structuredClone(site.pages[1])
    page.id = 'not-found'
    page.slug = 'not-found-template'
    page.title = 'Not found'
    delete page.translationGroup
    page.template = { enabled: true, target: { kind: 'notFound' }, priority: 0 }
    site.pages.push(page)
    const fixture = await createPublishedLoopFixture(site)
    try {
      const snapshot = await getPublishedPageBySlug(fixture.db, page.slug)
      const initial = await renderPublishedNotFound(snapshot!, { db: fixture.db, url: new URL('http://localhost/404') })
      expect(initial?.html).toContain('|/404|')
      const fragment = await readEnvelope(await request(fixture.db, '/missing?category=ignored'), LoopPageResponseSchema, 'Loop failed')
      expect(fragment.html).toContain('en card|en|en|Not found|')
      expect(fragment.html).toContain('|/404|Beta')
    } finally { await fixture.cleanup() }
  })

  it('rejects missing or foreign originating URLs and invalid request boundaries', async () => {
    const fixture = await createPublishedLoopFixture()
    try {
      for (const path of [null, 'en/listing', 'https://other.test/en/listing', '//other.test/en/listing', '/en/listing#section', '/%ZZ']) {
        const response = await request(fixture.db, path)
        expect(response.status).toBe(400)
        expect(await response.json()).toHaveProperty('error')
      }
      expect((await request(fixture.db, '/en/listing', 'shared-loop', { page: '2x' })).status).toBe(400)
      expect((await request(fixture.db, '/en/listing', 'shared-loop', { v: '' })).status).toBe(400)
    } finally { await fixture.cleanup() }
  })

  it('preserves the originating query for request-time native bindings without creating a new filter model', async () => {
    const site = publishedLoopSite()
    site.visualComponents[0].tree.nodes.context.props.text = '{route.path}|{route.query.search}|{route.query.category}|{route.query.loop_other_page}|{currentEntry.title}'
    const fixture = await createPublishedLoopFixture(site)
    try {
      const fragment = await readEnvelope(await request(fixture.db, '/en/listing?search=web+hosting&category=cloud&loop_other_page=3'), LoopPageResponseSchema, 'Loop failed')
      expect(fragment.html).toContain('/en/listing|web hosting|cloud|3|Beta')
    } finally { await fixture.cleanup() }
  })

  it('does not locate a loop on an unpublished route or an unrelated page from the site snapshot', async () => {
    const fixture = await createPublishedLoopFixture()
    try {
      await fixture.db`update data_rows set status = 'draft' where id = 'page-en'`
      expect((await request(fixture.db, '/en/listing')).status).toBe(404)
      expect((await request(fixture.db, '/fr/listing', 'missing')).status).toBe(404)
      expect((await request(fixture.db, '/layout')).status).toBe(404)
    } finally { await fixture.cleanup() }
  })

  it('keeps the requested route snapshot authoritative when another published page references a different site generation', async () => {
    const fixture = await createPublishedLoopFixture()
    try {
      const other = structuredClone(fixture.site)
      other.name = 'Another publication'
      other.files.find((file) => file.id === 'manual')!.path = 'public/another-manual.pdf'
      await fixture.db`insert into site_snapshots (id, site_json, content_hash) values ('other-snapshot', ${other}, 'other')`
      await fixture.db`update data_rows set created_at = '2000-01-01T00:00:00.000Z' where id = 'page-it'`
      await fixture.db`update data_row_versions set site_snapshot_id = 'other-snapshot' where row_id = 'page-it'`
      const fragment = await readEnvelope(await request(fixture.db, '/en/listing'), LoopPageResponseSchema, 'Loop failed')
      expect(fragment.html).toContain('|Published loop site|/en/listing|Beta')
      expect(fragment.html).toContain('href="/manual.pdf"')
      expect(fragment.html).not.toContain('Another publication')
      expect(fragment.html).not.toContain('another-manual')
    } finally { await fixture.cleanup() }
  })

  it('rejects a stale frozen-site fingerprint and numeric counter tokens', async () => {
    const fixture = await createPublishedLoopFixture()
    try {
      const oldHash = getPublishedSnapshotHash(fixture.site)
      const changedSite = { ...fixture.site, name: 'Changed publication' }
      await fixture.db`insert into site_snapshots (id,site_json,content_hash) values ('changed',${changedSite},'changed')`
      await fixture.db`update data_row_versions set site_snapshot_id='changed' where site_snapshot_id='loop-snapshot'`
      bumpPublishVersion()
      const response = await request(fixture.db, '/en/listing', 'shared-loop', { v: oldHash })
      expect(response.status).toBe(409)
      expect(await response.json()).toHaveProperty('error')
      expect((await request(fixture.db, '/en/listing', 'shared-loop', { v: '6' })).status).toBe(400)
    } finally { await fixture.cleanup() }
  })

  it('continues the same baked HTML after unrelated invalidation and a process-state restart without republishing', async () => {
    const fixture = await createPublishedLoopFixture()
    const dir = await mkdtemp(join(tmpdir(), 'loop-fingerprint-restart-'))
    try {
      for (let i = 0; i < 6; i++) bumpPublishVersion()
      const snapshot = (await getPublishedPageBySlug(fixture.db, 'en/listing'))!
      const rendered = await renderPublishedSnapshot(snapshot, { db: fixture.db, url: new URL('http://localhost/en/listing') })
      const slot = await prepareInactiveSlot(dir)
      await writeArtefact(slot.slotDir, '/en/listing', rendered.html)
      await swapSlot(dir, slot.slot)
      const before = await readArtefact(dir, '/en/listing')
      const stamp = before!.match(/data-instatic-loop-version="([a-f0-9]{64})"/)![1]
      expect(stamp).toBe(getPublishedSnapshotHash(snapshot.site))
      bumpPublishVersion()
      const next = async () => readEnvelope(await request(fixture.db, '/en/listing', 'shared-loop', { v: stamp }), LoopPageResponseSchema, 'Loop failed')
      expect((await next()).html).toContain('Beta')
      resetPublishStateForTests()
      expect(getPublishVersion()).toBe(0)
      expect(await readArtefact(dir, '/en/listing')).toBe(before)
      expect((await next()).html).toContain('Beta')
      expect(await readArtefact(dir, '/en/listing')).toBe(before)
    } finally { await fixture.cleanup(); await rm(dir, { recursive: true, force: true }) }
  })

  it('rechecks the route fingerprint after I/O, accepting cache-only bumps and rejecting changed publications', async () => {
    const dataRows = loopSourceRegistry.get('data.rows')
    if (!dataRows || dataRows.kind === 'contextual') throw new Error('The data.rows source must be prefetched')
    for (const mode of ['cache-only', 'new-site'] as const) {
      const site = publishedLoopSite()
      const sourceId = `test.snapshot-${mode}`
      site.visualComponents[0].tree.nodes['shared-loop'].props.sourceId = sourceId
      const fixture = await createPublishedLoopFixture(site)
      let fetches = 0
      loopSourceRegistry.register({ ...dataRows, id: sourceId, async fetch(context) {
        fetches++
        const result = await dataRows.fetch(context)
        if (mode === 'new-site') {
          const changedSite = { ...site, name: 'Published during fetch' }
          await fixture.db`insert into site_snapshots (id,site_json,content_hash) values ('during-fetch',${changedSite},'changed')`
          await fixture.db`update data_row_versions set site_snapshot_id='during-fetch' where site_snapshot_id='loop-snapshot'`
        }
        bumpPublishVersion()
        return result
      } })
      try {
        const response = await request(fixture.db, '/en/listing')
        expect(response.status).toBe(mode === 'cache-only' ? 200 : 409)
        if (mode === 'cache-only') {
          const body = await readEnvelope(response, LoopPageResponseSchema, 'Loop failed')
          expect(body.html).toContain('Beta')
        }
        expect(fetches).toBe(1)
      } finally { loopSourceRegistry.unregister(sourceId); await fixture.cleanup() }
    }
  })

  it('rejects duplicate component instances and loops inside an unrecoverable outer iteration', async () => {
    for (const mode of ['duplicate', 'nested'] as const) {
      const site = publishedLoopSite()
      const page = site.pages[1]
      if (mode === 'duplicate') {
        page.nodes.root.children.push('ref2')
        page.nodes.ref2 = makeNode({ id: 'ref2', moduleId: 'base.visual-component-ref', props: { componentId: 'listing' } })
      } else {
        page.nodes.root.children = ['outer']
        page.nodes.outer = makeNode({ id: 'outer', moduleId: 'base.loop', children: ['ref'], props: { sourceId: 'data.rows', filters: { tableId: 'posts' } } })
      }
      const fixture = await createPublishedLoopFixture(site)
      try {
        const response = await request(fixture.db, '/en/listing')
        expect(response.status).toBe(422)
        expect(await response.json()).toHaveProperty('error')
      } finally { await fixture.cleanup() }
    }
  })

  it('returns typed validation envelopes for missing published translations and public file references', async () => {
    for (const token of ['{site.translations.loop.missing}', '{file.missing.url}']) {
      const site = publishedLoopSite()
      site.visualComponents[0].tree.nodes.context.props.text = token
      const fixture = await createPublishedLoopFixture(site)
      try {
        const response = await request(fixture.db, '/en/listing')
        expect(response.status).toBe(422)
        expect(await response.json()).toHaveProperty('error')
      } finally { await fixture.cleanup() }
    }
  })
})
