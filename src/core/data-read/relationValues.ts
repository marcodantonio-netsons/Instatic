import type { DataField, DataRowCells, RepeaterValue } from '@core/data/schemas'
import { readDataRepeaterValue } from '@core/data/localizedCells'
import { RelationValidationError } from './errors'
import type { DataEntryReference, RelationFieldPath } from './schemas'

export type RelationField = Extract<DataField, { type: 'relation' }>

/** Missing/null are explicit empty draft states. Present malformed values never become empty. */
export function readRelationIds(value: unknown, field: Pick<RelationField, 'allowMultiple'>, path: string): string[] {
  if (value == null) return []
  const values = field.allowMultiple === true ? value : [value]
  if (!Array.isArray(values)) {
    throw new RelationValidationError(path, 'invalid_relation_value', 'Expected an ordered list of row IDs')
  }
  if (field.allowMultiple !== true && Array.isArray(value)) {
    throw new RelationValidationError(path, 'invalid_relation_value', 'Expected one row ID or null')
  }
  const ids: string[] = []
  const seen = new Set<string>()
  for (let index = 0; index < values.length; index++) {
    const id = values[index]
    if (typeof id !== 'string' || !id.trim()) {
      throw new RelationValidationError(`${path}[${index}]`, 'invalid_relation_value', 'Expected a nonempty row ID')
    }
    if (seen.has(id)) {
      throw new RelationValidationError(`${path}[${index}]`, 'duplicate_relation_id', 'A row ID occurs more than once in this membership')
    }
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/** Every ordinary writer produces the same single/null or ordered-array shape. */
export function relationCellValue(ids: readonly string[], field: Pick<RelationField, 'allowMultiple'>): string | string[] | null {
  const value = field.allowMultiple === true ? [...ids] : ids.length === 0 ? null : ids[0]
  if (field.allowMultiple !== true && ids.length > 1) {
    throw new RelationValidationError('relation', 'invalid_relation_value', 'A single relation cannot contain several rows')
  }
  readRelationIds(value, field, 'relation')
  return value
}

/** Strict repeater identity is shared by relation reads and final-graph validation. */
export function readRelationRepeaterValue(value: unknown, path: string): RepeaterValue {
  try { return readDataRepeaterValue(value, path) }
  catch (cause) {
    throw new RelationValidationError(path, 'invalid_repeater_identity', 'Expected stable, distinct repeater item identities', { cause })
  }
}

export function resolveRelationField(
  fields: readonly DataField[], cells: DataRowCells, fieldPath: RelationFieldPath, path: string,
): { field: RelationField; value: unknown } {
  let schema = fields
  let source = cells
  if (fieldPath.repeater) {
    const repeater = fields.find(field => field.id === fieldPath.repeater?.fieldId)
    if (repeater?.type !== 'repeater') {
      throw new RelationValidationError(path, 'invalid_relation_field', 'The requested repeater field does not exist')
    }
    const item = readRelationRepeaterValue(cells[repeater.id], `${path}.${repeater.id}`)
      .find(item => item.id === fieldPath.repeater?.itemId)
    if (!item) throw new RelationValidationError(path, 'invalid_repeater_identity', 'The requested repeater item does not exist')
    schema = repeater.fields
    source = item.cells
  }
  const field = schema.find(field => field.id === fieldPath.fieldId)
  if (field?.type !== 'relation') {
    throw new RelationValidationError(path, 'invalid_relation_field', 'The requested field is not a relation')
  }
  return { field, value: source[field.id] }
}

/** Tuple serialization preserves all identity parts without delimiter collisions. */
export function relationReadKey(owner: DataEntryReference, field: RelationFieldPath): string {
  const location = relationFieldPathForOwner(owner, field)
  return JSON.stringify([
    owner.branchId, owner.view, owner.generation, owner.tableId, owner.rowId,
    location.repeater?.fieldId ?? null, location.repeater?.itemId ?? null,
    location.fieldId,
  ])
}

/** An actual repeater frame cannot be redirected to another item by a field locator. */
export function relationFieldPathForOwner(owner: DataEntryReference, field: RelationFieldPath): RelationFieldPath {
  if (owner.repeater && field.repeater &&
    (owner.repeater.fieldId !== field.repeater.fieldId || owner.repeater.itemId !== field.repeater.itemId)) {
    throw new RelationValidationError('field.repeater', 'invalid_repeater_identity', 'The field does not belong to the current repeater entry')
  }
  return { ...field, ...(owner.repeater ? { repeater: owner.repeater } : {}) }
}
