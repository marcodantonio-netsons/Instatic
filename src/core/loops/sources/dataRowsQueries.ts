/**
 * Dialect-aware SQL reads for the built-in `data.rows` loop source.
 *
 * Row selection, filtering, ordering, counts, and page slices live here so
 * `dataRows.ts` can own table dispatch and LoopItem projection only.
 */

import type { LoopSourceDb } from '../types'
import { cellFilterSql, cellOrderSql, type CellFilter } from '../cellFilter'
import { cellSearchSql, type CellSearch } from '../cellSearch'

interface DataTableProjectionRow {
  kind: string
  fields_json: unknown
}

export interface PublishedDataRowSqlRow {
  version_id: string
  row_id: string
  table_id: string
  table_slug: string
  table_kind: string
  table_route_base: string
  version_number: number
  cells_json: Record<string, unknown>
  slug: string
  author_user_id: string | null
  author_display_name: string | null
  author_role_slug: string | null
  author_role_name: string | null
  published_by_user_id: string | null
  published_by_display_name: string | null
  published_by_role_slug: string | null
  published_by_role_name: string | null
  published_at: Date | string
  created_at: Date | string
  updated_at: Date | string
}

export interface DataKindRowSqlRow {
  row_id: string
  table_id: string
  table_slug: string
  table_route_base: string
  cells_json: Record<string, unknown>
  slug: string
  author_user_id: string | null
  author_display_name: string | null
  author_role_slug: string | null
  author_role_name: string | null
  created_at: Date | string
  updated_at: Date | string
}

export type OrderColumn = 'publishedAt' | 'createdAt' | 'updatedAt' | 'slug'

export const ALLOWED_ORDER_BY: ReadonlySet<OrderColumn> = new Set([
  'publishedAt',
  'createdAt',
  'updatedAt',
  'slug',
])

export async function fetchDataTableProjection(
  db: LoopSourceDb,
  tableId: string,
): Promise<DataTableProjectionRow | null> {
  const { rows } = await db<DataTableProjectionRow>`
    select kind, fields_json
    from data_tables
    where id = ${tableId}
      and deleted_at is null
    limit 1
  `
  return rows[0] ?? null
}

interface RowPageOptions {
  tableId: string
  limit: number
  offset: number
  filter: CellFilter | null
  search?: CellSearch | null
  orderCell: { field: string; numeric: boolean } | null
  selectedRowIds?: ReadonlySet<string>
}

/** Dialect-appropriate positional placeholder for `db.unsafe`; index is 1-based. */
function positionalParam(db: LoopSourceDb, index: number): string {
  return db.dialect === 'postgres' ? `$${index}` : '?'
}

function selectedRowPredicate(
  db: LoopSourceDb,
  selectedRowIds: ReadonlySet<string> | undefined,
  nextParamIndex: number,
): { sql: string; params: string[] } | null {
  if (!selectedRowIds?.size) return null
  const rowIds = [...selectedRowIds]
  const placeholders = rowIds.map((_, index) => positionalParam(db, nextParamIndex + index))
  return { sql: `data_rows.logical_id in (${placeholders.join(', ')})`, params: rowIds }
}

function rowPredicate(input: {
  filter: CellFilter | null
  search: CellSearch | null
  dialect: 'postgres' | 'sqlite'
  column: string
  nextParamIndex: number
}): { sql: string; params: unknown[] } | null {
  const parts: string[] = []
  const params: unknown[] = []
  if (input.filter) {
    const condition = cellFilterSql({ ...input, filter: input.filter })
    parts.push(condition.sql)
    params.push(...condition.params)
  }
  if (input.search) {
    const condition = cellSearchSql({ ...input, search: input.search, nextParamIndex: input.nextParamIndex + params.length })
    parts.push(condition.sql)
    params.push(...condition.params)
  }
  return parts.length ? { sql: parts.map((part) => `(${part})`).join(' and '), params } : null
}

const POST_TYPE_ORDER_COLUMN: Record<OrderColumn, string> = {
  publishedAt: 'data_row_versions.published_at',
  createdAt: 'data_row_versions.created_at',
  updatedAt: 'data_rows.updated_at',
  slug: 'data_row_versions.slug',
}

const DATA_KIND_ORDER_COLUMN: Record<'createdAt' | 'updatedAt' | 'slug', string> = {
  createdAt: 'data_rows.created_at',
  updatedAt: 'data_rows.updated_at',
  slug: 'data_rows.slug',
}

/**
 * Fetch a page from a post-type table's active published versions.
 *
 * ORDER BY identifiers come only from the closed maps above. Runtime values
 * are positional parameters, ordered by SQL appearance for both dialects.
 */
export async function fetchPublishedDataRowPage(
  db: LoopSourceDb,
  orderBy: OrderColumn,
  direction: 'asc' | 'desc',
  opts: RowPageOptions,
): Promise<PublishedDataRowSqlRow[]> {
  const { tableId, limit, offset, filter, orderCell, selectedRowIds } = opts
  const column = 'data_row_versions.cells_json'
  const selected = selectedRowPredicate(db, selectedRowIds, 2)
  const selectedParams = selected?.params ?? []
  const cell = rowPredicate({
    filter,
    search: opts.search ?? null,
    dialect: db.dialect,
    column,
    nextParamIndex: 2 + selectedParams.length,
  })
  const cellParams = cell?.params ?? []
  const order = orderCell
    ? cellOrderSql({ ...orderCell, dialect: db.dialect, column, paramIndex: 2 + selectedParams.length + cellParams.length })
    : null
  const orderColumn = order ? order.sql : POST_TYPE_ORDER_COLUMN[orderBy]
  const orderParams = order?.params ?? []
  const before = selectedParams.length + cellParams.length + orderParams.length
  const limitParam = positionalParam(db, 2 + before)
  const offsetParam = positionalParam(db, 3 + before)
  const { rows } = await db.unsafe<PublishedDataRowSqlRow>(
    `select data_row_versions.id as version_id,
            data_rows.logical_id as row_id,
            data_rows.table_id,
            data_tables.slug as table_slug,
            data_tables.kind as table_kind,
            data_tables.route_base as table_route_base,
            data_row_versions.version_number,
            data_row_versions.cells_json,
            data_row_versions.slug,
            data_rows.author_user_id,
            author_users.display_name as author_display_name,
            author_roles.slug as author_role_slug,
            author_roles.name as author_role_name,
            data_row_versions.published_by_user_id,
            publisher_users.display_name as published_by_display_name,
            publisher_roles.slug as published_by_role_slug,
            publisher_roles.name as published_by_role_name,
            data_row_versions.published_at,
            data_row_versions.created_at,
            data_rows.updated_at
     from data_rows
     join data_tables on data_tables.id = data_rows.table_id
     join data_row_versions on data_row_versions.id = data_rows.active_version_id
     left join users author_users on author_users.id = data_rows.author_user_id
     left join roles author_roles on author_roles.id = author_users.role_id
     left join users publisher_users on publisher_users.id = data_row_versions.published_by_user_id
     left join roles publisher_roles on publisher_roles.id = publisher_users.role_id
     where data_rows.table_id = ${positionalParam(db, 1)}
       and data_rows.status = 'published'
       and data_rows.deleted_at is null
       and data_tables.deleted_at is null
       ${selected ? `and ${selected.sql}` : ''}
       ${cell ? `and ${cell.sql}` : ''}
     order by ${orderColumn} ${direction}, data_row_versions.id ${direction}
     limit ${limitParam} offset ${offsetParam}`,
    [tableId, ...selectedParams, ...cellParams, ...orderParams, limit, offset],
  )
  return rows
}

// Data-kind tables (`kind: 'data'`) have no publish lifecycle or
// `data_row_versions` rows. They are authored directly in the Data grid, so
// their cells live on `data_rows.cells_json` and are live on creation. Using
// the published-version join here would return zero rows, the "Lorem ipsum
// forever" bug authors were seeing in the canvas.
/** Fetch a page from a data-kind table, or a post-type branch draft. */
export async function fetchDataKindRowPage(
  db: LoopSourceDb,
  orderBy: OrderColumn,
  direction: 'asc' | 'desc',
  opts: RowPageOptions & { excludeUnpublished: boolean },
): Promise<DataKindRowSqlRow[]> {
  const { tableId, limit, offset, filter, orderCell, excludeUnpublished, selectedRowIds } = opts
  const sortKey: 'createdAt' | 'updatedAt' | 'slug' =
    orderBy === 'updatedAt' ? 'updatedAt' : orderBy === 'slug' ? 'slug' : 'createdAt'
  const column = 'data_rows.cells_json'
  const selected = selectedRowPredicate(db, selectedRowIds, 2)
  const selectedParams = selected?.params ?? []
  const cell = rowPredicate({
    filter,
    search: opts.search ?? null,
    dialect: db.dialect,
    column,
    nextParamIndex: 2 + selectedParams.length,
  })
  const cellParams = cell?.params ?? []
  const order = orderCell
    ? cellOrderSql({ ...orderCell, dialect: db.dialect, column, paramIndex: 2 + selectedParams.length + cellParams.length })
    : null
  const orderColumn = order ? order.sql : DATA_KIND_ORDER_COLUMN[sortKey]
  const orderParams = order?.params ?? []
  const before = selectedParams.length + cellParams.length + orderParams.length
  const limitParam = positionalParam(db, 2 + before)
  const offsetParam = positionalParam(db, 3 + before)
  const { rows } = await db.unsafe<DataKindRowSqlRow>(
    `select data_rows.logical_id as row_id,
            data_rows.table_id,
            data_tables.slug as table_slug,
            data_tables.route_base as table_route_base,
            data_rows.cells_json,
            data_rows.slug,
            data_rows.author_user_id,
            author_users.display_name as author_display_name,
            author_roles.slug as author_role_slug,
            author_roles.name as author_role_name,
            data_rows.created_at,
            data_rows.updated_at
     from data_rows
     join data_tables on data_tables.id = data_rows.table_id
     left join users author_users on author_users.id = data_rows.author_user_id
     left join roles author_roles on author_roles.id = author_users.role_id
     where data_rows.table_id = ${positionalParam(db, 1)}
       and data_rows.deleted_at is null
       and data_tables.deleted_at is null
       ${excludeUnpublished ? "and data_rows.status <> 'unpublished'" : ''}
       ${selected ? `and ${selected.sql}` : ''}
       ${cell ? `and ${cell.sql}` : ''}
     order by ${orderColumn} ${direction}, data_rows.id ${direction}
     limit ${limitParam} offset ${offsetParam}`,
    [tableId, ...selectedParams, ...cellParams, ...orderParams, limit, offset],
  )
  return rows
}

/** Count rows matching a data-kind or post-type branch-draft query. */
export async function countDataKindRows(
  db: LoopSourceDb,
  opts: { tableId: string; filter: CellFilter | null; search: CellSearch | null; excludeUnpublished: boolean },
): Promise<number> {
  const { tableId, filter, search, excludeUnpublished } = opts
  const cell = rowPredicate({ filter, search, dialect: db.dialect, column: 'data_rows.cells_json', nextParamIndex: 2 })
  const { rows } = await db.unsafe<{ total: number }>(
    `select count(*) as total
     from data_rows
     where data_rows.table_id = ${positionalParam(db, 1)}
       and data_rows.deleted_at is null
       ${excludeUnpublished ? "and data_rows.status <> 'unpublished'" : ''}
       ${cell ? `and ${cell.sql}` : ''}`,
    [tableId, ...(cell?.params ?? [])],
  )
  return Number(rows[0]?.total ?? 0)
}

/** Count published post-type rows using the active-version cell values. */
export async function countPublishedPostRows(
  db: LoopSourceDb,
  opts: { tableId: string; filter: CellFilter | null; search: CellSearch | null },
): Promise<number> {
  const { tableId, filter, search } = opts
  const cell = rowPredicate({ filter, search, dialect: db.dialect, column: 'data_row_versions.cells_json', nextParamIndex: 2 })
  const { rows } = await db.unsafe<{ total: number }>(
    `select count(*) as total
     from data_rows
     join data_row_versions on data_row_versions.id = data_rows.active_version_id
     where data_rows.table_id = ${positionalParam(db, 1)}
       and data_rows.status = 'published'
       and data_rows.deleted_at is null
       ${cell ? `and ${cell.sql}` : ''}`,
    [tableId, ...(cell?.params ?? [])],
  )
  return Number(rows[0]?.total ?? 0)
}
