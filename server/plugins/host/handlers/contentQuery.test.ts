import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createCapabilityTestHarness, type CapabilityTestHarness } from '../../../../src/__tests__/helpers/capabilityHarness'
import { ContentListResultSchema, ContentTableSummarySchema, type ContentListOptions, type ContentReadOptions } from '@core/plugin-sdk'
import { DataCollectionResultSchema, DataRelationsReadResponseSchema, DataReadGenerationError, RelationResolutionError, RelationValidationError, type DataCollectionQuery, type DataRelationReadInput } from '@core/data-read'
import { Type, parseValue } from '@core/utils/typeboxHelpers'
import { LocalizationError } from '@core/localization'
import { createDataRow, createDataTable, getDataRow } from '../../../repositories/data'
import { getDraftSiteDocument } from '../../../repositories/publish'
import { saveDraftSite } from '../../../repositories/site'
import { MAIN_SCOPE } from '../../../branches/scope'
import type { HostPluginRecord } from '../types'
import { workers } from '../workerState'
import { handleContentEntriesList, handleContentQuery, handleContentRelations, handleContentTablesList } from './content'
import { parseApiCall } from '../../protocol/parser'

describe('native plugin content reads', () => {
  let harness: CapabilityTestHarness
  let plugin: HostPluginRecord
  let reply: unknown
  let ownerEmail: string

  beforeEach(async () => {
    harness = await createCapabilityTestHarness()
    await harness.setupOwner()
    const { rows: [owner] } = await harness.db<{ id: string; email: string }>`SELECT id, email FROM users`
    ownerEmail = owner.email
    await harness.db`UPDATE users SET display_name = ${'Authorized Author'} WHERE id = ${owner.id}`
    const site = (await getDraftSiteDocument(harness.db, MAIN_SCOPE))!
    site.settings.localization = { catalogues: ['it', 'de'].map(language => ({ language, fileId: `language-${language}` })) }
    site.files = ['it', 'de'].map(language => ({
      id: `language-${language}`, path: `languages/${language}.json`, type: 'config' as const, createdAt: 0, updatedAt: 0,
      content: JSON.stringify({ language, messages: { entry: language === 'de'
        ? { title: 'Sicherheit', caption: 'Bildunterschrift', other: 'Zoo', secret: 'Privater Text' }
        : { title: 'Sicurezza', caption: 'Didascalia', other: 'Alfa', secret: 'Privato' } } }),
    }))
    site.files.push({ id: 'private-config', path: 'private.json', type: 'config', createdAt: 0, updatedAt: 0, content: '{"token":"private-token"}' })
    await saveDraftSite(harness.db, MAIN_SCOPE, site)
    const targets = await createDataTable(harness.db, MAIN_SCOPE, {
      id: 'plugin-targets', name: 'Targets', slug: 'targets', kind: 'data', primaryFieldId: 'label',
      singularLabel: 'Target', pluralLabel: 'Targets', fields: [{ id: 'label', label: 'Label', type: 'text' }],
    })
    for (const [id, label] of [['target-z', 'Zulu'], ['target-a', 'Alpha']]) {
      await createDataRow(harness.db, MAIN_SCOPE, { id, tableId: targets.id, slug: id, cells: { label } }, owner.id)
    }
    const table = await createDataTable(harness.db, MAIN_SCOPE, {
      id: 'plugin-articles', name: 'Articles', slug: 'articles', kind: 'postType', primaryFieldId: 'heading',
      singularLabel: 'Article', pluralLabel: 'Articles',
      fields: [
        { id: 'heading', label: 'Heading', type: 'localizedText' },
        { id: 'cards', label: 'Cards', type: 'repeater', fields: [
          { id: 'caption', label: 'Caption', type: 'localizedText' },
          { id: 'related', label: 'Related', type: 'relation', targetTableId: targets.id, allowMultiple: true },
        ] },
        { id: 'literal', label: 'Literal', type: 'text' },
        { id: 'related', label: 'Related', type: 'relation', targetTableId: targets.id, allowMultiple: true },
      ],
    })
    for (const id of ['visible-one', 'visible-two']) {
      await createDataRow(harness.db, MAIN_SCOPE, { id, tableId: table.id, slug: id, cells: {
        heading: { key: 'entry.title' },
        cards: [{ id: 'stable-card', cells: { caption: { key: 'entry.caption' }, related: ['target-z', 'target-a'] } }],
        literal: 'entry.secret', related: ['target-z', 'target-a'], slug: id,
      } }, owner.id)
    }
    await createDataRow(harness.db, MAIN_SCOPE, { id: 'visible-other', tableId: table.id, slug: 'visible-other',
      cells: { heading: { key: 'entry.other' }, related: [], slug: 'visible-other' } }, owner.id)
    const secret = await createDataTable(harness.db, MAIN_SCOPE, {
      id: 'secret-table', name: 'Secret table', slug: 'secret', kind: 'postType',
      singularLabel: 'Secret article', pluralLabel: 'Secret articles',
      fields: [{ id: 'heading', label: 'Heading', type: 'localizedText' }],
    })
    await createDataRow(harness.db, MAIN_SCOPE, { id: 'private-row', tableId: secret.id, slug: 'visible-private',
      cells: { heading: { key: 'entry.secret' } } }, owner.id)
    plugin = {
      manifest: { id: `test.native-query-${crypto.randomUUID()}`, name: 'Native query test', version: '1.0.0', apiVersion: 1,
        permissions: ['cms.content.read', 'cms.content.write'], grantedPermissions: ['cms.content.read', 'cms.content.write'], resources: [], adminPages: [],
        contentAccess: [{ table: 'articles', modes: ['read'] }, { table: 'targets', modes: ['read'] }, { table: 'secret', modes: ['write'] }] },
      assetRootPath: '/tmp/native-query-test', routes: new Map(), hookListeners: [], hookFilters: [], loopSources: [],
      mediaAdapters: [], mediaUrlTransformers: [], inflightFetches: new Map(),
    }
    // Transport-only stub scoped to this plugin; the read service and SQL are real.
    workers.set(plugin.manifest.id, { postMessage: (message: { value?: unknown }) => { reply = message.value } } as Worker)
    reply = undefined
  })

  afterEach(async () => {
    if (plugin?.manifest) workers.delete(plugin.manifest.id)
    if (harness) await harness.cleanup()
  })

  function collection(patch: Partial<DataCollectionQuery> = {}): DataCollectionQuery {
    return { source: { kind: 'table', tableId: 'plugin-articles' }, offset: 0, limit: 100, ...patch }
  }

  async function query(spec = collection(), options: ContentReadOptions = { view: 'draft', language: 'de' }) {
    await handleContentQuery({ kind: 'api-call', target: 'cms.content.query', pluginId: plugin.manifest.id,
      correlationId: 'query', args: [spec, options] }, plugin, harness.db)
    return parseValue(DataCollectionResultSchema, reply)
  }

  async function relations(requests: DataRelationReadInput[], options: ContentReadOptions = { view: 'draft', language: 'de' }) {
    await handleContentRelations({ kind: 'api-call', target: 'cms.content.relations', pluginId: plugin.manifest.id,
      correlationId: 'relations', args: [requests, options] }, plugin, harness.db)
    return parseValue(DataRelationsReadResponseSchema, reply)
  }

  async function list(options: ContentListOptions = {}) {
    await handleContentEntriesList({ kind: 'api-call', target: 'cms.content.entries.list', pluginId: plugin.manifest.id,
      correlationId: 'list', args: ['articles', options] }, plugin, harness.db)
    return parseValue(ContentListResultSchema, reply)
  }

  it('keeps authoring lists raw while native projection precedes filter/order/count/page', async () => {
    const raw = await list({ offset: 0, limit: 3 })
    expect(raw.totalCount).toBe(3)
    expect(raw.entries.find(row => row.id === 'visible-one')!.cells.heading).toEqual({ key: 'entry.title' })
    expect(raw).not.toHaveProperty('localization')
    const page = await query(collection({
      where: { kind: 'field', fieldId: 'heading', operator: 'like', value: '%SICHER%' },
      order: [{ kind: 'field', fieldId: 'heading', direction: 'asc' }], offset: 1, limit: 1,
    }))
    expect(page.cardinalityCount).toBe(3)
    expect(page.totalItems).toBe(2)
    expect(page.items.map(row => row.id)).toEqual(['visible-two'])
    expect(page.items[0].cells.heading).toBe('Sicherheit')
    expect(page.items[0].title).toBe('Sicherheit')
    expect(page.items[0].reference).toEqual({ branchId: MAIN_SCOPE.branchId, view: 'draft', generation: page.generation,
      tableId: 'plugin-articles', rowId: 'visible-two' })
    expect(page.items[0].author?.displayName).toBe('Authorized Author')
    expect(page.items[0].author).not.toHaveProperty('id')
    expect(page.items[0].author).not.toHaveProperty('email')
    expect(page.hasMore).toBe(false)
    expect(page.nextOffset).toBeNull()
    const serialized = JSON.stringify(page)
    for (const privateValue of [ownerEmail, 'Privater Text', 'private-token', 'languages/de.json']) expect(serialized).not.toContain(privateValue)
    expect((await getDataRow(harness.db, MAIN_SCOPE, 'visible-one'))!.cells.heading).toEqual({ key: 'entry.title' })
  })

  it('requires a configured language and keeps ordinary text literal', async () => {
    await expect(query(collection(), { view: 'draft' })).rejects.toBeInstanceOf(LocalizationError)
    await expect(query(collection(), { view: 'draft', language: 'fr' })).rejects.toBeInstanceOf(LocalizationError)
    expect((await query(collection({ where: { kind: 'field', fieldId: 'literal', operator: 'eq', value: 'entry.secret' } }))).totalItems).toBe(2)
    expect((await query(collection({ where: { kind: 'field', fieldId: 'literal', operator: 'eq', value: 'Privater Text' } }))).totalItems).toBe(0)
    expect((await query(collection({ where: { kind: 'field', fieldId: 'heading', operator: 'like', value: '%entry.title%' } }))).totalItems).toBe(0)
  })

  it('searches only declared text fields or the native projected title', async () => {
    expect((await query(collection({ search: { fieldIds: ['heading'], text: 'Sicherheit' }, limit: 1 }))).items).toHaveLength(1)
    expect((await query(collection({ search: { fieldIds: [], title: true, text: 'Sicherheit' } }))).totalItems).toBe(2)
    expect((await query(collection({ search: { fieldIds: ['heading'], text: 'entry.title' } }))).totalItems).toBe(0)
    expect((await query(collection({ search: { fieldIds: ['heading'], text: 'Bildunterschrift' } }))).totalItems).toBe(0)
    expect((await query(collection({ search: { fieldIds: ['literal'], text: 'entry.secret' } }))).totalItems).toBe(2)
    expect((await query(collection({ search: { fieldIds: ['literal'], text: 'Privater' } }))).totalItems).toBe(0)
    await expect(query(collection({ search: { fieldIds: ['cards'], text: 'Bildunterschrift' } }))).rejects.toBeInstanceOf(RelationValidationError)
    await expect(query(collection({ search: { fieldIds: [], text: 'anything' } }))).rejects.toMatchObject({ code: 'invalid_collection_query' })
  })

  it('materializes ordered relations and stable repeater identities without rewriting IDs', async () => {
    const owner = { tableId: 'plugin-articles', rowId: 'visible-one' }
    const request: DataRelationReadInput = { owner, field: { fieldId: 'related' } }
    const result = await relations([request, { owner: { ...owner, repeater: { fieldId: 'cards', itemId: 'stable-card' } }, field: { fieldId: 'related' } }])
    expect(result.relations).toHaveLength(2)
    expect(result.relations[0].items.map(item => item.id)).toEqual(['target-z', 'target-a'])
    expect(result.relations[1].field.repeater).toEqual({ fieldId: 'cards', itemId: 'stable-card' })
    expect(result.relations[1].items.map(item => item.id)).toEqual(['target-z', 'target-a'])
    const sorted = await query(collection({ source: { kind: 'relation', owner, field: { fieldId: 'related' } },
      order: [{ kind: 'row', field: 'title', direction: 'asc' }], limit: 1 }))
    expect(sorted.items.map(item => item.id)).toEqual(['target-a'])
    expect(sorted.cardinalityCount).toBe(2)
    expect(sorted.totalItems).toBe(2)
    expect(sorted.hasMore).toBe(true)
    expect(sorted.nextOffset).toBe(1)
    const stored = (await getDataRow(harness.db, MAIN_SCOPE, owner.rowId))!
    expect(stored.cells.related).toEqual(['target-z', 'target-a'])
    expect(stored.cells.cards).toEqual([{ id: 'stable-card', cells: { caption: { key: 'entry.caption' }, related: ['target-z', 'target-a'] } }])
  })

  it('admits source and targets, including empty membership, and rejects incomplete membership', async () => {
    plugin.manifest.contentAccess = [{ table: 'articles', modes: ['read'] }, { table: 'targets', modes: ['write'] }]
    const request: DataRelationReadInput = { owner: { tableId: 'plugin-articles', rowId: 'visible-one' }, field: { fieldId: 'related' } }
    await expect(relations([request])).rejects.toMatchObject({ code: 'relation_unavailable' })
    await expect(relations([{ ...request, owner: { ...request.owner, rowId: 'visible-other' } }])).rejects.toMatchObject({ code: 'relation_unavailable' })
    plugin.manifest.contentAccess.push({ table: 'targets', modes: ['read'] })
    await harness.db`UPDATE data_rows SET deleted_at = ${'2026-10-01T00:00:00.000Z'} WHERE id = ${'target-a'}`
    await expect(relations([request])).rejects.toBeInstanceOf(RelationResolutionError)
    await expect(query(collection({ source: { kind: 'relation', owner: request.owner, field: request.field }, limit: 1 }))).rejects.toMatchObject({ code: 'relation_unavailable' })
  })

  it('does not distinguish unauthorized corrupt schema from unauthorized or missing tables', async () => {
    async function diagnostic(tableId: string) {
      try { await query(collection({ source: { kind: 'table', tableId } })); throw new Error('Expected unavailable collection') }
      catch (error) {
        expect(error).toBeInstanceOf(RelationResolutionError)
        if (!(error instanceof RelationResolutionError)) throw error
        return { code: error.code, path: error.path, message: error.message }
      }
    }
    const privateDiagnostic = await diagnostic('secret-table')
    await harness.db`UPDATE data_tables SET fields_json = ${{ invalid: 'private corrupt schema' }} WHERE id = ${'secret-table'}`
    expect(await diagnostic('secret-table')).toEqual(privateDiagnostic)
    expect(await diagnostic('missing-table')).toEqual(privateDiagnostic)
    await handleContentTablesList({ kind: 'api-call', target: 'cms.content.tables.list', pluginId: plugin.manifest.id,
      correlationId: 'tables', args: [] }, plugin, harness.db)
    const tables = parseValue(Type.Array(ContentTableSummarySchema), reply)
    expect(tables.map(table => table.id).sort()).toEqual(['plugin-articles', 'plugin-targets'])
    plugin.manifest.grantedPermissions = ['cms.content.write']
    await expect(query()).rejects.toThrow('cms.content.read')
  })

  it('uses active content versions for public post types and live records for generic data', async () => {
    await harness.db`INSERT INTO data_row_versions (id, row_id, version_number, cells_json, slug)
      VALUES (${'article-version'}, ${'visible-one'}, ${1}, ${{ heading: { key: 'entry.other' }, related: ['target-a'] }}, ${'published-one'})`
    await harness.db`UPDATE data_rows SET status = ${'published'}, active_version_id = ${'article-version'} WHERE id = ${'visible-one'}`
    const draft = await query()
    const published = await query(collection(), { view: 'public', language: 'de' })
    expect(draft.totalItems).toBe(3)
    expect(draft.items.find(row => row.id === 'visible-one')!.title).toBe('Sicherheit')
    expect(published.items.map(row => row.id)).toEqual(['visible-one'])
    expect(published.items[0].title).toBe('Zoo')
    expect(published.items[0].slug).toBe('published-one')
    expect(published.items[0].version).toEqual({ id: 'article-version', number: 1 })
    expect(published.items[0].reference.view).toBe('public')
    const generic = await query(collection({ source: { kind: 'table', tableId: 'plugin-targets' } }), { view: 'public' })
    expect(generic.items.map(row => row.id).sort()).toEqual(['target-a', 'target-z'])
    expect(generic.items.every(row => row.version === null)).toBe(true)
  })

  it('carries the captured generation through pages and rejects stale continuation', async () => {
    const first = await query(collection({ limit: 1 }))
    const next = await query(collection({ offset: 1, limit: 1 }), { view: 'draft', language: 'de', generation: first.generation })
    expect(next.generation).toBe(first.generation)
    await harness.db`UPDATE data_rows SET cells_json = ${{ label: 'Changed' }} WHERE id = ${'target-z'}`
    await expect(query(collection(), { view: 'draft', language: 'de', generation: first.generation })).rejects.toBeInstanceOf(DataReadGenerationError)
  })

  it('validates native source, page, explicit view and relation identity at the wire boundary', () => {
    const base = { kind: 'api-call', pluginId: plugin.manifest.id, correlationId: 'wire' }
    expect(() => parseApiCall({ ...base, target: 'cms.content.query', args: [collection(), { view: 'draft', language: 'de' }] })).not.toThrow()
    expect(() => parseApiCall({ ...base, target: 'cms.content.query', args: [collection(), {}] })).toThrow()
    expect(() => parseApiCall({ ...base, target: 'cms.content.query', args: [collection({ limit: 501 }), { view: 'draft' }] })).toThrow()
    expect(() => parseApiCall({ ...base, target: 'cms.content.query', args: [collection(), { view: 'public', generation: '' }] })).toThrow()
    expect(() => parseApiCall({ ...base, target: 'cms.content.relations', args: [[{ owner: { tableId: 'plugin-articles', rowId: 'visible-one', branchId: 'claimed-branch' }, field: { fieldId: 'related' } }], { view: 'draft' }] })).toThrow()
    expect(() => parseApiCall({ ...base, target: 'cms.content.entries.list', args: ['articles', { language: 'de' }] })).toThrow()
    expect(() => parseApiCall({ ...base, target: 'cms.content.entries.list', args: ['articles', { filter: { literal: 'value' } }] })).toThrow()
    expect(() => parseApiCall({ ...base, target: 'cms.content.search', args: ['query', {}] })).toThrow()
  })
})
