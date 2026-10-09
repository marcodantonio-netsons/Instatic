import { Type, type Static } from '@core/utils/typeboxHelpers'
import { MaterializedDataEntrySchema, RelationFieldPathSchema } from './schemas'

export const DATA_QUERY_LIMITS = Object.freeze({
  pageSize: 500, candidates: 20_000, membership: 20_000,
  demands: 2_000, depth: 12, predicateDepth: 4, predicates: 64,
  batchSize: 400, searchLength: 512,
})
const Identifier = Type.String({ minLength: 1 })
const Scalar = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])
const Direction = Type.Union([Type.Literal('asc'), Type.Literal('desc')])
const SourceOwner = Type.Object({ tableId: Identifier, rowId: Identifier }, { additionalProperties: false })

export const DataCollectionSourceSchema = Type.Union([
  Type.Object({ kind: Type.Literal('table'), tableId: Identifier }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('entries'), tableId: Identifier,
    rowIds: Type.Array(Identifier, { maxItems: DATA_QUERY_LIMITS.membership, uniqueItems: true }),
  }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('relation'), owner: SourceOwner, field: RelationFieldPathSchema }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('inbound'), tableId: Identifier,
    sourceTableId: Identifier, fieldId: Identifier,
    ownerRowIds: Type.Array(Identifier, { maxItems: DATA_QUERY_LIMITS.demands, uniqueItems: true }),
  }, { additionalProperties: false }),
])
export type DataCollectionSource = Static<typeof DataCollectionSourceSchema>

const ScalarPredicate = Type.Object({
  kind: Type.Literal('field'), fieldId: Identifier,
  operator: Type.Union([
    Type.Literal('eq'), Type.Literal('ne'), Type.Literal('gt'), Type.Literal('gte'),
    Type.Literal('lt'), Type.Literal('lte'), Type.Literal('like'),
  ]),
  value: Scalar,
}, { additionalProperties: false })
const MembershipPredicate = Type.Object({
  kind: Type.Literal('relation'), fieldId: Identifier,
  operator: Type.Union([Type.Literal('contains'), Type.Literal('notContains')]),
  rowId: Identifier,
}, { additionalProperties: false })
const PresencePredicate = Type.Object({
  kind: Type.Literal('presence'), fieldId: Identifier,
  operator: Type.Union([Type.Literal('empty'), Type.Literal('present')]),
}, { additionalProperties: false })

export const DataPredicateSchema = Type.Recursive(Self => Type.Union([
  ScalarPredicate, MembershipPredicate, PresencePredicate,
  Type.Object({
    kind: Type.Union([Type.Literal('all'), Type.Literal('any')]),
    predicates: Type.Array(Self, { minItems: 1, maxItems: DATA_QUERY_LIMITS.predicates }),
  }, { additionalProperties: false }),
]), { $id: 'DataPredicate' })
export type DataPredicate = Static<typeof DataPredicateSchema>

export const DataCollectionOrderSchema = Type.Union([
  Type.Object({ kind: Type.Literal('membership'), direction: Direction }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('field'), fieldId: Identifier, direction: Direction }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('row'),
    field: Type.Union([
      Type.Literal('title'), Type.Literal('slug'), Type.Literal('createdAt'),
      Type.Literal('updatedAt'), Type.Literal('publishedAt'), Type.Literal('status'),
    ]), direction: Direction,
  }, { additionalProperties: false }),
])
export type DataCollectionOrder = Static<typeof DataCollectionOrderSchema>

export const DataCollectionQuerySchema = Type.Object({
  source: DataCollectionSourceSchema,
  where: Type.Optional(DataPredicateSchema),
  search: Type.Optional(Type.Object({
    fieldIds: Type.Array(Identifier, { maxItems: 64, uniqueItems: true }),
    title: Type.Optional(Type.Boolean()),
    text: Type.String({ maxLength: DATA_QUERY_LIMITS.searchLength }),
  }, { additionalProperties: false })),
  order: Type.Optional(Type.Array(DataCollectionOrderSchema, { maxItems: 8 })),
  offset: Type.Integer({ minimum: 0, maximum: 1_000_000, default: 0 }),
  limit: Type.Integer({ minimum: 1, maximum: DATA_QUERY_LIMITS.pageSize, default: 100 }),
}, { additionalProperties: false })
export type DataCollectionQuery = Static<typeof DataCollectionQuerySchema>

/** Full source cardinality and matched count remain distinct from the delivered page. */
export const DataCollectionResultSchema = Type.Object({
  items: Type.Array(MaterializedDataEntrySchema),
  cardinalityCount: Type.Integer({ minimum: 0 }),
  totalItems: Type.Integer({ minimum: 0 }),
  offset: Type.Integer({ minimum: 0 }), limit: Type.Integer({ minimum: 1 }),
  hasMore: Type.Boolean(),
  nextOffset: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  generation: Type.String({ minLength: 1 }),
}, { additionalProperties: false })
export type DataCollectionResult = Static<typeof DataCollectionResultSchema>

/** Only this published declaration may turn visitor URL values into query operands. */
export const DataQueryUrlInputSchema = Type.Union([
  Type.Object({
    parameter: Identifier, operand: Type.Literal('search'),
  }, { additionalProperties: false }),
  Type.Object({
    parameter: Identifier, operand: Type.Literal('predicate'),
    fieldId: Identifier, kind: Type.Union([Type.Literal('field'), Type.Literal('relation')]),
    allowedValues: Type.Array(Identifier, { maxItems: DATA_QUERY_LIMITS.membership, uniqueItems: true }),
  }, { additionalProperties: false }),
  Type.Object({
    parameter: Identifier, operand: Type.Literal('relationOwner'),
    ownerTableId: Identifier, field: RelationFieldPathSchema,
    allowedRowIds: Type.Array(Identifier, { minItems: 1, maxItems: DATA_QUERY_LIMITS.membership, uniqueItems: true }),
  }, { additionalProperties: false }),
  Type.Object({
    parameter: Identifier, operand: Type.Literal('pageSize'),
    maximum: Type.Integer({ minimum: 1, maximum: DATA_QUERY_LIMITS.pageSize }),
  }, { additionalProperties: false }),
])
export type DataQueryUrlInput = Static<typeof DataQueryUrlInputSchema>
