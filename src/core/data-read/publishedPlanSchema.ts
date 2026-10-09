import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'
import { RelationResolutionError } from './errors'

const Identifier = Type.String({ minLength: 1 })

/** Render dependencies are metadata, not permission grants. */
export const DataRenderQueryInputsSchema = Type.Union([
  Type.Object({ kind: Type.Literal('declared'), names: Type.Array(Identifier, { uniqueItems: true }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('all') }, { additionalProperties: false }),
])
export type DataRenderQueryInputs = Static<typeof DataRenderQueryInputsSchema>

/** Certified by publication, stored beside its snapshot; never accepted from visitor input. */
export const PublishedDataReadPlanSchema = Type.Object({
  scopes: Type.Array(Type.Object({
    id: Identifier,
    tableIds: Type.Array(Identifier, { uniqueItems: true }),
    /** The certified row-read scope is sufficient; administrative capabilities stay out of the plan. */
    rowScope: Type.Union([
      Type.Object({ kind: Type.Literal('all') }, { additionalProperties: false }),
      Type.Object({ kind: Type.Literal('owned'), userId: Identifier }, { additionalProperties: false }),
    ]),
    queryInputs: DataRenderQueryInputsSchema,
    relations: Type.Array(Type.Object({
      sourceTableId: Identifier, fieldId: Identifier,
      repeaterFieldId: Type.Optional(Identifier), targetTableId: Identifier,
    }, { additionalProperties: false })),
  }, { additionalProperties: false })),
}, { additionalProperties: false })
export type PublishedDataReadPlan = Static<typeof PublishedDataReadPlanSchema>

/** A stored certificate has one unambiguous declaration per native scope. */
export function parsePublishedDataReadPlan(value: unknown): PublishedDataReadPlan {
  const parsed = safeParseValue(PublishedDataReadPlanSchema, value)
  if (!parsed.ok) throw new RelationResolutionError('dataReadPlan', 'uncertified_read_plan', 'The published data read plan is invalid')
  const ids = new Set<string>()
  for (const scope of parsed.value.scopes) {
    if (ids.has(scope.id)) throw new RelationResolutionError('dataReadPlan.scopes', 'uncertified_read_plan', 'The published data read plan contains ambiguous scopes')
    ids.add(scope.id)
    const edges = new Set<string>()
    for (const edge of scope.relations) {
      const key = JSON.stringify([edge.sourceTableId, edge.fieldId, edge.repeaterFieldId ?? null, edge.targetTableId])
      if (edges.has(key) || !scope.tableIds.includes(edge.sourceTableId) || !scope.tableIds.includes(edge.targetTableId)) {
        throw new RelationResolutionError('dataReadPlan.relations', 'uncertified_read_plan', 'The published relation declaration is invalid')
      }
      edges.add(key)
    }
  }
  return parsed.value
}
