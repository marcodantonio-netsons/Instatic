import { Type, type Static } from '@core/utils/typeboxHelpers'
import { HtmlAttributesPropSchemaOptions } from '@modules/base/shared/htmlAttributes'

export const ScrollStatePropsSchema = Type.Object({
  tag: Type.String({ default: 'div' }),
  customTag: Type.String({ default: '' }),
  targetId: Type.String({ default: '', pattern: '^$|^[A-Za-z][A-Za-z0-9_.:-]*$' }),
  edge: Type.Union([Type.Literal('start'), Type.Literal('end')], { default: 'end' }),
  offset: Type.Number({ default: 0 }),
  htmlAttributes: Type.Record(Type.String(), Type.String(), HtmlAttributesPropSchemaOptions),
})

export const ScrollStatePublishSchema = Type.Object({
  props: Type.Object({ targetId: Type.String({ minLength: 1, pattern: '^[A-Za-z][A-Za-z0-9_.:-]*$' }) }),
})
export type ScrollStateProps = Static<typeof ScrollStatePropsSchema>

/** One attribute contract for the canvas and the publisher. Styling remains authored. */
export function scrollStateAttributes(props: ScrollStateProps) {
  return {
    'data-instatic-scroll-state': 'before',
    'data-instatic-scroll-target': props.targetId,
    'data-instatic-scroll-edge': props.edge,
    'data-instatic-scroll-offset': String(props.offset),
  }
}
