/** Dependency-free visitor loading and declared form-query bindings for native loops. */
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { Type } from '@sinclair/typebox'
import { FormValuesEventDetailSchema, type FormValuesEventDetail } from '@core/forms-schema'
import { LoopPageResponseSchema, LoopQueryBindingsSchema, type LoopPageResponse, type LoopQueryBinding } from '@core/loops-schema'

function runInstaticLoopRuntime(
  isResponse: (value: unknown) => value is LoopPageResponse,
  isBindings: (value: unknown) => value is LoopQueryBinding[],
  isFormValues: (value: unknown) => value is FormValuesEventDetail,
  isIds: (value: unknown) => value is string[],
  isInitial: (value: unknown) => value is Record<string, string>,
): void {
  const script = document.querySelector('script[data-instatic-loop-endpoint]')
  const endpoint = script?.getAttribute('data-instatic-loop-endpoint') || '/_instatic/loop/'
  const attached = new WeakSet<Element>()
  const handlers = new Set<{ element: Element; formIds: string[]; change: (detail: FormValuesEventDetail) => void; cleanup: () => void }>()
  const queue: Array<() => Promise<void>> = []
  let active = 0
  function pump(): void {
    while (active < 2 && queue.length) {
      active++
      const task = queue.shift()!
      void task().finally(() => { active--; pump() })
    }
  }
  function ids(element: Element, attribute: string): string[] {
    const value: unknown = JSON.parse(element.getAttribute(attribute) || '[]')
    if (!isIds(value)) throw new Error('Invalid loop summary IDs')
    return value
  }
  function summaries(): void {
    const totals = new Map<string, number>(), loaded = new Map<string, number>()
    for (const element of document.querySelectorAll('[data-instatic-loop][data-instatic-loop-total]')) {
      const id = element.getAttribute('data-instatic-loop')!, value = Number(element.getAttribute('data-instatic-loop-total'))
      if (Number.isSafeInteger(value) && value >= 0) totals.set(id, (totals.get(id) || 0) + value)
      const count = Number(element.getAttribute('data-instatic-loop-loaded') || '0')
      if (Number.isSafeInteger(count) && count >= 0) loaded.set(id, (loaded.get(id) || 0) + count)
    }
    for (const element of document.querySelectorAll<HTMLElement>('[data-instatic-loop-count], [data-instatic-loop-empty-group]')) {
      const count = element.hasAttribute('data-instatic-loop-count')
      const loopIds = [...new Set(ids(element, count ? 'data-instatic-loop-count' : 'data-instatic-loop-empty-group'))]
      const total = loopIds.reduce((sum, id) => sum + (totals.get(id) || 0), 0)
      const shown = loopIds.reduce((sum, id) => sum + (loaded.get(id) || 0), 0)
      const metric = element.getAttribute('data-instatic-loop-count-metric')
      const value = metric === 'loaded' ? String(shown) : metric === 'remaining' ? String(Math.max(0, total - shown)) : metric === 'progress' ? shown + '/' + total : String(total)
      if (count) { if (element.textContent !== value) element.textContent = value }
      else element.hidden = element.getAttribute('data-instatic-loop-condition') === 'empty' ? total !== 0 : total === 0
    }
  }
  function attach(element: Element): string[] {
    if (attached.has(element) || element.hasAttribute('data-instatic-loop-attached')) return []
    const id = element.getAttribute('data-instatic-loop')
    const authored = [...document.querySelectorAll<HTMLButtonElement>('button[data-instatic-loop-more]')].find(button => button.getAttribute('data-instatic-loop-more') === id)
    const moreLabel = authored?.getAttribute('data-instatic-loop-load-more-label') ?? element.getAttribute('data-instatic-loop-load-more-label')
    const loadingLabel = authored?.getAttribute('data-instatic-loop-loading-label') ?? element.getAttribute('data-instatic-loop-loading-label')
    const retryLabel = authored?.getAttribute('data-instatic-loop-retry-label') ?? element.getAttribute('data-instatic-loop-retry-label')
    const version = element.getAttribute('data-instatic-loop-version')
    if (!id || moreLabel === null || loadingLabel === null || retryLabel === null || version === null) return []
    const labels = { more: moreLabel, loading: loadingLabel, retry: retryLabel }
    const loopId = id, publishVersion = version
    const raw: unknown = JSON.parse(element.getAttribute('data-instatic-loop-query-bindings') || '[]')
    if (!isBindings(raw)) throw new Error('Invalid loop query bindings')
    const bindings = raw
    attached.add(element); element.setAttribute('data-instatic-loop-attached', '')
    let page = Number(element.getAttribute('data-instatic-loop-page') || 1)
    let hasMore = element.getAttribute('data-instatic-loop-has-more') === 'true'
    const initial: unknown = JSON.parse(element.getAttribute('data-instatic-loop-query-initial') || '{}')
    if (!isInitial(initial)) throw new Error('Invalid loop initial query')
    const initialUrl = new URL(location.pathname + location.search, location.href)
    for (const binding of bindings) {
      if (Object.hasOwn(initial, binding.queryParameter)) initialUrl.searchParams.set(binding.queryParameter, initial[binding.queryParameter])
      else initialUrl.searchParams.delete(binding.queryParameter)
    }
    let pagePath = initialUrl.pathname + initialUrl.search
    let busy = false, failed = false, generation = 0, replaceOnRetry = false
    let abort: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined
    const controls = document.createElement('div')
    controls.setAttribute('data-instatic-loop-controls', id)
    const button = authored ?? document.createElement('button')
    if (!authored) {
      button.type = 'button'; button.className = 'instatic-loop-load-more'
      button.setAttribute('data-instatic-loop-load-more', id)
    }
    const idleChildren = [...button.childNodes]
    let transient = false
    const empty = document.createElement('p')
    empty.setAttribute('role', 'status')
    empty.textContent = element.getAttribute('data-instatic-loop-empty-label') || ''
    controls.append(empty)
    if (!authored) controls.append(button)
    // A tbody accepts rows, and a list accepts list items. Keep loading/status
    // controls in flow content after the surrounding table/list instead.
    const host = element.closest('table,ul,ol,menu,dl,select') || element
    if (!authored || empty.textContent) host.insertAdjacentElement('afterend', controls)
    function updateControls(): void {
      const total = Number(element.getAttribute('data-instatic-loop-total') || '0')
      const loaded = Number(element.getAttribute('data-instatic-loop-loaded') || '0')
      const offset = Number(element.getAttribute('data-instatic-loop-offset') || '0')
      const label = labels.more.replaceAll('{remaining}', String(Math.max(0, total - offset - loaded))).replaceAll('{loaded}', String(loaded)).replaceAll('{total}', String(total))
      button.disabled = busy
      if (authored) {
        if (busy || failed) { button.replaceChildren(document.createTextNode(busy ? labels.loading : labels.retry)); transient = true }
        else {
          if (transient) { button.replaceChildren(...idleChildren); transient = false }
          if (idleChildren.length === 1 && idleChildren[0].nodeType === 3) idleChildren[0].nodeValue = label
        }
      } else button.textContent = busy ? labels.loading : failed ? labels.retry : label
      button.hidden = !busy && !failed && !hasMore
      empty.hidden = busy || failed || !empty.textContent || Number(element.getAttribute('data-instatic-loop-total')) !== 0
      controls.hidden = (Boolean(authored) || button.hidden) && empty.hidden
      element.setAttribute('aria-busy', busy ? 'true' : 'false')
      summaries()
    }
    function request(nextPage: number, replace: boolean): void {
      abort?.abort()
      const current = ++generation, controller = new AbortController(), path = pagePath
      abort = controller; busy = true; failed = false; replaceOnRetry = replace; updateControls()
      queue.push(async () => {
        if (controller.signal.aborted || current !== generation || !element.isConnected) return
        try {
          const params = new URLSearchParams({ page: String(nextPage), pagePath: path, v: publishVersion })
          const response = await fetch(endpoint + encodeURIComponent(loopId) + '?' + params.toString(), {
            headers: { accept: 'application/json' }, credentials: 'same-origin', signal: controller.signal,
          })
          if (!response.ok) throw new Error('Loop fetch failed: ' + response.status)
          const body: unknown = await response.json()
          if (!isResponse(body) || body.pageNumber !== nextPage) throw new Error('Invalid loop response')
          if (controller.signal.aborted || current !== generation || !element.isConnected) return
          if (replace) element.innerHTML = body.html
          else if (body.html) element.insertAdjacentHTML('beforeend', body.html)
          page = body.pageNumber; hasMore = body.hasMore
          element.setAttribute('data-instatic-loop-page', String(page))
          element.setAttribute('data-instatic-loop-has-more', String(hasMore))
          element.setAttribute('data-instatic-loop-total', String(body.totalItems))
          const offset = Number(element.getAttribute('data-instatic-loop-offset') || '0')
          const size = Number(element.getAttribute('data-instatic-loop-page-size') || '10')
          element.setAttribute('data-instatic-loop-loaded', String(Math.max(0, body.hasMore ? Math.min(body.totalItems - offset, page * size) : body.totalItems - offset)))
          summaries()
          document.dispatchEvent(new CustomEvent('instatic:content'))
        } catch (error) {
          if (controller.signal.aborted || current !== generation || !element.isConnected) return
          console.error('[instatic-loop]', error)
          failed = true
        } finally {
          if (current === generation && element.isConnected) { busy = false; updateControls() }
        }
      })
      pump()
    }
    function click(): void {
      if (!busy && (failed || hasMore)) request(failed && replaceOnRetry ? 1 : page + 1, failed && replaceOnRetry)
    }
    button.addEventListener('click', click)
    const formIds = [...new Set(bindings.map(binding => binding.formId))]
    handlers.add({ element, formIds, cleanup() {
      abort?.abort(); clearTimeout(timer); controls.remove(); button.removeEventListener('click', click)
      if (authored && transient) button.replaceChildren(...idleChildren)
    }, change(detail) {
      const query = new URL(pagePath, location.href)
      for (const binding of bindings) if (binding.formId === detail.formId && Object.hasOwn(detail.values, binding.fieldName)) {
        const value = detail.values[binding.fieldName]
        let encoded: string
        if (binding.valueType === 'stringArray') {
          if (!Array.isArray(value) || value.length > 1000 || value.some(item => typeof item !== 'string' || item.length > 256)) return
          encoded = JSON.stringify(value)
        } else {
          if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) return
          encoded = value === null ? '' : String(value)
        }
        if (encoded.length > 2048) return
        query.searchParams.set(binding.queryParameter, encoded)
      }
      const nextPath = query.pathname + query.search
      if (nextPath === pagePath) return
      pagePath = nextPath; generation++; abort?.abort(); clearTimeout(timer)
      busy = true; failed = false; updateControls()
      timer = setTimeout(() => { if (element.isConnected) request(1, true) }, 120)
    } })
    updateControls()
    return formIds
  }
  function init(): void {
    for (const handler of handlers) if (!handler.element.isConnected) { handler.cleanup(); handlers.delete(handler) }
    const formIds = new Set<string>()
    for (const element of document.querySelectorAll('[data-instatic-loop][data-instatic-loop-mode="infinite"]')) for (const id of attach(element)) formIds.add(id)
    summaries()
    for (const formId of formIds) document.dispatchEvent(new CustomEvent('instatic:form-values-request', { detail: { formId } }))
  }
  document.addEventListener('instatic:form-values', (event) => {
    if (!(event instanceof CustomEvent) || !isFormValues(event.detail)) return
    for (const handler of handlers) {
      if (!handler.element.isConnected) { handler.cleanup(); handlers.delete(handler); continue }
      if (handler.formIds.includes(event.detail.formId)) handler.change(event.detail)
    }
  })
  document.addEventListener('instatic:content', init)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true })
  else init()
}

const compile = (schema: Parameters<typeof TypeCompiler.Compile>[0]) => `(() => {${TypeCompiler.Compile(schema).Code()}})()`
export const LOOP_RUNTIME_JS = `(${runInstaticLoopRuntime.toString()})(${[
  LoopPageResponseSchema, LoopQueryBindingsSchema, FormValuesEventDetailSchema, Type.Array(Type.String()), Type.Record(Type.String(), Type.String()),
].map(compile).join(',')});`
export const LOOP_RUNTIME_ASSET_URL = '/_instatic/assets/loop-runtime.js?h=' + Bun.hash(LOOP_RUNTIME_JS).toString(16)
