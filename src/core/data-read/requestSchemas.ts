import { Type, type Static } from '@core/utils/typeboxHelpers'
import { DataEntryReferenceSchema, DataReadViewSchema, RelationFieldPathSchema, RelationMaterializationSchema } from './schemas'
import { DATA_QUERY_LIMITS, DataCollectionQuerySchema } from './querySchema'

const ReadContext = {
  view: Type.Optional(DataReadViewSchema),
  language: Type.Optional(Type.String({ minLength: 1 })),
  generation: Type.Optional(Type.String({ minLength: 1 })),
}

export const DataCollectionReadRequestSchema = Type.Object({
  ...ReadContext, query: DataCollectionQuerySchema,
}, { additionalProperties: false })
export type DataCollectionReadRequest = Static<typeof DataCollectionReadRequestSchema>

export const DataRelationReadInputSchema = Type.Object({
  // The server supplies branch, view and the captured generation after auth.
  owner: Type.Omit(DataEntryReferenceSchema, ['branchId', 'view', 'generation']),
  field: RelationFieldPathSchema,
  draftValue: Type.Optional(Type.Unknown()),
}, { additionalProperties: false })
export type DataRelationReadInput = Static<typeof DataRelationReadInputSchema>

export const DataRelationsReadRequestSchema = Type.Object({
  ...ReadContext,
  requests: Type.Array(DataRelationReadInputSchema, { maxItems: DATA_QUERY_LIMITS.demands }),
}, { additionalProperties: false })
export type DataRelationsReadRequest = Static<typeof DataRelationsReadRequestSchema>

export const DataRelationsReadResponseSchema = Type.Object({
  relations: Type.Array(RelationMaterializationSchema),
  generation: Type.String({ minLength: 1 }),
}, { additionalProperties: false })
export type DataRelationsReadResponse = Static<typeof DataRelationsReadResponseSchema>
