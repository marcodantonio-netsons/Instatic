import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { escapeHtml } from '../shared/htmlSafety'

type HtmlNode = DefaultTreeAdapterMap['node']
type HtmlElement = DefaultTreeAdapterMap['element']

interface TextEdit {
  start: number
  end: number
  replacement: string
}

interface LoopState {
  id: string
  element: HtmlElement
  loaded: number
  total: number | null
  hasMore: boolean | null
  infinite: boolean
}

interface Summary {
  loaded: number
  total: number | null
}

function isElement(node: HtmlNode): node is HtmlElement {
  return 'tagName' in node
}

function isTemplate(element: HtmlElement): element is DefaultTreeAdapterMap['template'] {
  return element.tagName === 'template' && 'content' in element
}

function attr(element: HtmlElement, name: string): string | undefined {
  return element.attrs.find(item => item.name === name)?.value
}

function validCount(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
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

function idsFromAttribute(value: string | undefined): string[] {
  if (value === undefined) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every(id => typeof id === 'string') ? [...new Set(parsed)] : []
  } catch {
    return []
  }
}

function renderedItemCount(element: HtmlElement): number {
  const declared = validCount(attr(element, 'data-instatic-loop-loaded'))
  if (declared !== null) return declared
  const countElements = (parent: HtmlElement): number => parent.childNodes.filter((child) => {
    if (!isElement(child)) return false
    if (child.tagName === 'button' && (attr(child, 'data-instatic-loop-load-more') !== undefined || attr(child, 'data-instatic-loop-more') !== undefined)) return false
    if (attr(child, 'data-instatic-loop-controls') !== undefined) return false
    return true
  }).length
  const children = element.childNodes.filter(isElement)
  if (element.tagName === 'table' && children.length === 1 && children[0].tagName === 'tbody') return countElements(children[0])
  return countElements(element)
}

function resolveLoop(id: string, loops: LoopState[]): LoopState | undefined {
  const exact = loops.filter(loop => loop.id === id)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return undefined
  const suffix = loops.filter(loop => loop.id.endsWith('_' + id))
  return suffix.length === 1 ? suffix[0] : undefined
}

function summary(ids: string[], loops: LoopState[]): Summary {
  let loaded = 0
  let total = 0
  let totalKnown = true
  for (const id of ids) {
    const loop = resolveLoop(id, loops)
    if (!loop) continue
    loaded += loop.loaded
    if (loop.total === null) totalKnown = false
    else total += loop.total
  }
  return { loaded, total: totalKnown ? total : null }
}

function interpolateMoreLabel(label: string, counts: Summary): string {
  return label
    .replaceAll('{remaining}', counts.total === null ? '?' : String(Math.max(0, counts.total - counts.loaded)))
    .replaceAll('{loaded}', String(counts.loaded))
    .replaceAll('{total}', counts.total === null ? '?' : String(counts.total))
}

function hiddenEdit(element: HtmlElement, hidden: boolean, html: string): TextEdit | undefined {
  const location = element.sourceCodeLocation
  const startTag = location?.startTag
  if (!location || !startTag) return undefined
  const current = element.attrs.some(item => item.name === 'hidden')
  if (current === hidden) return undefined
  if (hidden) {
    const closing = startTag.endOffset - 1
    return { start: closing, end: closing, replacement: ' hidden' }
  }
  const attribute = location.attrs?.hidden
  if (!attribute) return undefined
  const start = attribute.startOffset > 0 && /\s/.test(html[attribute.startOffset - 1])
    ? attribute.startOffset - 1
    : attribute.startOffset
  return { start, end: attribute.endOffset, replacement: '' }
}

/**
 * Resolve the initial loop controls after native loop HTML has been rendered.
 * The fork emits exact totals; the official loop markup does not, so this hook
 * intentionally leaves total-dependent values unknown there.
 */
export function renderLoopControlsInitialHtml(html: string): string {
  if (!html.includes('data-instatic-loop-count') && !html.includes('data-instatic-loop-empty-group') && !html.includes('data-instatic-loop-more')) return html
  const document = parse(html, { sourceCodeLocationInfo: true })
  const all = elements(document)
  const loops: LoopState[] = all.flatMap(element => {
    const id = attr(element, 'data-instatic-loop')
    if (!id) return []
    const hasMoreValue = attr(element, 'data-instatic-loop-has-more')
    return [{
      id,
      element,
      loaded: renderedItemCount(element),
      total: validCount(attr(element, 'data-instatic-loop-total')),
      hasMore: hasMoreValue === 'true' ? true : hasMoreValue === 'false' ? false : null,
      infinite: attr(element, 'data-instatic-loop-mode') === 'infinite',
    }]
  })
  const edits: TextEdit[] = []

  for (const element of all) {
    const rawIds = attr(element, 'data-instatic-loop-count')
    if (rawIds !== undefined) {
      const ids = idsFromAttribute(rawIds)
      const counts = summary(ids, loops)
      const metric = attr(element, 'data-instatic-loop-count-metric')
      const value = metric === 'loaded' ? String(counts.loaded)
        : metric === 'remaining' ? (counts.total === null ? '?' : String(Math.max(0, counts.total - counts.loaded)))
          : metric === 'progress' ? `${counts.loaded}/${counts.total === null ? '?' : counts.total}`
            : counts.total === null ? '?' : String(counts.total)
      const location = element.sourceCodeLocation
      if (location?.startTag && location.endTag) edits.push({
        start: location.startTag.endOffset,
        end: location.endTag.startOffset,
        replacement: escapeHtml(value),
      })
      continue
    }

    const rawGroupIds = attr(element, 'data-instatic-loop-empty-group')
    if (rawGroupIds !== undefined) {
      const counts = summary(idsFromAttribute(rawGroupIds), loops)
      const hasResults = counts.total === null ? counts.loaded > 0 : counts.total > 0
      const condition = attr(element, 'data-instatic-loop-condition')
      const shouldHide = condition === 'empty' ? hasResults : !hasResults
      const edit = hiddenEdit(element, shouldHide, html)
      if (edit) edits.push(edit)
      continue
    }

    const targetId = attr(element, 'data-instatic-loop-more')
    if (targetId !== undefined) {
      const target = resolveLoop(targetId, loops)
      const shouldHide = !target?.infinite || target.hasMore !== true
      const edit = hiddenEdit(element, shouldHide, html)
      if (edit) edits.push(edit)
      if (attr(element, 'data-instatic-loop-more-fallback') !== undefined) {
        const label = attr(element, 'data-instatic-loop-load-more-label') || ''
        const location = element.sourceCodeLocation
        if (location?.startTag && location.endTag) edits.push({
          start: location.startTag.endOffset,
          end: location.endTag.startOffset,
          replacement: escapeHtml(interpolateMoreLabel(label, summary([targetId], loops))),
        })
      }
    }
  }

  edits.sort((left, right) => right.start - left.start)
  let result = html
  for (const edit of edits) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  return result
}

export interface LoopControlsHookApi {
  cms: {
    hooks: {
      filter(name: 'publish.html', handler: (html: string) => string): void
    }
  }
}

/** Register the first-class plugin publish filter from its server activation hook. */
export function registerLoopControlsPublishHook(api: LoopControlsHookApi): void {
  api.cms.hooks.filter('publish.html', html => renderLoopControlsInitialHtml(html))
}
