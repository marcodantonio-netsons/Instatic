import { Type, type Static } from '@sinclair/typebox'
import { AnchorTargetSchema } from '../../shared/anchorTarget'
const HtmlAttributesPropSchemaOptions={default:{}}

export const LinkPropsSchema = Type.Object({
  href: Type.String({ default: '#' }),
  text: Type.String({ default: 'Click here' }),
  target: AnchorTargetSchema,
  htmlAttributes: Type.Record(Type.String(), Type.String(), HtmlAttributesPropSchemaOptions),
})

export type LinkStoredProps = Static<typeof LinkPropsSchema>
