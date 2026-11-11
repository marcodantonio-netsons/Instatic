import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { PluginModuleDefinition } from '@instatic/plugin-sdk'
import { catalogueLanguages, languageFromPath } from '../localization'
import { normalizeRenderProps } from '../shared/normalize'
import { anchorHtmlAttributes, ANCHOR_TARGET_OPTIONS } from '../shared/anchors'
import { htmlAttributesAttr } from '../shared/attributeEmitter'
import { escapeHtml } from '../shared/htmlSafety'
import { LANGUAGE_LINK_ATTRIBUTE } from './publishedHtml'

export { renderLanguageLinks, LanguageRouteSchema } from './publishedHtml'

const LanguageLinkPropsSchema = Type.Object({
  language: Type.String({ default: 'it' }),
  text: Type.String({ default: '' }),
  target: Type.Union(ANCHOR_TARGET_OPTIONS.map(({ value }) => Type.Literal(value)), { default: '_self' }),
  htmlAttributes: Type.Record(Type.String(), Type.String(), { default: {} }),
})

/** The publication hook supplies the destination from the page's CMS language routes. */
export const LanguageLinkModule: PluginModuleDefinition = {
  id: 'netsons.site.language-link',
  name: 'Page language link',
  category: 'Netsons',
  version: '1.0.0',
  htmlTag: 'a',
  canHaveChildren: true,
  propsSchema: LanguageLinkPropsSchema,
  defaults: { ...Value.Create(LanguageLinkPropsSchema), routePath: '{route.path}' },
  schema: {
    language: { type: 'select', label: 'Destination language', options: catalogueLanguages.map(value => ({ label: value, value })) },
    text: { type: 'text', label: 'Link text' },
    target: { type: 'select', label: 'Target', options: [...ANCHOR_TARGET_OPTIONS] },
  },
  render(input, children) {
    const props = normalizeRenderProps(LanguageLinkPropsSchema, input)
    if (!Value.Check(LanguageLinkPropsSchema, props) || !catalogueLanguages.includes(props.language)) {
      throw new Error('Invalid page language link')
    }
    const { attributes, rel } = anchorHtmlAttributes(props.htmlAttributes, props.target)
    delete attributes.href
    delete attributes[LANGUAGE_LINK_ATTRIBUTE]
    attributes.hreflang = props.language
    attributes['aria-current'] = props.language === languageFromPath(String(input.routePath)) ? 'page' : 'false'
    return {
      html: `<a${htmlAttributesAttr(attributes)} ${LANGUAGE_LINK_ATTRIBUTE}="${escapeHtml(props.language)}" target="${props.target}"${rel ? ` rel="${escapeHtml(rel)}"` : ''}>${children.length ? children.join('') : props.text}</a>`,
    }
  },
}
