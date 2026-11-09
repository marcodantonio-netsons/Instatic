import { Type, type Static } from '@sinclair/typebox'
const HtmlAttributesPropSchemaOptions={default:{}}

export const ContainerPropsSchema = Type.Object({
  tag: Type.String({ default: 'div' }),
  customTag: Type.String({ default: '' }),
  htmlAttributes: Type.Record(Type.String(), Type.String(), HtmlAttributesPropSchemaOptions),
})

export type ContainerStoredProps = Static<typeof ContainerPropsSchema>
