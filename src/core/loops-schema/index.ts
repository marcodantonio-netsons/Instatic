/** Pure data shape shared by loop sources and render contexts. */
import { Type, type Static } from '@sinclair/typebox'

export const LoopItemSchema = Type.Object({
  /** Stable identity — used for keying in the editor and infinite-load dedup. */
  id: Type.String(),
  /** Field values keyed by `LoopSourceField.id`. */
  fields: Type.Record(Type.String(), Type.Unknown()),
})

export type LoopItem = Static<typeof LoopItemSchema>

/** Only declared source filters can receive visitor values. */
export const LoopQueryBindingSchema = Type.Object({
  filterKey: Type.String({ minLength: 1 }),
  formId: Type.String({ minLength: 1 }),
  fieldName: Type.String({ minLength: 1 }),
  queryParameter: Type.String({ minLength: 1 }),
  valueType: Type.Optional(Type.Union([Type.Literal('text'), Type.Literal('stringArray')])),
  /** Suspend this filter while another bound field of the same form has text. */
  whenFieldEmpty: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false })
export const LoopQueryBindingsSchema = Type.Array(LoopQueryBindingSchema, { default: [] })
export type LoopQueryBinding = Static<typeof LoopQueryBindingSchema>

export const LoopSearchConfigurationSchema = Type.Object({
  fields: Type.Array(Type.Object({
    field: Type.String({ minLength: 1 }),
    phraseWeight: Type.Number({ minimum: 0, default: 0 }),
    termWeight: Type.Number({ minimum: 0, default: 1 }),
  }), { minItems: 1, maxItems: 32 }),
  match: Type.Union([Type.Literal('contains'), Type.Literal('allTerms'), Type.Literal('anyTerm')], { default: 'contains' }),
  rank: Type.Union([Type.Literal('source'), Type.Literal('score')], { default: 'source' }),
  phraseBoost: Type.Union([Type.Literal('sum'), Type.Literal('first')], { default: 'sum' }),
  tieBreakField: Type.Optional(Type.String({ minLength: 1 })),
  normalization: Type.Object({
    lowercase: Type.Boolean({ default: true }),
    removeDiacritics: Type.Boolean({ default: false }),
    punctuationToSpaces: Type.Boolean({ default: false }),
    stripLeading: Type.String({ default: '' }),
    trim: Type.Boolean({ default: true }),
  }),
})
export type LoopSearchConfiguration = Static<typeof LoopSearchConfigurationSchema>

export const LoopPageResponseSchema = Type.Object({
  html: Type.String(),
  hasMore: Type.Boolean(),
  pageNumber: Type.Integer({ minimum: 1 }),
  totalItems: Type.Integer({ minimum: 0 }),
})
export type LoopPageResponse = Static<typeof LoopPageResponseSchema>
