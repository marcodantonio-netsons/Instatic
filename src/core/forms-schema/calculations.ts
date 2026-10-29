import { Type, type Static } from '@sinclair/typebox'

const ScalarSchema = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])
export const FormValueSchema = Type.Union([ScalarSchema, Type.Array(ScalarSchema)])
export type FormValue = Static<typeof FormValueSchema>
/** Closed data expressions: never JavaScript, property paths, or executable source. */
export const FormValueExpressionSchema = Type.Recursive((Self) => Type.Union([
  Type.Object({ literal: FormValueSchema }, { additionalProperties: false }),
  Type.Object({ field: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  Type.Object({ op: Type.Union([Type.Literal('add'),Type.Literal('subtract'),Type.Literal('multiply'),Type.Literal('divide'),Type.Literal('min'),Type.Literal('max'),Type.Literal('round'),Type.Literal('floor'),Type.Literal('trunc')]), args: Type.Array(Self, { minItems: 1 }) }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('lookup'), value: Self, cases: Type.Record(Type.String(), Self), otherwise: Self }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('concat'), values: Type.Array(Self) }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('trim'), value: Self }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('replace'), value: Self, search: Self, replacement: Self }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('length'), value: Self }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('contains'), value: Self, item: Self }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('url'), base: Self, query: Type.Record(Type.String(), Self) }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('number-format'), value: Self, locale: Type.String({ minLength: 1 }), minimumFractionDigits: Type.Integer({ minimum: 0, maximum: 20 }), maximumFractionDigits: Type.Integer({ minimum: 0, maximum: 20 }), style: Type.Optional(Type.Union([Type.Literal('decimal'),Type.Literal('currency'),Type.Literal('percent')])), currency: Type.Optional(Type.String({ pattern: '^[A-Z]{3}$' })) }, { additionalProperties: false }),
]), { $id: 'FormValueExpression' })
export type FormValueExpression = Static<typeof FormValueExpressionSchema>
export const FormCalculationsSchema = Type.Record(Type.String({ pattern: '^[A-Za-z][A-Za-z0-9_-]*$' }), FormValueExpressionSchema, { default: {}, maxProperties: 128 })
export type FormCalculations = Static<typeof FormCalculationsSchema>
export const FormValueConstraintSchema = Type.Object({
  fieldName: Type.String({ minLength: 1 }), minValueField: Type.Optional(Type.String()), maxValueField: Type.Optional(Type.String()),
  min: Type.Optional(Type.Number()), max: Type.Optional(Type.Number()),
}, { additionalProperties: false })
export type FormValueConstraint = Static<typeof FormValueConstraintSchema>
export const FormValuesEventDetailSchema = Type.Object({ formId: Type.String({ minLength: 1 }), values: Type.Record(Type.String(), Type.Unknown()) }, { additionalProperties: false })
export type FormValuesEventDetail = Static<typeof FormValuesEventDetailSchema>
export const FormValuesRequestSchema = Type.Object({ formId: Type.String({ minLength: 1 }) }, { additionalProperties: false })
