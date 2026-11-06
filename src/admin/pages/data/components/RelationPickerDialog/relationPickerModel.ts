import { DataReadGenerationError, readRelationIds, RelationResolutionError, type MaterializedDataEntry } from '@core/data-read'

export type PickerSelection =
  | { kind: 'valid'; ids: string[] }
  | { kind: 'invalid'; value: unknown; error: unknown }

export type PickerRow =
  | { id: string; kind: 'ready'; title: string }
  | { id: string; kind: 'unavailable'; error: unknown }

/** Invalid drafts stay invalid until their author repairs them outside the picker. */
export function readPickerSelection(value: unknown, allowMultiple: boolean): PickerSelection {
  try {
    return { kind: 'valid', ids: readRelationIds(value, { allowMultiple }, 'relation') }
  } catch (error) {
    return { kind: 'invalid', value, error }
  }
}

/** Removing a member leaves the order of every remaining member unchanged. */
export function togglePickerRow(ids: readonly string[], id: string, allowMultiple: boolean): string[] {
  return ids.includes(id) ? ids.filter(candidate => candidate !== id) : allowMultiple ? [...ids, id] : [id]
}

export function movePickerRow(ids: readonly string[], index: number, direction: -1 | 1): string[] {
  const destination = index + direction
  const next = [...ids]
  if (index < 0 || index >= ids.length || destination < 0 || destination >= ids.length) return next
  const displaced = next[destination]
  next[destination] = next[index]
  next[index] = displaced
  return next
}

/** The native read provides identity and the already projected canonical title. */
export function presentPickerRows(
  rows: readonly MaterializedDataEntry[], tableId: string, generation: string,
): PickerRow[] {
  return rows.map<PickerRow>(row => {
    try {
      if (row.reference.tableId !== tableId || row.reference.rowId !== row.id) {
        throw new RelationResolutionError('relation.target', 'invalid_relation_target', 'A related row does not belong to the target table')
      }
      if (row.reference.generation !== generation) throw new DataReadGenerationError('relation.generation')
      return { id: row.id, kind: 'ready', title: row.title }
    } catch (error) {
      return { id: row.id, kind: 'unavailable', error }
    }
  })
}

/** Candidate ordering and search never control membership ordering or visibility. */
export function selectedPickerRows(ids: readonly string[], rows: readonly PickerRow[]): PickerRow[] {
  const byId = new Map(rows.map(row => [row.id, row]))
  return ids.map<PickerRow>((id, index) => byId.get(id) ?? {
    id,
    kind: 'unavailable',
    error: new RelationResolutionError(`relation[${index}]`, 'relation_unavailable',
      'The selected row is unavailable in this table. Reload or remove it before confirming.'),
  })
}
