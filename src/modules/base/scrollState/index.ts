import { registry, type ModuleDefinition } from '@core/module-engine'
import { resolveHtmlTag, MODULE_GENERATED_ATTRIBUTE_NAMES } from '@core/htmlAttributes'
import { escapeHtml, htmlAttributesAttr } from '@core/publisher'
import { Value } from '@core/utils/typeboxHelpers'
import { ArrowsVerticalIcon } from 'pixel-art-icons/icons/arrows-vertical'
import { htmlTagControl, customHtmlTagControl } from '@modules/base/utils/htmlTag'
import { htmlAttributesControl } from '@modules/base/shared/htmlAttributes'
import { ScrollStateEditor } from './ScrollStateEditor'
import { ScrollStatePropsSchema, ScrollStatePublishSchema, scrollStateAttributes, type ScrollStateProps } from './props'
import { installScrollStateBehavior } from './behavior'

export { ScrollStatePropsSchema, ScrollStatePublishSchema } from './props'
export type { ScrollStateProps } from './props'
export { installScrollStateBehavior } from './behavior'
export { ScrollStateEditor } from './ScrollStateEditor'
export const SCROLL_STATE_RUNTIME_JS = `(${installScrollStateBehavior.toString()})(document);`

export const ScrollStateModule: ModuleDefinition<ScrollStateProps> = {
  id: 'base.scroll-state', name: 'Scroll state',
  description: 'Style an authored element before or after a target crosses a viewport offset.',
  category: 'Interactive', version: '1.0.0', trusted: true, icon: ArrowsVerticalIcon, canHaveChildren: true,
  propsSchema: ScrollStatePropsSchema, publishSchema: ScrollStatePublishSchema, defaults: Value.Create(ScrollStatePropsSchema),
  component: ScrollStateEditor, htmlTag: props => resolveHtmlTag(props.tag, props.customTag),
  schema: {
    tag: htmlTagControl(), customTag: customHtmlTagControl(),
    targetId: { type: 'text', label: 'Target element ID', placeholder: 'section-id', category: 'layout', description: 'An authored page-unique HTML ID, without #.' },
    edge: { type: 'select', label: 'Target edge', options: [{ value: 'start', label: 'Start' }, { value: 'end', label: 'End' }] },
    offset: { type: 'number', label: 'Viewport offset (px)', step: 1 },
    htmlAttributes: htmlAttributesControl(),
  },
  assets: { js: SCROLL_STATE_RUNTIME_JS },
  render(props, children) {
    const tag = resolveHtmlTag(props.tag, props.customTag)
    // Native attributes are appended separately so authored attributes cannot override the runtime contract.
    const authored = htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.scroll-state'])
    const runtime = Object.entries(scrollStateAttributes(props)).map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join('')
    return { html: `<${tag}${authored}${runtime}>${children.join('')}</${tag}>` }
  },
}
registry.registerOrReplace(ScrollStateModule)
