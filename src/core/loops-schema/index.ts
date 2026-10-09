/** Pure data shape shared by loop sources and render contexts. */
import { Type, type Static } from '@sinclair/typebox'
import { DataEntryReferenceSchema } from '@core/data-read'
import { DataFieldSchema, DataRowCellsSchema } from '@core/data/schemas'
import { DataReadMediaMapSchema } from '@core/data/mediaCells'

export const LoopItemSchema = Type.Object({
  /** Stable identity — used for keying in the editor and infinite-load dedup. */
  id: Type.String({ minLength: 1 }),
  /** Field values keyed by `LoopSourceField.id`. */
  fields: Type.Record(Type.String(), Type.Unknown()),
  /** Trusted read-frame provenance, outside user-editable field values. */
  dataEntry: Type.Optional(Type.Object({
    reference: DataEntryReferenceSchema,
    fields: Type.Array(DataFieldSchema),
    cells: DataRowCellsSchema,
    media: DataReadMediaMapSchema,
  }, { additionalProperties: false })),
})

export type LoopItem = Static<typeof LoopItemSchema>

export const LoopFetchResultSchema = Type.Object({
  items: Type.Array(LoopItemSchema),
  totalItems: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false })

export const LoopPageResponseSchema = Type.Object({
  html: Type.String(),
  hasMore: Type.Boolean(),
  pageNumber: Type.Integer({ minimum: 1 }),
})
export type LoopPageResponse = Static<typeof LoopPageResponseSchema>
