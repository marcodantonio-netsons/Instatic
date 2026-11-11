import { Value } from '@sinclair/typebox/value'
import { ErrorCodes, parse, type DefaultTreeAdapterMap, type ParserError } from 'parse5'
import { parse as parseUri } from 'uri-js'
import { localizeProps } from '../localization'
import { escapeHtml } from '../shared/htmlSafety'
import {
  SEO_LINK_RELATIONS,
  SeoRecordSchema,
  type SeoRecord,
} from './schema'

type HtmlNode = DefaultTreeAdapterMap['node']
type HtmlElement = DefaultTreeAdapterMap['element']

interface TextEdit {
  start: number
  end: number
  replacement: string
}

const SCHEME_PREFIX = /^([a-z][a-z\d+.-]*):/i
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/ // eslint-disable-line no-control-regex -- Reject controls at the URL boundary.
const LANGUAGE_TAG = /^(?:[a-z]{2,8})(?:-[a-z0-9]{1,8})*$/i

function hasSeoText(value: string | undefined): value is string {
  return value !== undefined && value !== ''
}

function isElement(node: HtmlNode): node is HtmlElement {
  return 'tagName' in node
}

function attr(element: HtmlElement, name: string): string | undefined {
  return element.attrs.find((item) => item.name === name)?.value
}

function directElements(parent: HtmlElement): HtmlElement[] {
  return parent.childNodes.filter(isElement)
}

function editRange(html: string, element: HtmlElement): TextEdit {
  const location = element.sourceCodeLocation
  if (!location) throw new Error(`SEO renderer cannot edit <${element.tagName}> without a source location`)
  let start = location.startOffset
  let end = location.endOffset
  const lineStart = html.lastIndexOf('\n', start - 1) + 1
  if (html.slice(lineStart, start).trim() === '') start = lineStart
  const lineEnd = html.indexOf('\n', end)
  if (lineEnd >= 0 && html.slice(end, lineEnd).trim() === '') end = lineEnd + 1
  return { start, end, replacement: '' }
}

function validateSeoUrl(value: string, path: string): void {
  if (!value || value.trim() !== value || CONTROL_CHARACTERS.test(value) || value.includes('\\')) {
    throw new Error(`${path}: expected a safe HTTP(S) or relative URL`)
  }

  const parsed = parseUri(value)
  if (parsed.error) throw new Error(`${path}: expected a valid URL`)
  const scheme = parsed.scheme?.toLowerCase() ?? SCHEME_PREFIX.exec(value)?.[1].toLowerCase()
  if (scheme && scheme !== 'http' && scheme !== 'https') {
    throw new Error(`${path}: only HTTP(S) or relative URLs are allowed`)
  }
  if (scheme && !parsed.host) throw new Error(`${path}: absolute URL has no host`)
  if (parsed.userinfo !== undefined) throw new Error(`${path}: URL credentials are not allowed`)
  if (value.startsWith('//') && !parsed.host) throw new Error(`${path}: protocol-relative URL has no host`)
}

function assertSeoRecord(value: unknown): asserts value is SeoRecord {
  if (!Value.Check(SeoRecordSchema, value)) {
    const first = [...Value.Errors(SeoRecordSchema, value)][0]
    throw new Error(`Invalid SEO record${first?.path ?? ''}: ${first?.message ?? 'schema mismatch'}`)
  }
}

function validateRecord(value: unknown): SeoRecord {
  assertSeoRecord(value)
  const source = value
  const localizedFields = localizeProps({
    title: source.title,
    description: source.description,
    canonical: source.canonical,
    alternates: source.alternates,
    meta: source.meta,
    links: source.links,
    structuredData: source.structuredData,
  }, source.language)
  const record = Object.assign({}, source, localizedFields)
  assertSeoRecord(record)
  if (!LANGUAGE_TAG.test(record.language)) throw new Error('Invalid SEO record language: expected a BCP 47 language tag')

  if (record.canonical !== undefined) validateSeoUrl(record.canonical, 'canonical')
  for (const [index, alternate] of record.alternates.entries()) {
    if (alternate.language.toLowerCase() !== 'x-default' && !LANGUAGE_TAG.test(alternate.language)) {
      throw new Error(`alternates[${index}].language: expected a BCP 47 language tag or x-default`)
    }
    validateSeoUrl(alternate.href, `alternates[${index}].href`)
  }
  for (const [index, meta] of record.meta.entries()) {
    const key = meta.key.toLowerCase()
    if ((meta.attribute === 'name' && ['description', 'viewport', 'charset'].includes(key))
      || (meta.attribute === 'http-equiv' && !['content-language', 'default-style', 'x-ua-compatible'].includes(key))) {
      throw new Error(`meta[${index}].key: metadata is publisher-owned or is not a passive document pragma`)
    }
  }
  for (const [index, link] of record.links.entries()) validateSeoUrl(link.href, `links[${index}].href`)

  for (const key of ['alternates', 'meta', 'links'] as const) {
    const ids = record[key].map((entry) => entry.id)
    if (new Set(ids).size !== ids.length) throw new Error(`${key}: item IDs must be unique`)
  }
  return record
}

function rels(element: HtmlElement): Set<string> {
  return new Set((attr(element, 'rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean))
}

function replaceLang(html: string, element: HtmlElement, language: string, parseErrors: readonly ParserError[]): TextEdit {
  const location = element.sourceCodeLocation
  const startTag = location?.startTag
  if (!startTag) throw new Error('SEO renderer requires an explicit <html> start tag')
  const duplicateLang = parseErrors.some((error) => {
    if (error.code !== ErrorCodes.duplicateAttribute || error.startOffset < startTag.startOffset
      || error.startOffset >= startTag.endOffset) return false
    const before = html.slice(startTag.startOffset, error.startOffset).match(/([a-z][a-z\d:-]*)\s*$/i)?.[1]
    const after = html.slice(error.startOffset, startTag.endOffset).match(/^\s*([a-z][a-z\d:-]*)/i)?.[1]
    return (before ?? after)?.toLowerCase() === 'lang'
  })
  if (duplicateLang) throw new Error('SEO renderer cannot update duplicate html lang attributes')
  const attributeLocation = location.attrs?.lang
  const replacement = `lang="${escapeHtml(language)}"`
  if (attributeLocation) {
    return { start: attributeLocation.startOffset, end: attributeLocation.endOffset, replacement }
  }
  if (element.attrs.some((attribute) => attribute.name === 'lang')) {
    throw new Error('SEO renderer cannot locate the html lang attribute')
  }
  let insertAt = startTag.endOffset - 1
  if (html[insertAt - 1] === '/') insertAt -= 1
  return { start: insertAt, end: insertAt, replacement: ` ${replacement}` }
}

function removeOwnedHeadNodes(html: string, head: HtmlElement, record: SeoRecord): TextEdit[] {
  const linkRelations = new Set(SEO_LINK_RELATIONS.filter((relation) =>
    relation !== 'icon' || record.links.some((item) => item.rel === 'icon')))
  const edits: TextEdit[] = []
  let keptFallbackTitle = false
  let keptFallbackDescription = false

  for (const element of directElements(head)) {
    const name = element.tagName
    const removeTitle = name === 'title' && (hasSeoText(record.title) || keptFallbackTitle)
    if (name === 'title' && !removeTitle) keptFallbackTitle = true
    const metaName = attr(element, 'name')?.toLowerCase()
    const httpEquiv = attr(element, 'http-equiv')?.toLowerCase()
    const isCsp = name === 'meta'
      && ['content-security-policy', 'content-security-policy-report-only'].includes(httpEquiv ?? '')
    const isCharset = name === 'meta' && attr(element, 'charset') !== undefined
    const isViewport = name === 'meta' && metaName === 'viewport'
    const isDescription = name === 'meta' && metaName === 'description'
    const removeDescription = isDescription && (hasSeoText(record.description) || keptFallbackDescription)
    if (isDescription && !removeDescription) keptFallbackDescription = true
    const removeMeta = name === 'meta' && metaName !== 'description'
      && !isCsp && !isCharset && !isViewport
    const elementRels = rels(element)
    const removeCanonical = name === 'link' && elementRels.has('canonical')
    const removeAlternate = name === 'link' && elementRels.has('alternate') && attr(element, 'hreflang') !== undefined
    const removeLink = name === 'link' && [...linkRelations].some((relation) => elementRels.has(relation))
    const removeJsonLd = name === 'script'
      && attr(element, 'type')?.split(';', 1)[0]?.trim().toLowerCase() === 'application/ld+json'
    if (removeTitle || removeDescription || removeMeta || removeCanonical || removeAlternate || removeLink || removeJsonLd) {
      edits.push(editRange(html, element))
    }
  }
  return edits
}

function renderHeadMarkup(record: SeoRecord): string {
  const lines: string[] = []
  if (hasSeoText(record.title)) lines.push(`<title>${escapeHtml(record.title)}</title>`)
  if (hasSeoText(record.description)) {
    lines.push(`<meta name="description" content="${escapeHtml(record.description)}">`)
  }
  if (record.canonical !== undefined) {
    lines.push(`<link rel="canonical" href="${escapeHtml(record.canonical)}">`)
  }

  const seenHreflang = new Set<string>()
  for (const alternate of record.alternates) {
    const hreflang = alternate.language.toLowerCase()
    if (seenHreflang.has(hreflang)) throw new Error(`Duplicate SEO hreflang value: ${alternate.language}`)
    seenHreflang.add(hreflang)
    lines.push(`<link rel="alternate" hreflang="${escapeHtml(alternate.language)}" href="${escapeHtml(alternate.href)}">`)
  }

  for (const item of record.meta) {
    lines.push(`<meta ${item.attribute}="${escapeHtml(item.key)}" content="${escapeHtml(item.content)}"`
      + (item.media !== undefined ? ` media="${escapeHtml(item.media)}"` : '') + '>')
  }

  const seenLinkTags = new Set<string>()
  for (const item of record.links) {
    const attrs = (['type', 'sizes', 'media'] as const)
      .map((key) => item[key] !== undefined ? ` ${key}="${escapeHtml(item[key])}"` : '').join('')
    const tag = `<link rel="${item.rel}" href="${escapeHtml(item.href)}"${attrs}>`
    if (seenLinkTags.has(tag)) continue
    seenLinkTags.add(tag)
    lines.push(tag)
  }

  const seenJsonLd = new Set<string>()
  for (const item of record.structuredData) {
    const json = JSON.stringify(item).replace(/</g, '\\u003c')
    if (seenJsonLd.has(json)) continue
    seenJsonLd.add(json)
    lines.push(`<script type="application/ld+json">${json}</script>`)
  }

  return lines.join('\n')
}

function insertionEdit(html: string, head: HtmlElement, markup: string): TextEdit {
  const endTag = head.sourceCodeLocation?.endTag
  if (!endTag) throw new Error('SEO renderer requires an explicit </head> tag')
  const offset = endTag.startOffset
  const lineStart = html.lastIndexOf('\n', offset - 1) + 1
  const indentedMarkup = `  ${markup}`
  if (html.slice(lineStart, offset).trim() === '') {
    return { start: lineStart, end: lineStart, replacement: `${indentedMarkup}\n` }
  }
  return { start: offset, end: offset, replacement: `\n${indentedMarkup}\n` }
}

/** Replace CMS-owned head metadata while preserving every unrelated source byte. */
export function renderSeoHtml(html: string, input: unknown): string {
  const record = validateRecord(input)
  const parseErrors: ParserError[] = []
  const document = parse(html, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => {
      if (error.code === ErrorCodes.duplicateAttribute) parseErrors.push(error)
    },
  })
  const htmlElement = document.childNodes.find((node): node is HtmlElement => isElement(node) && node.tagName === 'html')
  const head = htmlElement && directElements(htmlElement).find((element) => element.tagName === 'head')
  if (!htmlElement?.sourceCodeLocation?.startTag || !head) {
    throw new Error('SEO renderer requires an explicit <html><head> document')
  }
  if (!head.sourceCodeLocation?.startTag || !head.sourceCodeLocation.endTag) {
    throw new Error('SEO renderer requires an explicit <head> start and end tag')
  }

  const markup = renderHeadMarkup(record)
  const edits = [
    replaceLang(html, htmlElement, record.language, parseErrors),
    ...removeOwnedHeadNodes(html, head, record),
    ...(markup ? [insertionEdit(html, head, markup)] : []),
  ].sort((left, right) => right.start - left.start || right.end - left.end)

  let output = html
  let previousStart = Number.POSITIVE_INFINITY
  for (const edit of edits) {
    if (edit.end > previousStart) throw new Error('SEO renderer found overlapping source edits')
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end)
    previousStart = edit.start
  }
  return output
}

