import { Type } from '@sinclair/typebox'
import { OptionalFormConditionSchema, FormValueExpressionSchema, TURNSTILE_LANGUAGES } from '../shared/forms'

const HtmlAttributesPropSchemaOptions = { default: {} } as const

const htmlAttributes = Type.Record(Type.String(), Type.String(), HtmlAttributesPropSchemaOptions)

export const ConditionalPropsSchema = Type.Object({ routePath: Type.String({ default: '/' }), condition: OptionalFormConditionSchema, disableWhenHidden: Type.Boolean({ default: true }) })
export const OutputPropsSchema = Type.Object({ routePath: Type.String({ default: '/' }), fieldName: Type.String({ default: '' }), text: Type.String({ default: '' }), cssVariable: Type.String({ default: '', pattern: '^$|^--[A-Za-z][A-Za-z0-9_-]*$' }), tag: Type.String({ default: 'custom' }), customTag: Type.String({ default: 'output' }), htmlAttributes })
export const FormLinkPropsSchema = Type.Object({ routePath: Type.String({ default: '/' }), valueField: Type.String({ default: '' }), expression: Type.Union([FormValueExpressionSchema, Type.Null()], { default: null }), formId: Type.String({ default: '' }), href: Type.String({ default: '' }), text: Type.String({ default: 'Continue' }), target: Type.Union([Type.Literal('_self'), Type.Literal('_blank')], { default: '_self' }), htmlAttributes })
export const FormStepPropsSchema = Type.Object({ routePath: Type.String({ default: '/' }), fieldName: Type.String({ default: '' }), step: Type.Number({ default: 1 }), label: Type.String({ default: 'Increase' }), disabledWhen: OptionalFormConditionSchema, htmlAttributes })
export const TurnstilePropsSchema = Type.Object({
  routePath: Type.String({ default: '/' }),
  siteKey: Type.String({ default: '' }),
  action: Type.String({ default: '' }),
  language: Type.Union(TURNSTILE_LANGUAGES.map((language) => Type.Literal(language)), { default: 'auto' }),
  theme: Type.Union([Type.Literal('auto'), Type.Literal('light'), Type.Literal('dark')], { default: 'auto' }),
  responseFieldName: Type.String({ minLength: 1, default: 'cf-turnstile-response' }),
})
