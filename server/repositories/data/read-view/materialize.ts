import {
  DATA_QUERY_LIMITS, RelationResolutionError, RelationValidationError,
  readRelationIds, resolveRelationField, relationFieldPathForOwner, relationReadKey,
  type MaterializedDataEntry, type RelationMaterialization,
  type RelationMaterializationRequest,
} from '@core/data-read'
import { assertRelationReadDemand } from './authority'
import type { DataReadSnapshot } from './snapshot'

/**
 * All owners are admitted first, all target identities are fetched in bounded
 * batches, then each membership is expanded independently in its authored order.
 * No target projection is performed before its table and row have been admitted.
 */
export async function materializeDataRelations(
  snapshot: DataReadSnapshot, requests: readonly RelationMaterializationRequest[],
): Promise<Map<string, RelationMaterialization>> {
  if (requests.length > DATA_QUERY_LIMITS.demands) {
    throw new RelationResolutionError('relations', 'query_limit', 'The relation demand exceeds the native limit')
  }
  if (requests.length === 0) return new Map()
  const ownersByTable = new Map<string, Set<string>>()
  const claims = new Map<string, string>()
  for (const request of requests) {
    snapshot.assertReference(request.owner)
    const key = relationReadKey(request.owner, request.field)
    const claim = Object.hasOwn(request, 'draftValue') ? JSON.stringify(['draft', request.draftValue]) : 'stored'
    if (claims.has(key) && claims.get(key) !== claim) {
      throw new RelationValidationError('relations', 'invalid_relation_value', 'Conflicting values for the same entry relation')
    }
    claims.set(key, claim)
    const owners = ownersByTable.get(request.owner.tableId) ?? new Set<string>()
    owners.add(request.owner.rowId)
    ownersByTable.set(request.owner.tableId, owners)
  }
  const owners = new Map<string, Awaited<ReturnType<DataReadSnapshot['records']>>>()
  await Promise.all([...ownersByTable].map(async ([tableId, ids]) => {
    owners.set(tableId, await snapshot.records(tableId, [...ids]))
  }))
  const targetsByTable = new Map<string, Set<string>>()
  const demands = await Promise.all(requests.map(async request => {
    const row = owners.get(request.owner.tableId)?.find(record => record.row.id === request.owner.rowId)?.row
    if (!row) throw new RelationResolutionError('owner', 'relation_unavailable', 'The requested entry is unavailable')
    const table = await snapshot.table(row.tableId)
    const fieldPath = relationFieldPathForOwner(request.owner, request.field)
    const path = `tables.${table.id}.rows.${row.id}.cells`
    const { field, value } = resolveRelationField(table.fields, row.cells, fieldPath, path)
    assertRelationReadDemand(snapshot.authority, table.id, fieldPath, field.targetTableId, path)
    if (!field.targetTableId.trim()) throw new RelationValidationError(`${path}.${field.id}`, 'invalid_relation_target', 'Choose a relation target collection')
    if (Object.hasOwn(request, 'draftValue') && (snapshot.view !== 'draft' || snapshot.authority.kind === 'public')) {
      throw new RelationValidationError('draftValue', 'invalid_relation_value', 'An unsaved value requires an authorized draft view')
    }
    const ids = readRelationIds(Object.hasOwn(request, 'draftValue') ? request.draftValue : value, field, `${path}.${field.id}`)
    if (ids.length > DATA_QUERY_LIMITS.membership) {
      throw new RelationResolutionError(path, 'query_limit', 'The ordered membership exceeds the native limit')
    }
    const targets = targetsByTable.get(field.targetTableId) ?? new Set<string>()
    for (const id of ids) targets.add(id)
    targetsByTable.set(field.targetTableId, targets)
    return { request, fieldPath, targetTableId: field.targetTableId, ids, path }
  }))
  if ([...targetsByTable.values()].reduce((count, ids) => count + ids.size, 0) > DATA_QUERY_LIMITS.candidates) {
    throw new RelationResolutionError('relations', 'query_limit', 'The target demand exceeds the native read limit')
  }
  const entries = new Map<string, Map<string, MaterializedDataEntry>>()
  await Promise.all([...targetsByTable].map(async ([tableId, ids]) => {
    // The target schema is checked even for a real empty membership. Empty
    // memberships perform no row/media/catalogue read and remain distinct from
    // an unavailable target collection.
    const table = await snapshot.table(tableId)
    const records = ids.size ? await snapshot.records(tableId, [...ids]) : []
    const projected = records.length ? await snapshot.project(table, records) : []
    entries.set(tableId, new Map(projected.map(entry => [entry.id, entry])))
  }))
  const results = new Map<string, RelationMaterialization>()
  for (const { request, fieldPath, targetTableId, ids, path } of demands) {
    const targets = entries.get(targetTableId)!
    // Validate the full membership before any caller can sort or page it.
    // Missing, moved, deleted, unpublished and unauthorized targets share one
    // external diagnostic, without exposing their titles or catalogue keys.
    if (ids.some(id => !targets.has(id))) {
      throw new RelationResolutionError(path, 'relation_unavailable', 'A related entry is unavailable; repair the dependent membership')
    }
    results.set(relationReadKey(request.owner, fieldPath), {
      owner: request.owner, field: fieldPath, targetTableId,
      items: ids.map(id => structuredClone(targets.get(id)!)),
      totalItems: ids.length, generation: snapshot.generation,
    })
  }
  await snapshot.assertFresh()
  return results
}
