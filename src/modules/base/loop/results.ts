import { registry, type ModuleDefinition } from '@core/module-engine'
import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import { readSummaryLoopIds } from '@core/loops'
import { htmlAttributesAttr, escapeHtml } from '@core/publisher'
import { resolveHtmlTag } from '@core/htmlAttributes'
import { HtmlAttributesPropSchemaOptions, htmlAttributesControl } from '@modules/base/shared/htmlAttributes'
import { BoxStackSolidIcon } from 'pixel-art-icons/icons/box-stack-solid'
import { LoopCountEditor, LoopConditionalEditor } from './LoopResultEditor'

const common = {
  loopIds: Type.String({ default: '' }),
  tag: Type.String({ default: 'span' }), customTag: Type.String({ default: '' }),
  htmlAttributes: Type.Record(Type.String(), Type.String(), HtmlAttributesPropSchemaOptions),
}
const CountPropsSchema = Type.Object({ ...common, tag: Type.String({ default: 'custom' }), customTag: Type.String({ default: 'span' }), metric: Type.Union([Type.Literal('total'), Type.Literal('loaded'), Type.Literal('remaining'), Type.Literal('progress')], { default: 'total' }) })
const ConditionalPropsSchema = Type.Object({ ...common, tag: Type.String({ default: 'div' }),
  when: Type.Union([Type.Literal('results'), Type.Literal('empty')], { default: 'results' }),
})
const controls = { loopIds: { type: 'text', label: 'Loop IDs (space-separated)' } as const, htmlAttributes: htmlAttributesControl() }

export const LoopCountModule: ModuleDefinition<Static<typeof CountPropsSchema>> = {
  id: 'base.loop-count', name: 'Loop count', description: 'Show the total matching entries of one or more loops.',
  category: 'Layout', version: '1.0.0', icon: BoxStackSolidIcon, trusted: true, canHaveChildren: false,
  schema: { ...controls, metric: { type: 'select', label: 'Count', options: [{ label: 'Total matches', value: 'total' }, { label: 'Loaded entries', value: 'loaded' }, { label: 'Remaining entries', value: 'remaining' }, { label: 'Loaded / total', value: 'progress' }] } }, propsSchema: CountPropsSchema, defaults: Value.Create(CountPropsSchema), component: LoopCountEditor,
  htmlTag: props => resolveHtmlTag(props.tag, props.customTag),
  render: props => {
    const total = Number((props as Record<string, unknown>)._loopTotal ?? 0)
    const loaded = Number((props as Record<string, unknown>)._loopLoaded ?? 0)
    const value = props.metric === 'loaded' ? loaded : props.metric === 'remaining' ? Math.max(0,total-loaded) : props.metric === 'progress' ? `${loaded}/${total}` : total
    const tag = resolveHtmlTag(props.tag, props.customTag)
    return { html: `<${tag} data-instatic-loop-count="${escapeHtml(JSON.stringify(readSummaryLoopIds(props.loopIds)))}" data-instatic-loop-count-metric="${props.metric}"${htmlAttributesAttr(props.htmlAttributes)}>${value}</${tag}>` }
  },
}
export const LoopConditionalModule: ModuleDefinition<Static<typeof ConditionalPropsSchema>> = {
  id: 'base.loop-conditional', name: 'Loop condition', description: 'Show content when matching loop entries exist or are empty.',
  category: 'Layout', version: '1.0.0', icon: BoxStackSolidIcon, trusted: true, canHaveChildren: true,
  schema: { ...controls, when: { type: 'select', label: 'Show when', options: [{ label: 'Results exist', value: 'results' }, { label: 'No results', value: 'empty' }] } },
  propsSchema: ConditionalPropsSchema, defaults: Value.Create(ConditionalPropsSchema), component: LoopConditionalEditor,
  assets: { css: '[data-instatic-loop-empty-group][hidden]{display:none}' },
  htmlTag: props => resolveHtmlTag(props.tag, props.customTag),
  render: (props, children) => {
    const total = Number((props as Record<string, unknown>)._loopTotal ?? 0)
    const visible = props.when === 'empty' ? total === 0 : total > 0
    const tag = resolveHtmlTag(props.tag, props.customTag)
    return { html: `<${tag} data-instatic-loop-empty-group="${escapeHtml(JSON.stringify(readSummaryLoopIds(props.loopIds)))}" data-instatic-loop-condition="${props.when}"${visible ? '' : ' hidden'}${htmlAttributesAttr(props.htmlAttributes)}>${children.join('')}</${tag}>` }
  },
}
registry.registerOrReplace(LoopCountModule)
registry.registerOrReplace(LoopConditionalModule)
