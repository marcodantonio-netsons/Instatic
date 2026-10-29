import { Type } from '@sinclair/typebox'
import { OptionalFormConditionSchema, FormValueExpressionSchema } from '@core/forms-schema'
import { HtmlAttributesPropSchemaOptions } from '@modules/base/shared/htmlAttributes'

const htmlAttributes = Type.Record(Type.String(), Type.String(), HtmlAttributesPropSchemaOptions)

export const ConditionalPropsSchema = Type.Object({ condition: OptionalFormConditionSchema, disableWhenHidden: Type.Boolean({ default: true }) })
export const OutputPropsSchema = Type.Object({ fieldName: Type.String({ default: '' }), text: Type.String({ default: '' }), cssVariable: Type.String({ default: '', pattern: '^$|^--[A-Za-z][A-Za-z0-9_-]*$' }), tag: Type.String({ default: 'custom' }), customTag: Type.String({ default: 'output' }), htmlAttributes })
export const FormLinkPropsSchema = Type.Object({ valueField: Type.String({ default: '' }), expression: Type.Union([FormValueExpressionSchema, Type.Null()], { default: null }), formId: Type.String({ default: '' }), href: Type.String({ default: '' }), text: Type.String({ default: 'Continue' }), target: Type.Union([Type.Literal('_self'), Type.Literal('_blank')], { default: '_self' }), htmlAttributes })
export const FormStepPropsSchema = Type.Object({ fieldName: Type.String({ default: '' }), step: Type.Number({ default: 1 }), label: Type.String({ default: 'Increase' }), disabledWhen: OptionalFormConditionSchema, htmlAttributes })
