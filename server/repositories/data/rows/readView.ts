import { physicalId, logicalIdOf, MAIN_BRANCH_ID } from '@core/branches'
import { DATA_QUERY_LIMITS, RelationResolutionError, type DataReadView, type DataRowReadRecord, type DataRowIdentity } from '@core/data-read'
import type { DataTable } from '@core/data/schemas'
import type { DbClient } from '../../../db/client'
import type { BranchScope } from '../../../branches/scope'
import { placeholder, selectDataRowReadRecords } from './mapper'

/** No cells, schema, user or media payload is read before the collection floor. */
export async function readDataRowIdentity(db: DbClient, scope: BranchScope, rowId: string): Promise<DataRowIdentity | null> {
  const { rows } = await db.unsafe<{ logical_id: string; table_id: string }>(
    `select logical_id, table_id from data_rows where id = ${placeholder(db.dialect, 1)} and deleted_at is null`,
    [physicalId(scope.branchId, rowId)],
  )
  const row = rows[0]
  return row ? { rowId: row.logical_id, tableId: logicalIdOf(row.table_id) } : null
}

/** Resolve one row identity without touching its payload before own-row admission. */
export async function readDataRowIdBySlug(
  db: DbClient, scope: BranchScope, table: DataTable, view: DataReadView, slug: string,
): Promise<string | null> {
  if (view === 'public' && scope.branchId !== MAIN_BRANCH_ID) throw new RelationResolutionError('view', 'relation_unavailable', 'The requested content view is unavailable')
  const active = view === 'public' && table.kind !== 'data'
  const p = (index: number) => placeholder(db.dialect, index)
  const { rows } = await db.unsafe<{ id: string }>(
    `select data_rows.logical_id as id from data_rows
     ${active ? 'join data_row_versions on data_row_versions.id = data_rows.active_version_id' : ''}
     where data_rows.table_id = ${p(1)} and data_rows.deleted_at is null
       and ${active ? 'data_row_versions.slug' : 'data_rows.slug'} = ${p(2)}
       ${active ? "and data_rows.status = 'published'" : ''}`,
    [physicalId(scope.branchId, table.id), slug],
  )
  if (rows.length > 1) throw new RelationResolutionError('route', 'invalid_relation_target', 'The collection entry route is ambiguous')
  return rows[0]?.id ?? null
}

/**
 * Bounded row storage read. Authorization, projection and query evaluation are
 * owned by the read-view service; this repository never accepts SQL from it.
 * Public data tables are live; every other kind needs an active version.
 */
export async function readDataRowRecords(
  db: DbClient,
  scope: BranchScope,
  table: DataTable,
  view: DataReadView,
  options: { rowIds?: readonly string[]; ownerUserId?: string } = {},
): Promise<DataRowReadRecord[]> {
  if (view === 'public' && scope.branchId !== MAIN_BRANCH_ID) {
    throw new RelationResolutionError('view', 'relation_unavailable', 'The requested content view is unavailable')
  }
  if (options.rowIds?.length === 0) return []
  if (options.rowIds && options.rowIds.length > DATA_QUERY_LIMITS.batchSize) {
    throw new RelationResolutionError('rowIds', 'query_limit', 'A row-read batch exceeds the native limit')
  }
  const params: unknown[] = [physicalId(scope.branchId, table.id)]
  const bind = (value: unknown) => {
    params.push(value)
    return placeholder(db.dialect, params.length)
  }
  const predicates = [`data_rows.table_id = ${placeholder(db.dialect, 1)}`, 'data_rows.deleted_at is null']
  if (options.rowIds) predicates.push(`data_rows.id in (${options.rowIds.map(id => bind(physicalId(scope.branchId, id))).join(', ')})`)
  if (options.ownerUserId) {
    predicates.push(`(data_rows.author_user_id = ${bind(options.ownerUserId)} or (data_rows.author_user_id is null and data_rows.created_by_user_id = ${bind(options.ownerUserId)}))`)
  }
  const activeVersion = view === 'public' && table.kind !== 'data'
  if (activeVersion) predicates.push("data_rows.status = 'published'")
  // The ceiling is a native constant, not an untyped caller's SQL input.
  // Reading one extra candidate lets the service reject rather than truncate.
  const ceiling = options.rowIds ? DATA_QUERY_LIMITS.batchSize : DATA_QUERY_LIMITS.candidates + 1
  return selectDataRowReadRecords(db, scope, {
    where: predicates.join(' and '), params, activeVersion,
    tail: `order by data_rows.created_at asc, data_rows.logical_id asc limit ${ceiling}`,
  })
}
