import { Type, type Static } from '@core/utils/typeboxHelpers'
import { SiteVisitorPreferencesSchema, VisitorPreferencePatchSchema } from '@core/visitor-preferences-schema'
import { HtmlAttributesPropSchemaOptions } from '@modules/base/shared/htmlAttributes'
import { PreferenceFeedbackPropsSchema } from './props'

const Caption = Type.String({ minLength: 1, pattern: '\\S' })
const captions = Object.fromEntries(Object.keys(PreferenceFeedbackPropsSchema.properties).map(key => [key, Caption]))
const configured = Type.Object({ settings: Type.Object({ visitorPreferences: SiteVisitorPreferencesSchema }) })

export const PreferenceTogglePropsSchema = Type.Object({
  on: VisitorPreferencePatchSchema,
  off: VisitorPreferencePatchSchema,
  labelOn: Type.String({ default: 'Use default preferences' }),
  labelOff: Type.String({ default: 'Use alternate preferences' }),
  ariaLabelOn: Type.String({ default: '' }),
  ariaLabelOff: Type.String({ default: '' }),
  titleOn: Type.String({ default: '' }),
  titleOff: Type.String({ default: '' }),
  htmlAttributes: Type.Record(Type.String(), Type.String(), HtmlAttributesPropSchemaOptions),
  ...PreferenceFeedbackPropsSchema.properties,
})
export type PreferenceToggleProps = Static<typeof PreferenceTogglePropsSchema>
export const PreferenceTogglePublishSchema = Type.Intersect([configured, Type.Object({ props: Type.Intersect([
  Type.Object(captions),
  Type.Object({ ariaLabelOn: Type.Union([Type.Literal(''), Caption]), ariaLabelOff: Type.Union([Type.Literal(''), Caption]) }),
  Type.Union([
    Type.Object({ labelOn: Caption, labelOff: Caption }),
    Type.Object({ labelOn: Type.Literal(''), labelOff: Type.Literal(''), ariaLabelOn: Caption, ariaLabelOff: Caption }),
  ]),
]) })])

export const PreferenceOutputPropsSchema = Type.Object({
  tag: Type.Union(['p','h1','h2','h3','h4','h5','h6','span','div','small','strong','em'].map(tag => Type.Literal(tag)), { default: 'span' }),
  when: VisitorPreferencePatchSchema,
  textOn: Type.String({ default: 'Alternate preferences' }),
  textOff: Type.String({ default: 'Default preferences' }),
  htmlAttributes: Type.Record(Type.String(), Type.String(), HtmlAttributesPropSchemaOptions),
})
export type PreferenceOutputProps = Static<typeof PreferenceOutputPropsSchema>
export const PreferenceOutputPublishSchema = Type.Intersect([configured, Type.Object({ props: Type.Object({ textOn: Caption, textOff: Caption }) })])
