import { Type, type Static } from '@sinclair/typebox'

export const HtmlAttributesSchema = Type.Record(Type.String(), Type.String(), { default: {} })
const HtmlAttributesJsonSchema = Type.String({ default: '' })

export const LoopCountPropsSchema = Type.Object({
  loopIds: Type.String({ default: '' }),
  queryConfigIds: Type.String({ default: '' }),
  tag: Type.String({ default: 'custom' }),
  customTag: Type.String({ default: 'span' }),
  metric: Type.Union([
    Type.Literal('total'),
    Type.Literal('loaded'),
    Type.Literal('remaining'),
    Type.Literal('progress'),
  ], { default: 'total' }),
  htmlAttributes: HtmlAttributesSchema,
  htmlAttributesJson: HtmlAttributesJsonSchema,
}, { additionalProperties: false })
export type LoopCountProps = Static<typeof LoopCountPropsSchema>

export const LoopConditionalPropsSchema = Type.Object({
  loopIds: Type.String({ default: '' }),
  queryConfigIds: Type.String({ default: '' }),
  tag: Type.String({ default: 'div' }),
  customTag: Type.String({ default: '' }),
  when: Type.Union([Type.Literal('results'), Type.Literal('empty')], { default: 'results' }),
  htmlAttributes: HtmlAttributesSchema,
  htmlAttributesJson: HtmlAttributesJsonSchema,
}, { additionalProperties: false })
export type LoopConditionalProps = Static<typeof LoopConditionalPropsSchema>

export const LoopMorePropsSchema = Type.Object({
  loopId: Type.String({ default: '' }),
  mode: Type.Union([Type.Literal('page'), Type.Literal('all')], { default: 'page' }),
  label: Type.String({ default: 'Load more' }),
  loadingLabel: Type.String({ default: 'Loading…' }),
  retryLabel: Type.String({ default: 'Try again' }),
  htmlAttributes: HtmlAttributesSchema,
  htmlAttributesJson: HtmlAttributesJsonSchema,
}, { additionalProperties: false })
export type LoopMoreProps = Static<typeof LoopMorePropsSchema>
