import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { LocalizationError } from '@core/localization'
import { fetchPublishedDataRowItems } from '@core/loops/sources/dataRows'
import type { LoopSourceDb } from '@core/loops/types'
import { createTestDb, type TestDb } from '../helpers/createTestDb'

type Db = TestDb['db']

interface CapturedUnsafeQuery {
  sql: string
  params: unknown[]
  returnedRows: number
}

function observeUnsafeQueries(db: Db): { db: LoopSourceDb; queries: CapturedUnsafeQuery[] } {
  const queries: CapturedUnsafeQuery[] = []
  const observedDb = Object.assign(
    <Row = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => db<Row>(strings, ...values),
    {
      dialect: db.dialect,
      unsafe: async <Row = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        const result = await db.unsafe<Row>(sql, params)
        queries.push({ sql, params: params ?? [], returnedRows: result.rows.length })
        return result
      },
    },
  ) satisfies LoopSourceDb
  return { db: observedDb, queries }
}

async function createTable(db: Db, id: string, kind: 'data' | 'postType', fields: unknown[] = []): Promise<void> {
  await db`
    insert into data_tables (id, name, slug, kind, route_base, singular_label, plural_label, fields_json, system)
    values (${id}, ${id}, ${id}, ${kind}, ${''}, ${'Item'}, ${'Items'}, ${fields}, ${false})
  `
}

async function seedDataRow(db: Db, tableId: string, rowId: string, slug: string, cells: Record<string, unknown>): Promise<void> {
  await db`
    insert into data_rows (id, table_id, cells_json, slug, status)
    values (${rowId}, ${tableId}, ${cells}, ${slug}, ${'draft'})
  `
}

async function seedPost(
  db: Db,
  tableId: string,
  rowId: string,
  slug: string,
  cells: Record<string, unknown>,
  status: 'published' | 'draft' | 'unpublished',
): Promise<void> {
  const versionId = `${rowId}-version`
  await db`
    insert into data_rows (id, table_id, cells_json, slug, status)
    values (${rowId}, ${tableId}, ${cells}, ${slug}, ${status})
  `
  await db`
    insert into data_row_versions (id, row_id, version_number, cells_json, slug)
    values (${versionId}, ${rowId}, ${1}, ${cells}, ${slug})
  `
  await db`update data_rows set active_version_id = ${versionId} where id = ${rowId}`
}

function rowQuery(queries: CapturedUnsafeQuery[]): CapturedUnsafeQuery {
  const query = queries.find((entry) => entry.sql.includes('data_rows.logical_id as row_id'))
  if (!query) throw new Error('Expected a data row SELECT query')
  return query
}

describe('data.rows selected row ids', () => {
  let fixture: TestDb
  let db: Db

  beforeAll(async () => {
    fixture = await createTestDb()
    db = fixture.db

    await createTable(db, 'selected-data', 'data')
    for (let index = 0; index < 823; index += 1) {
      const id = `data-row-${index}`
      await seedDataRow(db, 'selected-data', id, `item-${index}`, { rank: index })
    }

    await createTable(db, 'selected-posts', 'postType')
    await seedPost(db, 'selected-posts', 'post-live', 'live', { title: 'Live' }, 'published')
    await seedPost(db, 'selected-posts', 'post-draft', 'draft', { title: 'Draft' }, 'draft')
    await seedPost(db, 'selected-posts', 'post-offline', 'offline', { title: 'Offline' }, 'unpublished')

    await createTable(db, 'selected-localized', 'data', [
      { id: 'heading', label: 'Heading', type: 'localizedText' },
    ])
    for (const [id, key] of [
      ['localized-a', 'entry.a'],
      ['localized-b', 'entry.b'],
      ['localized-c', 'entry.c'],
      ['localized-hidden', 'entry.hidden'],
      ['localized-outside', 'entry.outside'],
    ]) {
      await seedDataRow(db, 'selected-localized', id, id, { heading: { key } })
    }

    await db`
      insert into data_tables (id, branch_id, name, slug, kind, route_base, singular_label, plural_label, fields_json, system)
      values (${'spring:branch-posts'}, ${'spring'}, ${'Branch posts'}, ${'branch-posts'}, ${'postType'}, ${''}, ${'Post'}, ${'Posts'}, ${[]}, ${false})
    `
    await db`
      insert into data_rows (id, table_id, branch_id, cells_json, slug, status)
      values (${'spring:branch-live'}, ${'spring:branch-posts'}, ${'spring'}, ${{ title: 'Branch draft' }}, ${'branch-live'}, ${'draft'})
    `
    await db`
      insert into data_rows (id, table_id, branch_id, cells_json, slug, status)
      values (${'spring:branch-offline'}, ${'spring:branch-posts'}, ${'spring'}, ${{ title: 'Offline' }}, ${'branch-offline'}, ${'unpublished'})
    `
  })

  afterAll(async () => {
    await fixture.cleanup()
  })

  it('returns one SQL row when one of 823 data rows is selected', async () => {
    const observed = observeUnsafeQueries(db)
    const result = await fetchPublishedDataRowItems(observed.db, {
      tableId: 'selected-data', orderBy: 'slug', direction: 'asc', limit: 10, offset: 0,
      selectedRowIds: new Set(['data-row-411']),
    })

    expect(result.totalItems).toBe(1)
    expect(result.items.map((item) => item.id)).toEqual(['data-row-411'])
    expect(rowQuery(observed.queries)).toMatchObject({ returnedRows: 1, params: ['selected-data', 'data-row-411', 2147483647, 0] })
    expect(rowQuery(observed.queries).sql).toContain('data_rows.logical_id in (?)')
  })

  it('filters published post-type rows through the active version and status conditions', async () => {
    const observed = observeUnsafeQueries(db)
    const result = await fetchPublishedDataRowItems(observed.db, {
      tableId: 'selected-posts', orderBy: 'slug', direction: 'asc', limit: 10, offset: 0,
      selectedRowIds: new Set(['post-live', 'post-draft', 'post-offline']),
    })

    expect(result.totalItems).toBe(1)
    expect(result.items.map((item) => item.id)).toEqual(['post-live'])
    expect(rowQuery(observed.queries).returnedRows).toBe(1)
  })

  it('projects and sorts localized selected rows before applying authorization, count, and pagination', async () => {
    const observed = observeUnsafeQueries(db)
    const result = await fetchPublishedDataRowItems(observed.db, {
      tableId: 'selected-localized', orderBy: 'cell:heading', direction: 'asc', limit: 1, offset: 1,
      selectedRowIds: new Set(['localized-a', 'localized-b', 'localized-c', 'localized-hidden']),
      readableRowIds: new Set(['localized-a', 'localized-b', 'localized-c']),
      localization: {
        language: 'it',
        translations: { entry: { a: 'Zebra', b: 'Mela', c: 'Alfa', hidden: 'Aardvark', outside: 'A' } },
      },
    })

    expect(rowQuery(observed.queries).returnedRows).toBe(4)
    expect(result.totalItems).toBe(3)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe('localized-b')
    expect(result.items[0].fields.heading).toBe('Mela')
  })

  it('uses logical row ids and excludes unpublished branch drafts', async () => {
    const observed = observeUnsafeQueries(db)
    const result = await fetchPublishedDataRowItems(observed.db, {
      tableId: 'spring:branch-posts', drafts: true, orderBy: 'slug', direction: 'asc', limit: 10, offset: 0,
      selectedRowIds: new Set(['branch-live', 'branch-offline']),
    })

    expect(result.totalItems).toBe(1)
    expect(result.items.map((item) => item.id)).toEqual(['branch-live'])
    expect(rowQuery(observed.queries)).toMatchObject({ returnedRows: 1 })
    expect(rowQuery(observed.queries).sql).toContain("data_rows.status <> 'unpublished'")
  })

  it('returns an empty selection without issuing a data row query and keeps localization validation', async () => {
    const observed = observeUnsafeQueries(db)
    const result = await fetchPublishedDataRowItems(observed.db, {
      tableId: 'selected-data', orderBy: 'slug', direction: 'asc', limit: 10, offset: 0,
      selectedRowIds: new Set(),
    })
    expect(result).toEqual({ items: [], totalItems: 0 })
    expect(observed.queries).toEqual([])

    await expect(fetchPublishedDataRowItems(observed.db, {
      tableId: 'selected-localized', orderBy: 'slug', direction: 'asc', limit: 10, offset: 0,
      selectedRowIds: new Set(),
    })).rejects.toBeInstanceOf(LocalizationError)
  })

  it('numbers PostgreSQL placeholders after selected ids on both query paths', async () => {
    for (const kind of ['postType', 'data'] as const) {
      const queries: CapturedUnsafeQuery[] = []
      const fakeDb = Object.assign(
        async <Row = Record<string, unknown>>(_strings: TemplateStringsArray, ..._values: unknown[]) => ({
          rows: [{ kind, fields_json: [] } as unknown as Row], rowCount: 1,
        }),
        {
          dialect: 'postgres' as const,
          unsafe: async <Row = Record<string, unknown>>(sql: string, params?: unknown[]) => {
            queries.push({ sql, params: params ?? [], returnedRows: 0 })
            return { rows: [] as Row[], rowCount: 0 }
          },
        },
      ) satisfies LoopSourceDb

      await fetchPublishedDataRowItems(fakeDb, {
        tableId: 'pg-table', orderBy: 'slug', direction: 'asc', limit: 5, offset: 2,
        selectedRowIds: new Set(['logical-a', 'logical-b']),
      })

      expect(queries).toHaveLength(1)
      expect(queries[0].sql).toContain('data_rows.logical_id in ($2, $3)')
      expect(queries[0].sql).toContain('limit $4 offset $5')
      expect(queries[0].params).toEqual(['pg-table', 'logical-a', 'logical-b', 2147483647, 0])
    }
  })
})
