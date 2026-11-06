import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createCapabilityTestHarness, type CapabilityTestHarness } from '../helpers/capabilityHarness'
import { MAIN_SCOPE } from '../../../server/branches/scope'
import { createDataRow, createDataTable, readableLocalizedDataKeys } from '../../../server/repositories/data'
import { getDraftSiteDocument } from '../../../server/repositories/publish'
import { saveDraftSite } from '../../../server/repositories/site'

describe('data read admission before private schema validation', () => {
  let harness: CapabilityTestHarness

  beforeEach(async () => {
    harness = await createCapabilityTestHarness()
    await harness.setupOwner()
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  async function corruptSchema(tableId: string) {
    await harness.db`UPDATE data_tables SET fields_json = ${[{ id: 'private-field', label: 'Private field', type: 'unknown-private-type' }]} WHERE id = ${tableId}`
  }

  it('hides a corrupt inaccessible schema from table lookup and list readers', async () => {
    const readable = await createDataTable(harness.db, MAIN_SCOPE, {
      id: 'readable', name: 'Readable', slug: 'readable', singularLabel: 'Entry', pluralLabel: 'Entries',
    })
    const persona = await harness.createRoleUser({ name: 'Custom schema reader', slug: 'custom-schema-reader', capabilities: ['data.custom.tables.read'] })
    await corruptSchema('posts')

    const privateResponse = await harness.cms('/admin/api/cms/data/tables/posts', { cookie: persona.cookie })
    const missingResponse = await harness.cms('/admin/api/cms/data/tables/missing', { cookie: persona.cookie })
    expect(privateResponse.status).toBe(404)
    expect(missingResponse.status).toBe(404)
    expect(await privateResponse.json()).toEqual(await missingResponse.json())
    const listing = await harness.cms('/admin/api/cms/data/tables', { cookie: persona.cookie })
    expect(listing.status).toBe(200)
    expect(await listing.json()).toMatchObject({ tables: [{ id: readable.id }] })
  })

  it('admits table identity before rows, loop previews, catalogue projection and row lookup', async () => {
    const row = await createDataRow(harness.db, MAIN_SCOPE, { id: 'private-row', tableId: 'posts', cells: { title: 'Private title' } })
    const persona = await harness.createRoleUser({ name: 'Custom row reader', slug: 'custom-row-reader', capabilities: ['data.custom.tables.read', 'content.edit.any'] })
    await corruptSchema('posts')

    for (const suffix of ['/rows', '/loop-preview']) {
      const privateResponse = await harness.cms(`/admin/api/cms/data/tables/posts${suffix}`, { cookie: persona.cookie })
      const missingResponse = await harness.cms(`/admin/api/cms/data/tables/missing${suffix}`, { cookie: persona.cookie })
      expect(privateResponse.status).toBe(404)
      expect(missingResponse.status).toBe(404)
      expect(await privateResponse.json()).toEqual(await missingResponse.json())
    }
    const privateCatalogue = await harness.cms('/admin/api/cms/data/localization?table=posts&language=it', { cookie: persona.cookie })
    const missingCatalogue = await harness.cms('/admin/api/cms/data/localization?table=missing&language=it', { cookie: persona.cookie })
    expect(privateCatalogue.status).toBe(404)
    expect(missingCatalogue.status).toBe(404)
    expect(await privateCatalogue.json()).toEqual(await missingCatalogue.json())
    const privateRow = await harness.cms(`/admin/api/cms/data/rows/${row.id}`, { cookie: persona.cookie })
    const missingRow = await harness.cms('/admin/api/cms/data/rows/missing', { cookie: persona.cookie })
    expect(privateRow.status).toBe(404)
    expect(missingRow.status).toBe(404)
    expect(await privateRow.json()).toEqual(await missingRow.json())
    const privatePreview = await harness.cms(`/admin/api/cms/data/rows/${row.id}/preview`, { method: 'POST', cookie: persona.cookie, json: {} })
    const missingPreview = await harness.cms('/admin/api/cms/data/rows/missing/preview', { method: 'POST', cookie: persona.cookie, json: {} })
    expect(privatePreview.status).toBe(404)
    expect(missingPreview.status).toBe(404)
    expect(await privatePreview.json()).toEqual(await missingPreview.json())
  })

  it('checks schema management and preview ownership before inspecting fields', async () => {
    const table = await createDataTable(harness.db, MAIN_SCOPE, {
      id: 'foreign-preview-table', name: 'Foreign previews', slug: 'foreign-preview-table', kind: 'postType', singularLabel: 'Entry', pluralLabel: 'Entries',
    })
    const row = await createDataRow(harness.db, MAIN_SCOPE, { id: 'foreign-preview-row', tableId: table.id, cells: { title: 'Foreign' } })
    const reader = await harness.createRoleUser({ name: 'Custom schema inspector', slug: 'custom-schema-inspector', capabilities: ['data.custom.tables.read'] })
    const ownReader = await harness.createRoleUser({ name: 'Own preview inspector', slug: 'own-preview-inspector', capabilities: ['data.custom.tables.read', 'content.edit.own'] })
    await corruptSchema('posts')
    await corruptSchema(table.id)
    for (const method of ['PATCH', 'DELETE']) {
      const response = await harness.cms('/admin/api/cms/data/tables/posts', { method, cookie: reader.cookie, json: { name: 'Changed' } })
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'Forbidden' })
    }
    const preview = await harness.cms(`/admin/api/cms/data/rows/${row.id}/preview`, { method: 'POST', cookie: ownReader.cookie, json: {} })
    expect(preview.status).toBe(403)
    expect(await preview.json()).toEqual({ error: 'Forbidden' })
  })

  it('admits an entire catalogue batch before parsing even an accessible corrupt schema', async () => {
    const readable = await createDataTable(harness.db, MAIN_SCOPE, {
      id: 'readable', name: 'Readable', slug: 'readable', singularLabel: 'Entry', pluralLabel: 'Entries',
    })
    const persona = await harness.createRoleUser({ name: 'Custom batch reader', slug: 'custom-batch-reader', capabilities: ['data.custom.tables.read', 'content.edit.any'] })
    await corruptSchema(readable.id)
    await corruptSchema('posts')

    const denied = await harness.cms(`/admin/api/cms/data/localization?table=${readable.id}&table=posts&language=it`, { cookie: persona.cookie })
    const missing = await harness.cms(`/admin/api/cms/data/localization?table=${readable.id}&table=missing&language=it`, { cookie: persona.cookie })
    expect(denied.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await denied.json()).toEqual(await missing.json())
    const admitted = await harness.cms(`/admin/api/cms/data/localization?table=${readable.id}&language=it`, { cookie: persona.cookie })
    expect(admitted.status).toBe(422)
    expect(JSON.stringify(await admitted.json())).toContain('fields')
  })

  it('discovers permitted localization references without parsing inaccessible table schemas', async () => {
    const site = (await getDraftSiteDocument(harness.db, MAIN_SCOPE))!
    site.settings.language = 'it'
    site.settings.localization = { catalogues: [{ language: 'it', fileId: 'language-it' }] }
    site.files = [{ id: 'language-it', path: 'languages/it.json', type: 'config', createdAt: 0, updatedAt: 0, content: JSON.stringify({ language: 'it', messages: { entry: { visible: 'Visible' } } }) }]
    await saveDraftSite(harness.db, MAIN_SCOPE, site)
    const table = await createDataTable(harness.db, MAIN_SCOPE, {
      id: 'localization-keys', name: 'Keys', slug: 'localization-keys', singularLabel: 'Key', pluralLabel: 'Keys',
      fields: [{ id: 'heading', label: 'Heading', type: 'localizedText' }],
    })
    await createDataRow(harness.db, MAIN_SCOPE, { tableId: table.id, cells: { heading: { key: 'entry.visible' } } })
    await corruptSchema('posts')
    expect(await readableLocalizedDataKeys(harness.db, MAIN_SCOPE, { id: 'reader', capabilities: ['data.custom.tables.read', 'content.edit.any'] })).toEqual(new Set(['entry.visible']))
    expect(await readableLocalizedDataKeys(harness.db, MAIN_SCOPE, { id: 'creator', capabilities: ['data.custom.tables.read', 'content.create'] })).toEqual(new Set())
  })
})
