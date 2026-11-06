import {
  DATA_QUERY_LIMITS, RelationResolutionError, RelationValidationError,
  relationReadKey, selectDataCollectionEntries,
  readRelationIds,
  type DataCollectionSource, type DataCollectionQuery, type DataCollectionResult,
  type MaterializedDataEntry, type PublishedDataReadPlan,
} from '@core/data-read'
import type { DataTable } from '@core/data/schemas'
import { materializeDataRelations } from './materialize'
import type { DataReadSnapshot } from './snapshot'

interface DataCollectionCandidates {
  table: DataTable
  items: MaterializedDataEntry[]
  tables: DataTable[]
  relations: PublishedDataReadPlan['scopes'][number]['relations']
}

/** Resolve and validate the complete source before predicates, ordering or pagination. */
export async function readDataCollectionCandidates(
  snapshot: DataReadSnapshot, source: DataCollectionSource,
): Promise<DataCollectionCandidates> {
  if (source.kind === 'table' || source.kind === 'entries') {
    const table = await snapshot.table(source.tableId)
    await snapshot.assertTableLanguage(table)
    const ids = source.kind === 'entries' ? readRelationIds(source.rowIds, { allowMultiple: true }, 'query.source.rowIds') : undefined
    const records = await snapshot.records(table.id, ids)
    if (ids && records.length !== ids.length) throw new RelationResolutionError('query.source', 'relation_unavailable', 'A requested entry is unavailable')
    return { table, items: records.length ? await snapshot.project(table, records) : [], tables: [table], relations: [] }
  }
  if (source.kind === 'relation') {
    const owner = snapshot.reference(source.owner.tableId, source.owner.rowId)
    const results = await materializeDataRelations(snapshot, [{ owner, field: source.field }])
    const relation = results.get(relationReadKey(owner, source.field))!
    const table = await snapshot.table(relation.targetTableId)
    const ownerTable = await snapshot.table(owner.tableId)
    const repeater = relation.field.repeater ?? owner.repeater
    return { table, items: relation.items, tables: [ownerTable, table], relations: [{
      sourceTableId: ownerTable.id, fieldId: source.field.fieldId,
      ...(repeater ? { repeaterFieldId: repeater.fieldId } : {}), targetTableId: table.id,
    }] }
  }
  const table = await snapshot.table(source.tableId)
  const sourceTable = await snapshot.table(source.sourceTableId)
  const field = sourceTable.fields.find(candidate => candidate.id === source.fieldId)
  if (field?.type !== 'relation' || field.targetTableId !== table.id) {
    throw new RelationValidationError('query.source.fieldId', 'invalid_relation_target', 'Inbound selection requires a relation to the selected collection')
  }
  const owners = await snapshot.records(sourceTable.id, source.ownerRowIds)
  if (owners.length !== source.ownerRowIds.length) {
    throw new RelationResolutionError('query.source', 'relation_unavailable', 'An inbound source entry is unavailable')
  }
  const requests = source.ownerRowIds.map(rowId => ({ owner: snapshot.reference(sourceTable.id, rowId), field: { fieldId: field.id } }))
  const results = await materializeDataRelations(snapshot, requests)
  // An inbound selection is the union of targets, in declared owner order
  // then each owner's membership order. This does not rewrite memberships.
  const entries = new Map<string, MaterializedDataEntry>()
  for (const request of requests) {
    for (const entry of results.get(relationReadKey(request.owner, request.field))!.items) {
      if (!entries.has(entry.id)) entries.set(entry.id, entry)
    }
  }
  return { table, items: [...entries.values()], tables: [sourceTable, table], relations: [{ sourceTableId: sourceTable.id, fieldId: field.id, targetTableId: table.id }] }
}

/** The shared authorized collection pipeline: source → locale → filter → order → count → page. */
export async function readDataCollection(
  snapshot: DataReadSnapshot, query: DataCollectionQuery,
): Promise<DataCollectionResult> {
  if (!Number.isInteger(query.offset) || query.offset < 0 || query.offset > 1_000_000 || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > DATA_QUERY_LIMITS.pageSize) {
    throw new RelationValidationError('query.page', 'invalid_collection_query', 'The requested page is outside the native limit')
  }
  const { table, items } = await readDataCollectionCandidates(snapshot, query.source)
  await snapshot.assertTableLanguage(table)
  const matching = selectDataCollectionEntries(items, query, table.fields, snapshot.language)
  const page = matching.slice(query.offset, query.offset + query.limit)
  const hasMore = query.offset + page.length < matching.length
  await snapshot.assertFresh()
  return {
    items: page, cardinalityCount: items.length, totalItems: matching.length,
    offset: query.offset, limit: query.limit, hasMore,
    nextOffset: hasMore ? query.offset + page.length : null,
    generation: snapshot.generation,
  }
}
