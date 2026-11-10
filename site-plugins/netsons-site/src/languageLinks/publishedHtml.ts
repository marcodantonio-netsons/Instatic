import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { parse as parseUri } from 'uri-js'
import { escapeHtml } from '../shared/htmlSafety'

export const LANGUAGE_LINK_ATTRIBUTE = 'data-netsons-language-link'
const UNSAFE_PATH_CHARACTERS = /[\\\u0000-\u0020\u007f]/ // eslint-disable-line no-control-regex -- Reject URL controls, whitespace and backslashes.
export const LanguageRouteSchema = Type.Object({
  id: Type.Optional(Type.String()),
  language: Type.String({ minLength: 1 }),
  path: Type.String({ minLength: 1 }),
}, { additionalProperties: false })

type Node = DefaultTreeAdapterMap['node']
type Edit = { start: number; end: number; value: string }

/** Resolve authored language links once at publication; no browser routing runtime. */
export function renderLanguageLinks(html: string, routes: readonly Static<typeof LanguageRouteSchema>[]): string {
  if (!Value.Check(Type.Array(LanguageRouteSchema), routes)) throw new Error('Invalid page language routes')
  const destinations = new Map<string, string>()
  for (const route of routes) {
    if (destinations.has(route.language)) throw new Error('Duplicate page language route: ' + route.language)
    const url = parseUri(route.path)
    if (!route.path.startsWith('/') || route.path.startsWith('//') || url.error || url.scheme || url.host !== undefined || url.userinfo !== undefined
      || UNSAFE_PATH_CHARACTERS.test(route.path)) throw new Error('Expected a local page language route')
    destinations.set(route.language, route.path)
  }
  const edits: Edit[] = []
  function visit(node: Node): void {
    if ('tagName' in node && node.tagName === 'a') {
      const marker = node.attrs.find(attribute => attribute.name === LANGUAGE_LINK_ATTRIBUTE)
      if (marker) {
        const path = destinations.get(marker.value)
        if (!path) throw new Error('Missing page language route: ' + marker.value)
        const location = node.sourceCodeLocation
        const tag = location?.startTag
        const markerLocation = location?.attrs?.[LANGUAGE_LINK_ATTRIBUTE]
        if (!tag || !markerLocation) throw new Error('Missing language link source location')
        edits.push({ start: markerLocation.startOffset, end: markerLocation.endOffset, value: `href="${escapeHtml(path)}"` })
        const href = location?.attrs?.href
        if (href) edits.push({ start: href.startOffset, end: href.endOffset, value: '' })
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child)
  }
  visit(parse(html, { sourceCodeLocationInfo: true }))
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    html = html.slice(0, edit.start) + edit.value + html.slice(edit.end)
  }
  return html
}
