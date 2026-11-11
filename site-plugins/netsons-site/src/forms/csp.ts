import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { normalize as normalizeUri, parse as parseUri } from 'uri-js'
import { escapeHtml } from '../shared/htmlSafety'

type HtmlNode = DefaultTreeAdapterMap['node']
type HtmlElement = DefaultTreeAdapterMap['element']

interface TextEdit {
  start: number
  end: number
  replacement: string
}

interface CspDirective {
  name: string
  sources: string[]
}

type CspDirectiveName =
  | 'child-src'
  | 'connect-src'
  | 'default-src'
  | 'font-src'
  | 'form-action'
  | 'frame-src'
  | 'script-src'
  | 'script-src-elem'
  | 'style-src'

export interface CspSourceAddition {
  directive: CspDirectiveName
  sources: readonly string[]
  fallbackNames?: readonly CspDirectiveName[]
  /** Add this source only when the directive already existed in that policy. */
  onlyIfPresent?: boolean
}

interface CspRequirements {
  formActions: Set<string>
  requestConnections: Set<string>
  hasTurnstile: boolean
  hasSameOriginFormAction: boolean
}

const CLOUDFLARE_ORIGIN = 'https://challenges.cloudflare.com'
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/ // eslint-disable-line no-control-regex -- Reject control characters at the URL boundary.
const SCHEME_PREFIX = /^([a-z][a-z\d+.-]*):/i
const DNS_LABEL_PATTERN = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const URI_HOST_SCHEMA = Type.String({
  minLength: 1,
  maxLength: 253,
  pattern: `^(?:${DNS_LABEL_PATTERN})(?:\\.${DNS_LABEL_PATTERN})*\\.?$`,
})
const URI_IPV4_HOST_SCHEMA = Type.String({
  pattern: '^(?:(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)$',
})
const URI_IPV6_HOST_SCHEMA = Type.String({ minLength: 2, maxLength: 45, pattern: '^[a-f0-9:.]+$' })
const URI_PORT_SCHEMA = Type.Number({ minimum: 0, maximum: 65535, multipleOf: 1 })

function isElement(node: HtmlNode): node is HtmlElement {
  return 'tagName' in node
}

function isTemplate(element: HtmlElement): element is DefaultTreeAdapterMap['template'] {
  return element.tagName === 'template' && 'content' in element
}

function visit(node: HtmlNode, callback: (element: HtmlElement) => void): void {
  if (isElement(node)) callback(node)
  if ('childNodes' in node) for (const child of node.childNodes) visit(child, callback)
  if (isElement(node) && isTemplate(node)) visit(node.content, callback)
}

function elements(root: HtmlNode): HtmlElement[] {
  const result: HtmlElement[] = []
  visit(root, element => result.push(element))
  return result
}

function activeElements(root: HtmlNode): HtmlElement[] {
  const result: HtmlElement[] = []
  const visitActive = (node: HtmlNode): void => {
    if (isElement(node)) result.push(node)
    if ('childNodes' in node) for (const child of node.childNodes) visitActive(child)
  }
  visitActive(root)
  return result
}

function attr(element: HtmlElement, name: string): string | undefined {
  return element.attrs.find(item => item.name === name)?.value
}

function associatedForm(element: HtmlElement, forms: readonly HtmlElement[]): HtmlElement | undefined {
  const explicitId = attr(element, 'form')
  if (explicitId !== undefined) {
    return forms.find(form => attr(form, 'id') === explicitId || attr(form, 'data-instatic-form-id') === explicitId)
  }

  let parent: unknown = element.parentNode
  while (parent && typeof parent === 'object') {
    if ('tagName' in parent && parent.tagName === 'form') return parent as HtmlElement
    parent = 'parentNode' in parent ? parent.parentNode : null
  }
  return undefined
}

function parseAbsoluteOrigin(value: string): string {
  const parsed = parseUri(value)
  if (parsed.error) throw new Error('Form action is not a valid absolute URL')
  const protocol = parsed.scheme?.toLowerCase()
  if (protocol !== 'http' && protocol !== 'https') throw new Error('Form actions may use only HTTP(S) schemes')
  if (parsed.userinfo !== undefined) throw new Error('Form action URLs cannot contain user information')
  if (!parsed.host) throw new Error('Form action URL has no host')

  const normalized = parseUri(normalizeUri(value))
  const host = !normalized.error && normalized.scheme?.toLowerCase() === protocol
    ? normalized.host?.toLowerCase()
    : undefined
  const hostSchema = host?.includes(':') ? URI_IPV6_HOST_SCHEMA : URI_HOST_SCHEMA
  if (!host || !Value.Check(hostSchema, host) || host.includes('*') || host.includes('%')) {
    throw new Error('Form action URL has an invalid host')
  }
  if (/^(?:(?:0x[a-f\d]+)|\d+)(?:\.(?:(?:0x[a-f\d]+)|\d+))*$/i.test(host)
    && !Value.Check(URI_IPV4_HOST_SCHEMA, host)) throw new Error('Form action URL has an invalid numeric host')

  let port: number | undefined
  if (parsed.port !== undefined) {
    port = typeof parsed.port === 'number' ? parsed.port : /^\d+$/.test(parsed.port) ? Number(parsed.port) : Number.NaN
    if (!Value.Check(URI_PORT_SCHEMA, port)) throw new Error('Form action URL has an invalid port')
  }
  const defaultPort = protocol === 'http' ? 80 : 443
  const portSuffix = port === undefined || port === defaultPort ? '' : `:${port}`
  const hostText = host.includes(':') ? `[${host}]` : host
  return `${protocol}://${hostText}${portSuffix}`
}

function parseActionOrigins(value: string): string[] {
  if (value.trim() !== value || CONTROL_CHARACTERS.test(value) || value.includes('\\')) {
    throw new Error('Form action contains invalid whitespace or control characters')
  }
  if (!value) return []

  const parsed = parseUri(value)
  if (parsed.error) throw new Error('Form action is not a valid URL')
  const scheme = parsed.scheme?.toLowerCase() ?? SCHEME_PREFIX.exec(value)?.[1].toLowerCase()
  if (scheme) {
    if (scheme !== 'http' && scheme !== 'https') throw new Error('Form actions may use only HTTP(S) schemes')
    return [parseAbsoluteOrigin(value)]
  }
  if (parsed.host) {
    return [parseAbsoluteOrigin(`http:${value}`), parseAbsoluteOrigin(`https:${value}`)]
  }
  return []
}

function parseCspContent(content: string): CspDirective[] {
  if (!content.trim() || CONTROL_CHARACTERS.test(content.replace(/[\t\n\r\f]/g, ''))) {
    throw new Error('Published CSP content is empty or contains control characters')
  }

  const chunks = content.split(';')
  let lastChunk = -1
  for (let index = 0; index < chunks.length; index += 1) {
    if (chunks[index].trim()) lastChunk = index
  }
  const directives: CspDirective[] = []
  for (let index = 0; index <= lastChunk; index += 1) {
    const chunk = chunks[index].trim()
    if (!chunk) throw new Error('Published CSP contains an empty directive')
    const [name, ...sources] = chunk.split(/\s+/)
    if (!name || !/^[a-z][a-z\d-]*$/i.test(name)) throw new Error('Published CSP contains an invalid directive name')
    for (const source of sources) {
      if (source.includes('"') || (source.includes("'") && !/^'[^']+'$/.test(source))) {
        throw new Error('Published CSP contains an invalid quoted source')
      }
    }
    if (sources.some(source => source.toLowerCase() === "'none'") && sources.length > 1) {
      throw new Error('Published CSP mixes none with other sources')
    }
    directives.push({ name, sources })
  }
  if (!directives.length) throw new Error('Published CSP contains no directives')
  return directives
}

function directive(directives: CspDirective[], name: string): CspDirective | undefined {
  return directives.find(item => item.name.toLowerCase() === name)
}

function addSources(
  directives: CspDirective[],
  name: string,
  sources: Iterable<string>,
  fallbackNames: readonly string[] = [],
): boolean {
  const additions = [...new Set(sources)]
  if (!additions.length) return false

  let target = directive(directives, name)
  if (!target) {
    let inherited: string[] = []
    for (const fallbackName of fallbackNames) {
      const fallback = directive(directives, fallbackName)
      if (fallback) {
        inherited = [...fallback.sources]
        break
      }
    }
    if (!fallbackNames.length) inherited = ["'self'"]
    else if (!inherited.length && !fallbackNames.some(fallbackName => directive(directives, fallbackName))) {
      throw new Error(`Published CSP lacks a fallback directive for ${name}`)
    }
    target = { name, sources: inherited }
    directives.push(target)
  }

  const original = target.sources.join('\u0000')
  if (target.sources.some(source => source.toLowerCase() === "'none'")) target.sources = target.sources.filter(source => source.toLowerCase() !== "'none'")
  for (const source of additions) if (!target.sources.includes(source)) target.sources.push(source)
  return original !== target.sources.join('\u0000')
}

function serializeCspContent(directives: CspDirective[]): string {
  return `${directives.map(({ name, sources }) => `${name}${sources.length ? ` ${sources.join(' ')}` : ''}`).join('; ')};`
}

function actionRequirements(all: HtmlElement[], active: HtmlElement[]): CspRequirements {
  const baseElement = active.find(element => element.tagName === 'base' && attr(element, 'href') !== undefined)
  const baseHref = baseElement ? attr(baseElement, 'href') ?? '' : ''
  const baseOrigins = baseHref ? parseActionOrigins(baseHref) : []
  const forms = all.filter(element => element.tagName === 'form')
  const formActions = new Set<string>()
  const requestConnections = new Set<string>()
  let hasSameOriginFormAction = false

  for (const element of forms) {
    const action = attr(element, 'action')
    const origins = action === undefined ? [] : parseActionOrigins(action)
    const resolvedOrigins = origins.length ? origins : action ? baseOrigins : []
    if (origins.length === 0 && resolvedOrigins.length === 0) hasSameOriginFormAction = true
    for (const origin of resolvedOrigins) {
      formActions.add(origin)
      if (attr(element, 'data-instatic-form-mode') === 'request') requestConnections.add(origin)
    }
    if (origins.length === 0 && resolvedOrigins.length === 0
      && attr(element, 'data-instatic-form-mode') === 'request') requestConnections.add("'self'")
  }

  for (const element of all) {
    if (!['button', 'input'].includes(element.tagName)) continue
    const action = attr(element, 'formaction')
    if (action === undefined) continue
    const form = associatedForm(element, forms)
    if (!form) continue
    const origins = parseActionOrigins(action)
    const resolvedOrigins = origins.length ? origins : action ? baseOrigins : []
    if (origins.length === 0 && resolvedOrigins.length === 0) hasSameOriginFormAction = true
    for (const origin of resolvedOrigins) {
      formActions.add(origin)
      if (attr(form, 'data-instatic-form-mode') === 'request') requestConnections.add(origin)
    }
    if (origins.length === 0 && resolvedOrigins.length === 0
      && attr(form, 'data-instatic-form-mode') === 'request') requestConnections.add("'self'")
  }

  return {
    formActions,
    requestConnections,
    hasTurnstile: all.some(element => element.attrs.some(item => item.name === 'data-instatic-turnstile')),
    hasSameOriginFormAction,
  }
}

function cspMetas(head: HtmlElement): HtmlElement[] {
  const metas: HtmlElement[] = []
  const headNodes = activeElements(head)
  for (const element of headNodes) {
    if (element.tagName === 'meta' && attr(element, 'http-equiv')?.trim().toLowerCase() === 'content-security-policy') {
      metas.push(element)
    }
  }
  return metas
}

function validateCspSourceAddition(addition: CspSourceAddition): void {
  if (!/^[a-z][a-z\d-]*$/i.test(addition.directive)) {
    throw new Error('CSP source addition has an invalid directive name')
  }
  for (const fallbackName of addition.fallbackNames ?? []) {
    if (!/^[a-z][a-z\d-]*$/i.test(fallbackName)) {
      throw new Error('CSP source addition has an invalid fallback directive name')
    }
  }
  for (const source of addition.sources) {
    if (!source || CONTROL_CHARACTERS.test(source) || /[\s;"<>]/.test(source)
      || (source.includes("'") && !/^'[^']+'$/.test(source)) || source.toLowerCase() === "'none'") {
      throw new Error('CSP source addition has an invalid source expression')
    }
  }
}

/** Safely merge declared source tokens into every active CSP meta policy. */
export function augmentCspSources(html: string, additions: readonly CspSourceAddition[]): string {
  for (const addition of additions) validateCspSourceAddition(addition)
  const document = parse(html, { sourceCodeLocationInfo: true })
  const head = activeElements(document).find(element => element.tagName === 'head')
  const metas = head ? cspMetas(head) : []
  if (!metas.length) {
    if (additions.some(addition => addition.sources.length > 0 && !addition.onlyIfPresent)) {
      throw new Error('Published page requires CSP sources but has no CSP meta tag')
    }
    return html
  }

  const edits: TextEdit[] = []
  for (const meta of metas) {
    const content = attr(meta, 'content')
    const contentLocation = meta.sourceCodeLocation?.attrs?.content
    if (content === undefined || !contentLocation) throw new Error('Published CSP meta tag has no editable content attribute')

    const directives = parseCspContent(content)
    const initiallyPresent = new Set(directives.map(item => item.name.toLowerCase()))
    let changed = false
    for (const addition of additions) {
      if (addition.onlyIfPresent && !initiallyPresent.has(addition.directive)) continue
      changed = addSources(directives, addition.directive, addition.sources, addition.fallbackNames) || changed
    }
    if (changed) edits.push({
      start: contentLocation.startOffset,
      end: contentLocation.endOffset,
      replacement: `content="${escapeHtml(serializeCspContent(directives))}"`,
    })
  }

  edits.sort((left, right) => right.start - left.start)
  let result = html
  for (const edit of edits) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  return result
}

/**
 * Add the narrow CSP sources required by rendered form actions and Turnstile.
 * The publisher injects this post-render, so only origins present in the final
 * HTML can affect the policy. Existing directive sources are retained.
 */
export function augmentFormsCsp(html: string): string {
  const document = parse(html, { sourceCodeLocationInfo: true })
  const all = elements(document)
  const active = activeElements(document)
  const requirements = actionRequirements(all, active)
  const head = active.find(element => element.tagName === 'head')
  const metas = head ? cspMetas(head) : []

  if (!metas.length) {
    if (requirements.formActions.size || requirements.requestConnections.size || requirements.hasTurnstile) {
      throw new Error('Published page requires form CSP sources but has no CSP meta tag')
    }
    return html
  }

  const additions: CspSourceAddition[] = []
  if (requirements.formActions.size) {
    additions.push({ directive: 'form-action', sources: [...requirements.formActions] })
  }
  if (requirements.hasSameOriginFormAction) {
    additions.push({ directive: 'form-action', sources: ["'self'"], onlyIfPresent: true })
  }
  if (requirements.requestConnections.size) {
    additions.push({ directive: 'connect-src', sources: [...requirements.requestConnections], fallbackNames: ['default-src'] })
  }
  if (requirements.hasTurnstile) {
    additions.push(
      { directive: 'script-src', sources: [CLOUDFLARE_ORIGIN], fallbackNames: ['default-src'] },
      { directive: 'script-src-elem', sources: [CLOUDFLARE_ORIGIN], fallbackNames: ['script-src'], onlyIfPresent: true },
      { directive: 'frame-src', sources: [CLOUDFLARE_ORIGIN], fallbackNames: ['child-src', 'default-src'] },
    )
  }
  return augmentCspSources(html, additions)
}
