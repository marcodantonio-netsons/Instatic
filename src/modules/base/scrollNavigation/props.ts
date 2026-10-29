import { Type, type Static } from '@core/utils/typeboxHelpers'
import { HtmlAttributesPropSchemaOptions } from '@modules/base/shared/htmlAttributes'
const attributes = Type.Record(Type.String(), Type.String(), HtmlAttributesPropSchemaOptions)
export const ScrollRailPropsSchema = Type.Object({
  stepRatio: Type.Number({ minimum: 0.01, maximum: 2, default: 0.82 }),
  minimumStep: Type.Number({ minimum: 0, default: 280 }),
  dragEnabled: Type.Boolean({ default: true }),
  htmlAttributes: attributes,
})
export const ScrollControlsPropsSchema = Type.Object({ htmlAttributes: attributes })
export const ScrollButtonPropsSchema = Type.Object({
  direction: Type.Union([Type.Literal('previous'), Type.Literal('next')], { default: 'next' }),
  label: Type.String({ default: 'Next' }),
  disabled: Type.Boolean({ default: false }),
  htmlAttributes: attributes,
})
export const SectionNavPropsSchema = Type.Object({
  activationOffset: Type.Number({ minimum: 0, default: 160 }),
  htmlAttributes: attributes,
})
export type ScrollRailProps = Static<typeof ScrollRailPropsSchema>
export type ScrollControlsProps = Static<typeof ScrollControlsPropsSchema>
export type ScrollButtonProps = Static<typeof ScrollButtonPropsSchema>
export type SectionNavProps = Static<typeof SectionNavPropsSchema>
const key = Type.String({ default: '', pattern: '^$|^[A-Za-z][A-Za-z0-9_-]*$' })
export const TabsPropsSchema = Type.Object({ groupId: key, htmlAttributes: attributes })
export const TabPropsSchema = Type.Object({
  label: Type.String({ default: 'Tab' }),
  initiallySelected: Type.Boolean({ default: false }),
  tabKey: key,
  htmlAttributes: attributes,
})
export const TabPanelPropsSchema = Type.Object({
  initiallyHidden: Type.Boolean({ default: true }),
  htmlAttributes: attributes,
})
export type TabsProps = Static<typeof TabsPropsSchema>
export type TabProps = Static<typeof TabPropsSchema>
export type TabPanelProps = Static<typeof TabPanelPropsSchema>
export const TabLinkPropsSchema = Type.Object({ groupId:key,tabKey:key,href:Type.String({default:'#'}),text:Type.String({default:'Open tab'}),target:Type.Union([Type.Literal('_self'),Type.Literal('_blank')],{default:'_self'}),htmlAttributes:attributes })
export type TabLinkProps = Static<typeof TabLinkPropsSchema>
