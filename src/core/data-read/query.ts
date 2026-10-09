import type { DataField } from '@core/data/schemas'
import { compareDataCellValues } from '@core/data/localizedCells'
import { matchesStorageFilterValue } from './valueFilter'
import { RelationValidationError } from './errors'
import { readRelationIds, readRelationRepeaterValue } from './relationValues'
import { DATA_QUERY_LIMITS, type DataCollectionQuery, type DataPredicate } from './querySchema'
import type { MaterializedDataEntry } from './schemas'

const TEXT_FIELDS = new Set(['text', 'localizedText', 'longText', 'richText'])
const STRING_FIELDS = new Set([...TEXT_FIELDS, 'date', 'dateTime', 'select', 'url', 'email'])

function invalid(path: string, message: string): never {
  throw new RelationValidationError(path, 'invalid_collection_query', message)
}

function queryField(fields: readonly DataField[], id: string, path: string): DataField {
  const field = fields.find(candidate => candidate.id === id)
  if (!field) invalid(path, 'The query field does not exist in its collection schema')
  return field
}

function scalarType(field: DataField, path: string): 'string' | 'number' | 'boolean' {
  if (STRING_FIELDS.has(field.type)) return 'string'
  if (field.type === 'number' || field.type === 'boolean') return field.type
  if (field.type === 'relation' && field.allowMultiple !== true) return 'string'
  return invalid(path, 'This field requires a collection or presence operator')
}

function assertScalar(value: unknown, type: 'string' | 'number' | 'boolean', path: string): void {
  if (value == null) return
  if (typeof value !== type || (typeof value === 'number' && !Number.isFinite(value))) {
    invalid(path, 'The query value does not match its field type')
  }
}

function assertPredicate(
  predicate: DataPredicate, fields: readonly DataField[], path: string,
  depth: number, count: { value: number },
): void {
  if (depth > DATA_QUERY_LIMITS.predicateDepth || ++count.value > DATA_QUERY_LIMITS.predicates) {
    throw new RelationValidationError(path, 'query_limit', 'The predicate exceeds the native query limit')
  }
  if (predicate.kind === 'all' || predicate.kind === 'any') {
    predicate.predicates.forEach((child, index) => assertPredicate(child, fields, `${path}.predicates.${index}`, depth + 1, count))
    return
  }
  const field = queryField(fields, predicate.fieldId, `${path}.fieldId`)
  if (predicate.kind === 'presence') {
    if (field.type === 'pageTree' || field.type === 'fieldSchema') invalid(path, 'Document fields are not query operands')
    return
  }
  if (predicate.kind === 'relation') {
    if (field.type !== 'relation') invalid(path, 'Membership operators require a relation field')
    return
  }
  const type = scalarType(field, path)
  assertScalar(predicate.value, type, `${path}.value`)
  if (predicate.operator === 'like' && (type !== 'string' || typeof predicate.value !== 'string')) {
    invalid(path, 'LIKE requires a string field and pattern')
  }
  if (field.type === 'relation' && predicate.operator !== 'eq' && predicate.operator !== 'ne') {
    invalid(path, 'Single relations support identity equality and membership operators')
  }
  if (field.type === 'relation' && predicate.value !== null) readRelationIds(predicate.value, field, `${path}.value`)
}

/** Validate the declared query independently of whether the collection contains any rows. */
export function assertDataCollectionQuery(query: DataCollectionQuery, fields: readonly DataField[]): void {
  if (query.where) assertPredicate(query.where, fields, 'query.where', 1, { value: 0 })
  if (query.search && !query.search.fieldIds.length && query.search.title !== true) invalid('query.search', 'Declare text fields or the native display title for search')
  for (const [index, id] of (query.search?.fieldIds ?? []).entries()) {
    if (!TEXT_FIELDS.has(queryField(fields, id, `query.search.fieldIds.${index}`).type)) {
      invalid(`query.search.fieldIds.${index}`, 'Search requires an explicit text field')
    }
  }
  for (const [index, order] of (query.order ?? []).entries()) {
    if (order.kind === 'field') scalarType(queryField(fields, order.fieldId, `query.order.${index}.fieldId`), `query.order.${index}`)
    if (order.kind === 'membership' && query.source.kind === 'table') invalid(`query.order.${index}`, 'Membership order requires a relation collection')
  }
}

function assertCell(field: DataField, value: unknown, path: string): void {
  if (field.type === 'relation') { readRelationIds(value, field, path); return }
  if (field.type === 'repeater') { readRelationRepeaterValue(value, path); return }
  if (field.type === 'multiSelect' || (field.type === 'media' && field.allowMultiple === true)) {
    if (value == null) return
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) invalid(path, 'Expected an array of string values')
    return
  }
  if (field.type === 'media') { assertScalar(value, 'string', path); return }
  assertScalar(value, scalarType(field, path), path)
}

function matchingPredicate(entry: MaterializedDataEntry, predicate: DataPredicate, fields: readonly DataField[]): boolean {
  if (predicate.kind === 'all') return predicate.predicates.every(child => matchingPredicate(entry, child, fields))
  if (predicate.kind === 'any') return predicate.predicates.some(child => matchingPredicate(entry, child, fields))
  const field = queryField(fields, predicate.fieldId, 'query.where.fieldId')
  const value = entry.cells[field.id]
  if (predicate.kind === 'relation') {
    if (field.type !== 'relation') return invalid('query.where', 'Membership operators require a relation field')
    const contains = readRelationIds(value, field, `rows.${entry.id}.cells.${field.id}`).includes(predicate.rowId)
    return predicate.operator === 'contains' ? contains : !contains
  }
  if (predicate.kind === 'presence') {
    const present = value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)
    return predicate.operator === 'present' ? present : !present
  }
  return matchesStorageFilterValue(value, { [predicate.operator]: predicate.value })
}

function predicateFieldIds(predicate: DataPredicate | undefined): string[] {
  if (!predicate) return []
  return predicate.kind === 'all' || predicate.kind === 'any'
    ? predicate.predicates.flatMap(predicateFieldIds) : [predicate.fieldId]
}

/** One evaluator for already-admitted, language-projected candidates. It never mutates cells or membership order. */
export function selectDataCollectionEntries(
  entries: readonly MaterializedDataEntry[], query: DataCollectionQuery,
  fields: readonly DataField[], language?: string,
): MaterializedDataEntry[] {
  assertDataCollectionQuery(query, fields)
  if (entries.length > DATA_QUERY_LIMITS.candidates) throw new RelationValidationError('query', 'query_limit', 'The candidate set exceeds the native limit')
  const usedIds = new Set([
    ...predicateFieldIds(query.where), ...(query.search?.fieldIds ?? []),
    ...(query.order ?? []).flatMap(order => order.kind === 'field' ? [order.fieldId] : []),
  ])
  // Validate every demanded leaf before boolean short-circuiting or paging.
  for (const entry of entries) for (const id of usedIds) {
    assertCell(queryField(fields, id, 'query.fieldId'), entry.cells[id], `rows.${entry.id}.cells.${id}`)
  }
  const text = query.search?.text.toLocaleLowerCase(language)
  const matching = entries.map((entry, membershipIndex) => ({ entry, membershipIndex })).filter(({ entry }) =>
    (!query.where || matchingPredicate(entry, query.where, fields)) &&
    (!text || (query.search!.title === true && entry.title.toLocaleLowerCase(language).includes(text)) || query.search!.fieldIds.some(id => {
      const value = entry.cells[id]
      return typeof value === 'string' && value.toLocaleLowerCase(language).includes(text)
    })),
  )
  if (query.order?.length) matching.sort((left, right) => {
    for (const order of query.order!) {
      const a = order.kind === 'membership' ? left.membershipIndex : order.kind === 'field' ? left.entry.cells[order.fieldId] : left.entry[order.field]
      const b = order.kind === 'membership' ? right.membershipIndex : order.kind === 'field' ? right.entry.cells[order.fieldId] : right.entry[order.field]
      const comparison = compareDataCellValues(a, b, language, order.direction)
      if (comparison !== 0) return comparison
    }
    return left.entry.id < right.entry.id ? -1 : left.entry.id > right.entry.id ? 1 : 0
  })
  return matching.map(({ entry }) => structuredClone(entry))
}
