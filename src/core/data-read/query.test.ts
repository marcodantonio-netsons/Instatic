import { describe, expect, test } from 'bun:test'
import type { DataField } from '@core/data/schemas'
import { RelationValidationError } from './errors'
import { selectDataCollectionEntries } from './query'
import type { DataCollectionQuery, DataPredicate } from './querySchema'
import type { MaterializedDataEntry } from './schemas'

const fields: DataField[] = [
  { id: 'heading', label: 'Heading', type: 'localizedText' },
  { id: 'excerpt', label: 'Original excerpt', type: 'text' },
  { id: 'score', label: 'Score', type: 'number' },
  { id: 'featured', label: 'Featured', type: 'boolean' },
  { id: 'categories', label: 'Categories', type: 'relation', targetTableId: 'categories', allowMultiple: true },
]
function entry(id: string, cells: Record<string, unknown>): MaterializedDataEntry {
  return {
    id, reference: { branchId: 'main', view: 'public', generation: 'opaque', tableId: 'guides', rowId: id },
    title: id, tableSlug: 'guides', slug: '', status: 'published', author: null, publishedBy: null, url: null, createdAt: '2026-01-01', updatedAt: '2026-01-01', publishedAt: null,
    version: null, cells, fields, media: {},
  }
}
function query(patch: Partial<DataCollectionQuery> = {}): DataCollectionQuery {
  return { source: { kind: 'table', tableId: 'guides' }, offset: 0, limit: 10, ...patch }
}

describe('native collection evaluation', () => {
  test('compares projected language text, numeric fields and membership before paging', () => {
    const rows = [entry('b', { heading: 'Sicherheit', score: 10, categories: ['security'] }), entry('a', { heading: 'Hosting', score: 2, categories: ['cloud'] })]
    const selected = selectDataCollectionEntries(rows, query({
      where: { kind: 'all', predicates: [
        { kind: 'relation', fieldId: 'categories', operator: 'contains', rowId: 'security' },
        { kind: 'field', fieldId: 'score', operator: 'gte', value: 2 },
      ] }, search: { fieldIds: ['heading'], text: 'SICHER' },
    }), fields, 'de')
    expect(selected.map(row => row.id)).toEqual(['b'])
    expect(selectDataCollectionEntries(rows, query({ search: { fieldIds: ['heading'], text: 'sicurezza' } }), fields, 'de')).toEqual([])
    const italian = rows.map(row => ({ ...row, cells: { ...row.cells, heading: row.id === 'b' ? 'Sicurezza' : 'Hosting' } }))
    expect(selectDataCollectionEntries(italian, query({ search: { fieldIds: ['heading'], text: 'sicurezza' } }), fields, 'it').map(row => row.id)).toEqual(['b'])
  })

  test('search visits only declared text fields and ordinary text stays literal', () => {
    const rows = [entry('a', { heading: 'Sicherheit', excerpt: 'Estratto italiano {translations.secret}' })]
    expect(selectDataCollectionEntries(rows, query({ search: { fieldIds: ['heading'], text: 'italiano' } }), fields, 'de')).toEqual([])
    expect(selectDataCollectionEntries(rows, query({ search: { fieldIds: ['excerpt'], text: '{translations.secret}' } }), fields, 'it')).toHaveLength(1)
  })

  test('numeric order keeps null last in both directions and uses a deterministic identity tie', () => {
    const rows = [entry('z', { score: null }), entry('b', { score: 10 }), entry('a', { score: 10 }), entry('c', { score: 2 })]
    expect(selectDataCollectionEntries(rows, query({ order: [{ kind: 'field', fieldId: 'score', direction: 'asc' }] }), fields).map(row => row.id)).toEqual(['c', 'a', 'b', 'z'])
    expect(selectDataCollectionEntries(rows, query({ order: [{ kind: 'field', fieldId: 'score', direction: 'desc' }] }), fields).map(row => row.id)).toEqual(['a', 'b', 'c', 'z'])
  })

  test('relation source preserves authored order unless an explicit order changes it', () => {
    const rows = [entry('c', {}), entry('a', {}), entry('b', {})]
    const relationQuery = query({ source: { kind: 'relation', owner: { tableId: 'categories', rowId: 'category' }, field: { fieldId: 'members' } } })
    expect(selectDataCollectionEntries(rows, relationQuery, fields).map(row => row.id)).toEqual(['c', 'a', 'b'])
    expect(selectDataCollectionEntries(rows, { ...relationQuery, order: [{ kind: 'membership', direction: 'desc' }] }, fields).map(row => row.id)).toEqual(['b', 'a', 'c'])
    const selected = selectDataCollectionEntries(rows, relationQuery, fields)
    selected[0].cells.heading = 'Edited copy'
    expect(rows[0].cells).toEqual({})
  })

  test('presence distinguishes empty collections from real membership without stringifying arrays', () => {
    const rows = [entry('empty', { categories: [] }), entry('null', { categories: null }), entry('member', { categories: ['c'] })]
    expect(selectDataCollectionEntries(rows, query({ where: { kind: 'presence', fieldId: 'categories', operator: 'empty' } }), fields).map(row => row.id)).toEqual(['empty', 'null'])
    expect(selectDataCollectionEntries(rows, query({ where: { kind: 'relation', fieldId: 'categories', operator: 'notContains', rowId: 'c' } }), fields).map(row => row.id)).toEqual(['empty', 'null'])
  })

  test.each([
    { where: { kind: 'field', fieldId: 'absent', operator: 'eq', value: 'x' } },
    { where: { kind: 'field', fieldId: 'score', operator: 'eq', value: '2' } },
    { where: { kind: 'field', fieldId: 'featured', operator: 'like', value: true } },
    { where: { kind: 'field', fieldId: 'categories', operator: 'eq', value: 'c' } },
    { where: { kind: 'relation', fieldId: 'heading', operator: 'contains', rowId: 'c' } },
    { search: { fieldIds: ['score'], text: '2' } },
    { order: [{ kind: 'membership', direction: 'asc' }] },
  ] satisfies Partial<DataCollectionQuery>[])('invalid declarations fail even with zero rows: %j', patch => {
    expect(() => selectDataCollectionEntries([], query(patch), fields)).toThrow(RelationValidationError)
  })

  test('malformed relation and scalar cells fail before short-circuit or paging', () => {
    const requested = query({ where: { kind: 'all', predicates: [
      { kind: 'field', fieldId: 'score', operator: 'eq', value: 0 },
      { kind: 'relation', fieldId: 'categories', operator: 'contains', rowId: 'c' },
    ] } })
    expect(() => selectDataCollectionEntries([entry('a', { score: 1, categories: ['c', 'c'] })], requested, fields)).toThrow(RelationValidationError)
    expect(() => selectDataCollectionEntries([entry('a', { score: '1', categories: [] })], requested, fields)).toThrow(RelationValidationError)
    expect(() => selectDataCollectionEntries([entry('a', { heading: { key: 'private' } })], query({ search: { fieldIds: ['heading'], text: 'private' } }), fields)).toThrow(RelationValidationError)
  })

  test('bounded all/any rejects excessive nesting and total predicate work', () => {
    const leaf = { kind: 'presence', fieldId: 'heading', operator: 'present' } as const
    const nested: DataPredicate = { kind: 'all', predicates: [{ kind: 'any', predicates: [{ kind: 'all', predicates: [{ kind: 'all', predicates: [leaf] }] }] }] }
    expect(() => selectDataCollectionEntries([], query({ where: structuredClone(nested) }), fields)).toThrow(RelationValidationError)
    expect(() => selectDataCollectionEntries([], query({ where: { kind: 'all', predicates: Array.from({ length: 64 }, () => leaf) } }), fields)).toThrow(RelationValidationError)
  })
})
