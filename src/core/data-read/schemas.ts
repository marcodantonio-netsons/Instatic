import { Type, type Static } from '@core/utils/typeboxHelpers'
import { DataFieldSchema, DataRowCellsSchema, DataRowSchema, DataRowStatusSchema } from '@core/data/schemas'
import { PublicDataUserReferenceSchema } from '@core/data/publicDataUser'
import { DataReadMediaMapSchema } from '@core/data/mediaCells'

export const DataReadViewSchema = Type.Union([Type.Literal('draft'), Type.Literal('public')])
export type DataReadView = Static<typeof DataReadViewSchema>

/** One admitted row's content view; public version metadata is separate from editable cells. */
export const DataRowReadRecordSchema = Type.Object({
  row: DataRowSchema,
  version: Type.Union([Type.Object({ id: Type.String(), number: Type.Integer({ minimum: 1 }) }), Type.Null()]),
}, { additionalProperties: false })
export type DataRowReadRecord = Static<typeof DataRowReadRecordSchema>

/** Route resolution reads identity only; certificate admission precedes payload projection. */
export const DataRowRouteIdentitySchema = Type.Object({
  tableId: Type.String({ minLength: 1 }), tableSlug: Type.String({ minLength: 1 }),
  rowId: Type.String({ minLength: 1 }), slug: Type.String({ minLength: 1 }),
  version: Type.Union([Type.Object({ id: Type.String({ minLength: 1 }), number: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }), Type.Null()]),
}, { additionalProperties: false })
export type DataRowRouteIdentity = Static<typeof DataRowRouteIdentitySchema>

export const RepeaterEntryReferenceSchema = Type.Object({
  fieldId: Type.String({ minLength: 1 }),
  itemId: Type.String({ minLength: 1 }),
}, { additionalProperties: false })

/** Native identity belongs to the read frame, never to editable cell fields. */
export const DataEntryReferenceSchema = Type.Object({
  branchId: Type.String({ minLength: 1 }),
  view: DataReadViewSchema,
  generation: Type.String({ minLength: 1 }),
  tableId: Type.String({ minLength: 1 }),
  rowId: Type.String({ minLength: 1 }),
  repeater: Type.Optional(RepeaterEntryReferenceSchema),
}, { additionalProperties: false })
export type DataEntryReference = Static<typeof DataEntryReferenceSchema>

export const RelationFieldPathSchema = Type.Object({
  fieldId: Type.String({ minLength: 1 }),
  repeater: Type.Optional(RepeaterEntryReferenceSchema),
}, { additionalProperties: false })
export type RelationFieldPath = Static<typeof RelationFieldPathSchema>

/** Derived projection; cells still contain relation IDs, never hydrated objects. */
export const MaterializedDataEntrySchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  reference: DataEntryReferenceSchema,
  title: Type.String(),
  tableSlug: Type.String(),
  slug: Type.String(),
  status: DataRowStatusSchema,
  author: Type.Union([PublicDataUserReferenceSchema, Type.Null()]),
  publishedBy: Type.Union([PublicDataUserReferenceSchema, Type.Null()]),
  url: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(), updatedAt: Type.String(),
  publishedAt: Type.Union([Type.String(), Type.Null()]),
  version: Type.Union([Type.Object({ id: Type.String(), number: Type.Integer({ minimum: 1 }) }), Type.Null()]),
  cells: DataRowCellsSchema,
  fields: Type.Array(DataFieldSchema),
  media: DataReadMediaMapSchema,
}, { additionalProperties: false })
export type MaterializedDataEntry = Static<typeof MaterializedDataEntrySchema>

export const RelationMaterializationRequestSchema = Type.Object({
  owner: DataEntryReferenceSchema,
  field: RelationFieldPathSchema,
  /** Unsaved authoring references only; the service re-admits source and schema. */
  draftValue: Type.Optional(Type.Unknown()),
}, { additionalProperties: false })
export type RelationMaterializationRequest = Static<typeof RelationMaterializationRequestSchema>

export const RelationMaterializationSchema = Type.Object({
  owner: DataEntryReferenceSchema,
  field: RelationFieldPathSchema,
  targetTableId: Type.String({ minLength: 1 }),
  items: Type.Array(MaterializedDataEntrySchema),
  totalItems: Type.Integer({ minimum: 0 }),
  generation: Type.String({ minLength: 1 }),
}, { additionalProperties: false })
export type RelationMaterialization = Static<typeof RelationMaterializationSchema>

export const DataReadErrorCodeSchema = Type.Union([
  Type.Literal('invalid_relation_value'), Type.Literal('duplicate_relation_id'),
  Type.Literal('invalid_repeater_identity'), Type.Literal('invalid_relation_field'),
  Type.Literal('invalid_relation_target'), Type.Literal('relation_unavailable'),
  Type.Literal('relation_dependency_conflict'), Type.Literal('unbound_entry'),
  Type.Literal('invalid_collection_query'), Type.Literal('query_limit'),
  Type.Literal('stale_generation'),
  Type.Literal('uncertified_read_plan'),
])
export type DataReadErrorCode = Static<typeof DataReadErrorCodeSchema>

export const DataReadErrorEnvelopeSchema = Type.Object({
  error: Type.String(), code: DataReadErrorCodeSchema,
}, { additionalProperties: false })
