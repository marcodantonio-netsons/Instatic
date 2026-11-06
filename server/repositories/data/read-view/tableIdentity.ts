import { logicalIdOf, physicalId } from '@core/branches'
import { DATA_QUERY_LIMITS, RelationResolutionError } from '@core/data-read'
import type { DataTable } from '@core/data/schemas'
import { placeholder, type DbClient } from '../../../db/client'
import type { BranchScope } from '../../../branches/scope'

export type DataTableIdentity = Pick<DataTable, 'id' | 'slug' | 'kind' | 'system'>

type StoredDataTableIdentity = {
  id: string
  slug: string
  kind: DataTable['kind']
  system: boolean | number
}

function tableIdentity(scope: BranchScope, row: StoredDataTableIdentity): DataTableIdentity {
  return { id: logicalIdOf(scope.branchId, row.id), slug: row.slug, kind: row.kind, system: Boolean(row.system) }
}

/** Schema browsers admit the narrow catalogue before loading any private fields. */
export async function listDataTableIdentities(db: DbClient, scope: BranchScope): Promise<DataTableIdentity[]> {
  const { rows } = await db<StoredDataTableIdentity>`
    select id, slug, kind, system from data_tables
    where branch_id = ${scope.branchId} and deleted_at is null
  `
  return rows.map(row => tableIdentity(scope, row))
}

/** Permission admission reads identity only, before parsing private schemas or cells. */
export async function readDataTableIdentities(
  db: DbClient, scope: BranchScope, ids: readonly string[],
): Promise<DataTableIdentity[]> {
  if (ids.length === 0) return []
  if (ids.length > DATA_QUERY_LIMITS.batchSize) {
    throw new RelationResolutionError('tableIds', 'query_limit', 'A table-read batch exceeds the native limit')
  }
  const { rows } = await db.unsafe<StoredDataTableIdentity>(
    `select id, slug, kind, system from data_tables
     where id in (${ids.map((_, index) => placeholder(db.dialect, index + 1)).join(', ')})
       and branch_id = ${placeholder(db.dialect, ids.length + 1)} and deleted_at is null`,
    [...ids.map(id => physicalId(scope.branchId, id)), scope.branchId],
  )
  return rows.map(row => tableIdentity(scope, row))
}

/** Entry templates name collections by slug; admit the same narrow identity before fields. */
export async function readDataTableIdentityBySlug(
  db: DbClient, scope: BranchScope, slug: string,
): Promise<DataTableIdentity | null> {
  const { rows } = await db<StoredDataTableIdentity>`
    select id, slug, kind, system from data_tables
    where branch_id = ${scope.branchId} and slug = ${slug} and deleted_at is null
  `
  const row = rows[0]
  return row ? tableIdentity(scope, row) : null
}

/** Route context selection never parses unrelated or unauthorized table fields. */
export async function readDataTableIdentityByRouteBase(
  db: DbClient, scope: BranchScope, routeBase: string,
): Promise<DataTableIdentity | null> {
  const { rows } = await db<StoredDataTableIdentity>`
    select id, slug, kind, system from data_tables
    where branch_id = ${scope.branchId} and route_base = ${routeBase} and deleted_at is null
  `
  if (rows.length > 1) throw new RelationResolutionError('route', 'invalid_relation_target', 'The collection route is ambiguous')
  return rows[0] ? tableIdentity(scope, rows[0]) : null
}
