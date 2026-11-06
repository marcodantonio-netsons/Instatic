import type { DataRow, DataTable } from '@core/data/schemas'
import type { PluginManifest } from '@core/plugin-sdk'
import type { PublishedDataReadPlan, RelationFieldPath } from '@core/data-read'
import { RelationResolutionError } from '@core/data-read'
import { canReadTable, canReadDataRows, canReadDataRow, canSeeAllDataRows, ownsDataRow, type DataAccessUser } from '../../../auth/dataAccess'

export type DataReadAuthority =
  | { kind: 'user'; principal: DataAccessUser }
  | { kind: 'plugin'; manifest: Pick<PluginManifest, 'id' | 'grantedPermissions' | 'contentAccess'> }
  | { kind: 'public'; plan: PublishedDataReadPlan; scopeId: string }

/** Every source and target uses this same family/grant floor before projection. */
export function canReadDataTable(authority: DataReadAuthority, table: Pick<DataTable, 'id' | 'slug' | 'system'>): boolean {
  if (authority.kind === 'user') return canReadTable(authority.principal, table) && canReadDataRows(authority.principal)
  if (authority.kind === 'public') {
    return authority.plan.scopes.find(scope => scope.id === authority.scopeId)?.tableIds.includes(table.id) === true
  }
  return authority.manifest.grantedPermissions?.includes('cms.content.read') === true &&
    authority.manifest.contentAccess?.some(access => access.table === table.slug && access.modes.includes('read')) === true
}

export function canReadDataEntry(authority: DataReadAuthority, row: Pick<DataRow, 'authorUserId' | 'createdByUserId'>): boolean {
  if (authority.kind === 'plugin') return true
  if (authority.kind === 'user') return canReadDataRow(authority.principal, row)
  const rowScope = authority.plan.scopes.find(scope => scope.id === authority.scopeId)?.rowScope
  return rowScope?.kind === 'all' || (rowScope?.kind === 'owned' && ownsDataRow(rowScope.userId, row))
}

/** Push own-row policy into bounded SQL reads before counting candidates. */
export function dataReadOwnerUserId(authority: DataReadAuthority): string | undefined {
  if (authority.kind === 'plugin') return undefined
  if (authority.kind === 'user') return canSeeAllDataRows(authority.principal) ? undefined : authority.principal.id
  const rowScope = authority.plan.scopes.find(scope => scope.id === authority.scopeId)?.rowScope
  return rowScope?.kind === 'owned' ? rowScope.userId : undefined
}

/** A table declaration does not authorize traversing an unrelated relation field. */
export function assertRelationReadDemand(
  authority: DataReadAuthority, sourceTableId: string,
  field: { fieldId: RelationFieldPath['fieldId']; repeater?: { fieldId: string } },
  targetTableId: string, path: string,
): void {
  if (authority.kind !== 'public') return
  const scope = authority.plan.scopes.find(scope => scope.id === authority.scopeId)
  const admitted = scope?.relations.some(relation => relation.sourceTableId === sourceTableId &&
    relation.fieldId === field.fieldId && relation.repeaterFieldId === field.repeater?.fieldId &&
    relation.targetTableId === targetTableId)
  if (!admitted) throw new RelationResolutionError(path, 'relation_unavailable', 'The requested relation is unavailable')
}
