import { Type, type Static } from '@sinclair/typebox'

export const PropertyConditionSchema = Type.Recursive((Self) => Type.Union([
  Type.Object({ field: Type.String({ minLength: 1 }), eq: Type.Unknown() }, { additionalProperties: false }),
  Type.Object({ field: Type.String({ minLength: 1 }), notEq: Type.Unknown() }, { additionalProperties: false }),
  Type.Object({ field: Type.String({ minLength: 1 }), in: Type.Array(Type.Unknown()) }, { additionalProperties: false }),
  Type.Object({ field: Type.String({ minLength: 1 }), notIn: Type.Array(Type.Unknown()) }, { additionalProperties: false }),
  Type.Object({ and: Type.Array(Self) }, { additionalProperties: false }),
  Type.Object({ or: Type.Array(Self) }, { additionalProperties: false }),
]))

export type PropertyCondition = Static<typeof PropertyConditionSchema>

export function evaluateCondition(condition: PropertyCondition, values: Record<string, unknown>): boolean {
  if ('and' in condition) return condition.and.every((child) => evaluateCondition(child, values))
  if ('or' in condition) return condition.or.some((child) => evaluateCondition(child, values))
  if ('eq' in condition) return values[condition.field] === condition.eq
  if ('notEq' in condition) return values[condition.field] !== condition.notEq
  if ('in' in condition) return condition.in.includes(values[condition.field])
  return !condition.notIn.includes(values[condition.field])
}
