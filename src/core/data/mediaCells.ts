import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'
import { readDataRepeaterValue } from './localizedCells'
import type { DataField, DataRowCells, RepeaterItemField } from './schemas'

/** Only public presentation metadata leaves the authorized row read. */
export const DataReadMediaSchema = Type.Object({
  publicPath: Type.String({ minLength: 1 }),
  mimeType: Type.String(), altText: Type.String(),
  width: Type.Union([Type.Number(), Type.Null()]),
  height: Type.Union([Type.Number(), Type.Null()]),
}, { additionalProperties: false })
export type DataReadMedia = Static<typeof DataReadMediaSchema>
export const DataReadMediaMapSchema = Type.Record(Type.String(), DataReadMediaSchema)
export type DataReadMediaMap = Static<typeof DataReadMediaMapSchema>

export class DataMediaValidationError extends Error {
  constructor(readonly path: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DataMediaValidationError'
  }
}

/** Schema cardinality is authoritative; malformed values are never filtered out. */
export function readDataMediaIds(value: unknown, multiple: boolean, path: string): string[] {
  if (value === undefined || value === null) return []
  const parsed = safeParseValue(multiple
    ? Type.Array(Type.String({ minLength: 1 })) : Type.String({ minLength: 1 }), value)
  if (!parsed.ok) throw new DataMediaValidationError(path, 'The media cell does not match its declared cardinality')
  const ids = typeof parsed.value === 'string' ? [parsed.value] : parsed.value
  if (ids.some(id => id.trim() !== id)) throw new DataMediaValidationError(path, 'Media identities must be nonempty and contain no surrounding whitespace')
  return ids
}

type MediaField = DataField | RepeaterItemField

/** Collect schema-declared demand only, including real ordered repeater items. */
export function collectDataMediaIds(cells: DataRowCells, fields: readonly MediaField[], path = 'cells'): string[] {
  return fields.flatMap(field => {
    const fieldPath = `${path}.${field.id}`
    if (field.type === 'media') return readDataMediaIds(cells[field.id], field.allowMultiple === true, fieldPath)
    if (field.type === 'repeater') return readDataRepeaterValue(cells[field.id], fieldPath)
      .flatMap(item => collectDataMediaIds(item.cells, field.fields, `${fieldPath}.${item.id}.cells`))
    return []
  })
}

/** Derived binding values preserve all positions; an unavailable asset is an error. */
export function projectDataMediaCells(cells: DataRowCells, fields: readonly MediaField[], media: DataReadMediaMap, path = 'cells'): DataRowCells {
  const projected = structuredClone(cells)
  for (const field of fields) {
    const fieldPath = `${path}.${field.id}`
    if (field.type === 'media') {
      const paths = readDataMediaIds(cells[field.id], field.allowMultiple === true, fieldPath).map(id => {
        const asset = media[id]
        if (!asset) throw new DataMediaValidationError(fieldPath, 'A referenced media asset is unavailable')
        return asset.publicPath
      })
      projected[field.id] = field.allowMultiple === true ? paths : paths[0] ?? null
    } else if (field.type === 'repeater') {
      projected[field.id] = readDataRepeaterValue(cells[field.id], fieldPath).map(item => ({
        id: item.id, cells: projectDataMediaCells(item.cells, field.fields, media, `${fieldPath}.${item.id}.cells`),
      }))
    }
  }
  return projected
}
