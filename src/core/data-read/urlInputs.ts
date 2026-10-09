import { RelationValidationError } from './errors'
import { DATA_QUERY_LIMITS, type DataCollectionQuery, type DataPredicate, type DataQueryUrlInput } from './querySchema'

/** Decode only operands explicitly declared in the certified native query. */
export function decodeDataQueryUrlInputs(
  authored: DataCollectionQuery, declarations: readonly DataQueryUrlInput[], params: URLSearchParams,
): { query: DataCollectionQuery; canonicalSearch: string } {
  const query = structuredClone(authored)
  const names = new Set<string>()
  const singleOperands = new Set<string>()
  const canonical: Array<[string, string]> = []
  const predicates: DataPredicate[] = []
  for (const declaration of declarations) {
    const path = `query.urlInputs.${declaration.parameter}`
    if (names.has(declaration.parameter)) throw new RelationValidationError(path, 'invalid_collection_query', 'A query parameter has multiple declarations')
    names.add(declaration.parameter)
    if (declaration.operand === 'search' && !query.search) throw new RelationValidationError(path, 'invalid_collection_query', 'Declare searchable fields before a visitor search operand')
    if (declaration.operand !== 'predicate') {
      if (singleOperands.has(declaration.operand)) throw new RelationValidationError(path, 'invalid_collection_query', 'A query operand has multiple parameter declarations')
      singleOperands.add(declaration.operand)
    }
    const values = params.getAll(declaration.parameter)
    if (values.length === 0) continue
    if (values.length !== 1) throw new RelationValidationError(path, 'invalid_collection_query', 'A query operand requires exactly one value')
    const value = values[0]
    switch (declaration.operand) {
      case 'search':
        if (!query.search) throw new RelationValidationError(path, 'invalid_collection_query', 'Declare searchable fields before a visitor search operand')
        if (value.length > DATA_QUERY_LIMITS.searchLength) throw new RelationValidationError(path, 'query_limit', 'The search text exceeds the native limit')
        query.search.text = value
        if (value) canonical.push([declaration.parameter, value])
        break
      case 'predicate':
        if (!declaration.allowedValues.includes(value)) throw new RelationValidationError(path, 'invalid_collection_query', 'The query value is outside its declared choices')
        predicates.push(declaration.kind === 'relation'
          ? { kind: 'relation', fieldId: declaration.fieldId, operator: 'contains', rowId: value }
          : { kind: 'field', fieldId: declaration.fieldId, operator: 'eq', value })
        canonical.push([declaration.parameter, value])
        break
      case 'relationOwner':
        if (!declaration.allowedRowIds.includes(value)) throw new RelationValidationError(path, 'invalid_collection_query', 'The relation owner is outside its declared choices')
        query.source = { kind: 'relation', owner: { tableId: declaration.ownerTableId, rowId: value }, field: structuredClone(declaration.field) }
        canonical.push([declaration.parameter, value])
        break
      case 'pageSize': {
        const limit = /^[1-9][0-9]*$/.test(value) ? Number(value) : NaN
        if (!Number.isSafeInteger(limit) || limit > declaration.maximum) throw new RelationValidationError(path, 'invalid_collection_query', 'The page size is outside its declared limit')
        query.limit = limit
        canonical.push([declaration.parameter, String(limit)])
        break
      }
    }
  }
  if (predicates.length) query.where = { kind: 'all', predicates: [...(query.where ? [query.where] : []), ...predicates] }
  canonical.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  return { query, canonicalSearch: canonical.length ? `?${new URLSearchParams(canonical).toString()}` : '' }
}
