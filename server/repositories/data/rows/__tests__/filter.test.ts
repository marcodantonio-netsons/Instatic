import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createCapabilityTestHarness, type CapabilityTestHarness } from '../../../../../src/__tests__/helpers/capabilityHarness'
import type { DataCollectionQuery } from '@core/data-read'
import { RelationResolutionError, RelationValidationError } from '@core/data-read'
import { LocalizationError } from '@core/localization'
import type { DbClient } from '../../../../db/client'
import { MAIN_SCOPE } from '../../../../branches/scope'
import { createDataRow, createDataTable, getDataRow } from '../../index'
import { DataReadSnapshot, readDataCollection, type DataReadAuthority } from '../../read-view'
import { getDraftSiteDocument } from '../../../publish'
import { saveDraftSite } from '../../../site'

/** Counts actual row storage reads, retaining the authoritative adapter. */
function countingRows(inner: DbClient) {
  const counts = { reads: 0 }
  const wrapped = ((strings: TemplateStringsArray, ...values: unknown[]) => inner(strings, ...values)) as DbClient
  wrapped.unsafe = (sql, params) => {
    if (/from\s+data_rows\b/i.test(sql)) counts.reads++
    return inner.unsafe(sql, params)
  }
  wrapped.transaction = cb => inner.transaction(cb)
  return { db: Object.assign(wrapped, { dialect: inner.dialect }), counts }
}

describe('authorized native collection filtering', () => {
  let harness: CapabilityTestHarness
  let ownerId: string
  let ownerEmail: string
  const authority: DataReadAuthority = { kind: 'plugin', manifest: {
    id: 'test.native-filter', grantedPermissions: ['cms.content.read'], contentAccess: [{ table: 'records', modes: ['read'] }],
  } }

  beforeEach(async () => {
    harness = await createCapabilityTestHarness()
    await harness.setupOwner()
    const { rows: [owner] } = await harness.db<{ id: string; email: string }>`SELECT id, email FROM users`
    ownerId = owner.id
    ownerEmail = owner.email
    await harness.db`UPDATE users SET display_name = ${'Author Person'} WHERE id = ${ownerId}`
    await createDataTable(harness.db, MAIN_SCOPE, {
      id: 'query-records', name: 'Records', slug: 'records', kind: 'data', primaryFieldId: 'title',
      singularLabel: 'Record', pluralLabel: 'Records', fields: [
        { id: 'title', label: 'Title', type: 'text' }, { id: 'score', label: 'Score', type: 'number' },
        { id: 'literal', label: 'Literal', type: 'text' },
      ],
    })
    for (const [id, title, score] of [['alpha', 'Alpha', 1], ['beta', 'Beta', 2], ['gamma', 'Gamma', 3], ['delta', 'Delta', 4]] as const) {
      await createDataRow(harness.db, MAIN_SCOPE, { id, tableId: 'query-records', slug: id,
        cells: { title, score, literal: 'entry.z' } }, ownerId)
    }
    await createDataRow(harness.db, MAIN_SCOPE, { id: 'deleted', tableId: 'query-records', slug: 'deleted', cells: { title: 'Deleted' } }, ownerId)
    await harness.db`UPDATE data_rows SET deleted_at = ${'2026-10-01T00:00:00.000Z'} WHERE id = ${'deleted'}`
  })

  afterEach(async () => { if (harness) await harness.cleanup() })

  function query(patch: Partial<DataCollectionQuery> = {}): DataCollectionQuery {
    return { source: { kind: 'table', tableId: 'query-records' }, offset: 0, limit: 100, ...patch }
  }

  async function read(spec = query(), language?: string, db = harness.db, actor = authority) {
    const snapshot = await DataReadSnapshot.create(db, MAIN_SCOPE, 'draft', actor, { language })
    return readDataCollection(snapshot, spec)
  }

  async function localizeRows() {
    await harness.db`UPDATE data_tables SET fields_json = ${[
      { id: 'title', label: 'Title', type: 'text' }, { id: 'heading', label: 'Heading', type: 'localizedText' },
      { id: 'literal', label: 'Literal', type: 'text' }, { id: 'score', label: 'Score', type: 'number' },
    ]} WHERE id = ${'query-records'}`
    const site = (await getDraftSiteDocument(harness.db, MAIN_SCOPE))!
    site.settings.localization = { catalogues: ['de', 'it'].map(language => ({ language, fileId: `language-${language}` })) }
    site.files = ['de', 'it'].map(language => ({ id: `language-${language}`, path: `languages/${language}.json`,
      type: 'config' as const, createdAt: 0, updatedAt: 0,
      content: JSON.stringify({ language, messages: { entry: language === 'de'
        ? { z: 'Äpfel', a: 'Zoo', m: 'Mango' } : { z: 'Zeta', a: 'Alfa', m: 'Mela' } } }),
    }))
    await saveDraftSite(harness.db, MAIN_SCOPE, site)
    for (const [id, key, score] of [['alpha', 'entry.z', 1], ['beta', 'entry.a', 2], ['gamma', 'entry.m', 3], ['delta', 'entry.z', 4]] as const) {
      await harness.db`UPDATE data_rows SET cells_json = ${{ title: id, heading: { key }, literal: 'entry.z', score }} WHERE id = ${id}`
    }
  }

  it('reads live rows, applies field conditions before paging, and exposes public author metadata', async () => {
    const result = await read(query({ where: { kind: 'field', fieldId: 'title', operator: 'eq', value: 'Alpha' } }))
    expect(result.cardinalityCount).toBe(4)
    expect(result.totalItems).toBe(1)
    expect(result.items.map(item => item.id)).toEqual(['alpha'])
    expect(result.items[0].author?.displayName).toBe('Author Person')
    expect(result.items[0].author).not.toHaveProperty('id')
    expect(result.items[0].author).not.toHaveProperty('email')
    expect(JSON.stringify(result)).not.toContain(ownerEmail)
    const empty = await read(query({ where: { kind: 'field', fieldId: 'title', operator: 'eq', value: 'Nonexistent' } }))
    expect(empty.items).toEqual([])
    expect(empty.totalItems).toBe(0)
  })

  it('uses one bounded storage read for both small and larger admitted collections', async () => {
    const small = countingRows(harness.db)
    expect((await read(query({ limit: 500 }), undefined, small.db)).items).toHaveLength(4)
    for (let index = 0; index < 50; index++) {
      await createDataRow(harness.db, MAIN_SCOPE, { id: `row-${index}`, tableId: 'query-records', slug: `row-${index}`,
        cells: { title: `Row ${index}`, score: index } }, ownerId)
    }
    const larger = countingRows(harness.db)
    expect((await read(query({ limit: 500 }), undefined, larger.db)).items).toHaveLength(54)
    expect(small.counts.reads).toBe(1)
    expect(larger.counts.reads).toBe(small.counts.reads)
  })

  it('derives selected language before filter, order, count and page while retaining stored references', async () => {
    await localizeRows()
    const result = await read(query({
      where: { kind: 'field', fieldId: 'heading', operator: 'like', value: '%ÄPF%' },
      order: [{ kind: 'field', fieldId: 'heading', direction: 'asc' }], offset: 1, limit: 1,
    }), 'de')
    expect(result.cardinalityCount).toBe(4)
    expect(result.totalItems).toBe(2)
    expect(result.items.map(item => item.id)).toEqual(['delta'])
    expect(result.items[0].cells.heading).toBe('Äpfel')
    expect((await getDataRow(harness.db, MAIN_SCOPE, 'delta'))!.cells.heading).toEqual({ key: 'entry.z' })
    const ordering = query({ order: [{ kind: 'field', fieldId: 'heading', direction: 'asc' }] })
    expect((await read(ordering, 'de')).items.map(item => item.id)).toEqual(['alpha', 'delta', 'gamma', 'beta'])
    expect((await read(ordering, 'it')).items.map(item => item.id)).toEqual(['beta', 'gamma', 'alpha', 'delta'])
    expect((await read(query({ where: { kind: 'field', fieldId: 'heading', operator: 'like', value: '%entry.z%' } }), 'de')).totalItems).toBe(0)
  })

  it('rejects malformed operands/schema and incomplete locale for every candidate before pagination', async () => {
    await localizeRows()
    await expect(read(query())).rejects.toBeInstanceOf(LocalizationError)
    await expect(read(query(), 'fr')).rejects.toBeInstanceOf(LocalizationError)
    await expect(read(query({ where: { kind: 'field', fieldId: 'missing', operator: 'eq', value: 'value' } }), 'de')).rejects.toBeInstanceOf(RelationValidationError)
    await expect(read(query({ where: { kind: 'field', fieldId: 'score', operator: 'eq', value: '2' } }), 'de')).rejects.toBeInstanceOf(RelationValidationError)
    await harness.db`UPDATE data_rows SET cells_json = ${{ title: 'beta', heading: { key: 'entry.missing' } }} WHERE id = ${'beta'}`
    await expect(read(query({ source: { kind: 'entries', tableId: 'query-records', rowIds: ['alpha', 'beta'] }, limit: 1 }), 'de')).rejects.toBeInstanceOf(LocalizationError)
    await harness.db`UPDATE data_tables SET fields_json = ${{ malformed: true }} WHERE id = ${'query-records'}`
    await expect(read(query(), 'de')).rejects.toThrow()
  })

  it('preserves literal comparisons, numeric range conjunctions, and explicit presence', async () => {
    await localizeRows()
    expect((await read(query({ where: { kind: 'field', fieldId: 'literal', operator: 'eq', value: 'entry.z' } }), 'de')).totalItems).toBe(4)
    expect((await read(query({ where: { kind: 'field', fieldId: 'literal', operator: 'eq', value: 'Äpfel' } }), 'de')).totalItems).toBe(0)
    const scores = await read(query({ where: { kind: 'all', predicates: [
      { kind: 'field', fieldId: 'score', operator: 'gt', value: 1 }, { kind: 'field', fieldId: 'score', operator: 'lte', value: 3 },
    ] }, order: [{ kind: 'field', fieldId: 'score', direction: 'asc' }] }), 'de')
    expect(scores.items.map(item => item.id)).toEqual(['beta', 'gamma'])
    await harness.db`UPDATE data_rows SET cells_json = ${{ title: 'gamma', literal: null, heading: null }} WHERE id = ${'gamma'}`
    const empty = await read(query({ where: { kind: 'presence', fieldId: 'literal', operator: 'empty' } }), 'de')
    expect(empty.items.map(item => item.id)).toEqual(['gamma'])
  })

  it('enforces family grants and table read mode before parsing a corrupt private schema', async () => {
    await harness.db`UPDATE data_tables SET fields_json = ${{ malformed: true }} WHERE id = ${'query-records'}`
    const writeOnly: DataReadAuthority = { kind: 'plugin', manifest: {
      id: 'test.write-only', grantedPermissions: ['cms.content.read', 'cms.content.write'], contentAccess: [{ table: 'records', modes: ['write'] }],
    } }
    await expect(read(query(), undefined, harness.db, writeOnly)).rejects.toBeInstanceOf(RelationResolutionError)
    const declaredOnly: DataReadAuthority = { kind: 'plugin', manifest: {
      id: 'test.no-read-grant', grantedPermissions: [], contentAccess: [{ table: 'records', modes: ['read'] }],
    } }
    await expect(read(query(), undefined, harness.db, declaredOnly)).rejects.toMatchObject({ code: 'relation_unavailable' })
  })
})
