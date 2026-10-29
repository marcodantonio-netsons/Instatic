import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createTestDb, type TestDb } from '../helpers/createTestDb'
import { parseCellSearch, scoreCellSearch, cellSearchSql } from '@core/loops/cellSearch'
import { resolveLoopQueryFilters } from '@core/loops'
import { fetchPublishedDataRowItems } from '@core/loops/sources/dataRows'
import type { LoopSearchConfiguration } from '@core/loops-schema'

const configuration: LoopSearchConfiguration = {
  fields: [{ field: 'title', phraseWeight: 120, termWeight: 32 }, { field: 'excerpt', phraseWeight: 35, termWeight: 6 }, { field: 'category', phraseWeight: 0, termWeight: 20 }],
  match: 'anyTerm', rank: 'score', phraseBoost: 'first',
  normalization: { lowercase: true, removeDiacritics: true, punctuationToSpaces: false, stripLeading: '', trim: true },
}

describe('visitor query bindings', () => {
  const bindings = [
    { filterKey: 'searchText', formId: 'search', fieldName: 'q', queryParameter: 'q' },
    { filterKey: 'cellValue', formId: 'search', fieldName: 'category', queryParameter: 'category', whenFieldEmpty: 'q' },
  ]
  it('suspends the category for archive search and restores it when cleared', () => {
    expect(resolveLoopQueryFilters({ tableId: 'articles', cellValue: 'initial' }, bindings, { q: 'email', category: 'billing' }, ['searchText', 'cellValue']))
      .toEqual({ tableId: 'articles', searchText: 'email' })
    expect(resolveLoopQueryFilters({ tableId: 'articles' }, bindings, { q: '', category: 'billing' }, ['searchText', 'cellValue']))
      .toEqual({ tableId: 'articles', searchText: '', cellValue: 'billing' })
  })
  it('accepts selected identities including an explicit empty selection, with no source authority', () => {
    const selected = [{ filterKey: 'rowIds', formId: 'plans', fieldName: 'selected', queryParameter: 'selected', valueType: 'stringArray' as const }]
    expect(resolveLoopQueryFilters({}, selected, { selected: '["b","a"]' }, ['rowIds'])).toEqual({ rowIds: ['b', 'a'] })
    expect(resolveLoopQueryFilters({}, selected, { selected: '[]' }, ['rowIds'])).toEqual({ rowIds: [] })
    expect(() => resolveLoopQueryFilters({}, selected, { selected: '[1]' }, ['rowIds'])).toThrow('array of strings')
    expect(() => resolveLoopQueryFilters({}, [{ ...bindings[0], filterKey: 'tableId' }], { q: 'private' }, ['searchText'])).toThrow('does not expose')
    expect(() => resolveLoopQueryFilters({}, bindings, { q: 'x'.repeat(2049) }, ['searchText', 'cellValue'])).toThrow('2048')
  })
})

describe('localized visitor search semantics', () => {
  it('matches accents and multiword terms with the configured AND/OR semantics', () => {
    const and = parseCellSearch({ searchText: 'CITTA email', search: { ...configuration, rank: 'source', match: 'allTerms' } }, 'it')!
    expect(scoreCellSearch({ title: 'Città', excerpt: 'Gestisci email' }, and)).toBe(1)
    expect(scoreCellSearch({ title: 'Città' }, and)).toBe(0)
    const or = parseCellSearch({ searchText: 'email assente', search: configuration }, 'it')!
    expect(scoreCellSearch({ title: 'Email' }, or)).toBe(32)
  })
  it('uses only the first phrase boost, then adds every term weight', () => {
    const query = parseCellSearch({ searchText: 'posta email', search: configuration }, 'it')!
    expect(scoreCellSearch({ title: 'Posta email', excerpt: 'Posta email', category: 'Email' }, query)).toBe(120 + 64 + 12 + 20)
    expect(scoreCellSearch({ title: 'Altro', excerpt: 'Posta email' }, query)).toBe(35 + 12)
  })
  it('normalizes a leading query dot without altering extensions or SQL literals', () => {
    const search = { ...configuration, fields: [{ field: 'extension', phraseWeight: 0, termWeight: 1 }], match: 'contains' as const, rank: 'source' as const,
      normalization: { ...configuration.normalization, removeDiacritics: false, stripLeading: '.' } }
    const query = parseCellSearch({ searchText: ' .COM ', search }, 'en')!
    expect(query.value).toBe('com')
    expect(scoreCellSearch({ extension: '.COM.AU' }, query)).toBe(1)
    const literal = parseCellSearch({ searchText: '%_\\', search: { ...search, normalization: { ...search.normalization, lowercase: false } } })!
    for (const dialect of ['postgres', 'sqlite'] as const) {
      const sql = cellSearchSql({ search: literal, dialect, column: 'cells_json', nextParamIndex: 3 })
      expect(sql.params).toEqual(['extension', '%_\\'])
      expect(sql.sql).not.toContain('%_')
    }
  })
})

describe('query filtering before pagination and authorization', () => {
  let fixture: TestDb
  beforeAll(async () => {
    fixture = await createTestDb()
    const fields = [{ id: 'title', label: 'Title', type: 'text' }, { id: 'excerpt', label: 'Excerpt', type: 'text' }]
    await fixture.db`insert into data_tables (id,name,slug,kind,route_base,singular_label,plural_label,fields_json,system)
      values ('search-test','Search','search-test','data','','Item','Items',${fields},${false})`
    for (const [id, title, excerpt] of [['s-a', 'Posta email', 'Posta email'], ['s-b', 'Email', 'Altro'], ['s-c', 'Altro', 'Posta email'], ['s-d', 'Invisibile', 'Posta email']]) {
      await fixture.db`insert into data_rows (id,table_id,slug,cells_json,status) values (${id},'search-test',${id},${{ title, excerpt }},'draft')`
    }
  })
  afterAll(async () => { await fixture.cleanup() })
  it('counts only visible matches and applies relevance before taking the page', async () => {
    const result = await fetchPublishedDataRowItems(fixture.db, {
      tableId: 'search-test', orderBy: 'cell:title', direction: 'asc', offset: 1, limit: 1,
      readableRowIds: new Set(['s-a', 's-b', 's-c']), cellSearch: parseCellSearch({ searchText: 'posta email', search: configuration }, 'it'),
    })
    expect(result.totalItems).toBe(3)
    expect(result.items.map(item => item.id)).toEqual(['s-c'])
    const empty = await fetchPublishedDataRowItems(fixture.db, { tableId: 'search-test', orderBy: 'slug', direction: 'asc', offset: 0, limit: 10, selectedRowIds: new Set() })
    expect(empty).toEqual({ items: [], totalItems: 0 })
  })
})
