/** Resolve stored row identity through the shared table and ownership policy. */
import type { DbClient } from '../db/client'
import type { BranchScope } from '../branches/scope'
import { getDataRow, getDataTable } from '../repositories/data'
import type { DataRow, DataTable } from '@core/data/schemas'
import { canReadTable, type DataPrincipal, type RowCheck } from './dataAccess'

export type RowAccess =
  | { kind: 'ok'; row: DataRow; table: DataTable }
  /** The row does not exist, or lives in a table family the principal cannot see. Callers answer "not found" so the id leaks nothing. */
  | { kind: 'not-found' }
  /** The row is visible but the requested operation is not permitted on it. */
  | { kind: 'forbidden'; row: DataRow; table: DataTable }

/**
 * Resolve one row for a principal and an operation. Enforces the table-family
 * read boundary BEFORE the row-ownership check: a persona granted a broad
 * content.* capability but NOT data.system.tables.read satisfies ownership on
 * every row, so without the table gate it could read, edit, and publish
 * system-table rows (pages/posts drafts, author identity).
 */
export async function resolveRowAccess(
  db: DbClient,
  scope: BranchScope,
  rowId: string,
  principal: DataPrincipal,
  check: RowCheck,
): Promise<RowAccess> {
  const row = await getDataRow(db, scope, rowId)
  if (!row) return { kind: 'not-found' }
  const table = await getDataTable(db, scope, row.tableId)
  if (!table || !canReadTable(principal, table)) return { kind: 'not-found' }
  if (!check(principal, row)) return { kind: 'forbidden', row, table }
  return { kind: 'ok', row, table }
}
