import { registry, type ModuleDefinition } from '@core/module-engine'
import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import { LOOP_LOADING_LABEL_DEFAULTS } from '@core/loops'
import { htmlAttributesAttr } from '@core/publisher'
import { MODULE_GENERATED_ATTRIBUTE_NAMES } from '@core/htmlAttributes'
import { HtmlAttributesPropSchemaOptions, htmlAttributesControl } from '@modules/base/shared/htmlAttributes'
import { CursorClickSolidIcon } from 'pixel-art-icons/icons/cursor-click-solid'
import { LoopMoreEditor } from './LoopMoreEditor'

const PropsSchema = Type.Object({
  loopId: Type.String({ default: '' }),
  label: Type.String({ default: LOOP_LOADING_LABEL_DEFAULTS.loadMoreLabel }),
  loadingLabel: Type.String({ default: LOOP_LOADING_LABEL_DEFAULTS.loadingLabel }),
  retryLabel: Type.String({ default: LOOP_LOADING_LABEL_DEFAULTS.retryLabel }),
  htmlAttributes: Type.Record(Type.String(), Type.String(), HtmlAttributesPropSchemaOptions),
})
export const LoopMoreModule: ModuleDefinition<Static<typeof PropsSchema>> = {
  id: 'base.loop-more', name: 'Load more entries', category: 'Interactive', version: '1.0.0',
  description: 'An authored button that loads more entries from a native infinite loop.',
  trusted: true, icon: CursorClickSolidIcon, canHaveChildren: true, htmlTag: 'button',
  schema: {
    loopId: { type: 'text', label: 'Loop ID' },
    label: { type: 'text', label: 'Label', description: 'Use {remaining}, {loaded} or {total} for the entry count.' },
    loadingLabel: { type: 'text', label: 'Loading label' },
    retryLabel: { type: 'text', label: 'Retry label' },
    htmlAttributes: htmlAttributesControl(),
  },
  propsSchema: PropsSchema, defaults: Value.Create(PropsSchema), component: LoopMoreEditor,
  assets: { css: '[data-instatic-loop-more][hidden]{display:none}' },
  render: (props, children) => {
    const values: Record<string, unknown> = props
    const total = Number(values._loopTotal ?? 0), loaded = Number(values._loopLoaded ?? 0)
    const label = props.label.replaceAll('{remaining}', String(Math.max(0, total - loaded))).replaceAll('{loaded}', String(loaded)).replaceAll('{total}', String(total))
    return { html: `<button type="button" data-instatic-loop-more="${props.loopId}" data-instatic-loop-load-more-label="${props.label}" data-instatic-loop-loading-label="${props.loadingLabel}" data-instatic-loop-retry-label="${props.retryLabel}"${values._loopHasMore === false ? ' hidden' : ''}${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.loop-more'])}>${children.length ? children.join('') : label}</button>` }
  },
}
registry.registerOrReplace(LoopMoreModule)
