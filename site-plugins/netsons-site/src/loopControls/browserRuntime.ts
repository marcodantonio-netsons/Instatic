/** Native hole paging and visitor-query summaries for the official publisher. */
type VisitorBinding = {
  formId: string
  fieldName: string
  queryParameter: string
  whenFieldEmpty?: string
  valueType?: 'text' | 'stringArray'
}

type QueryConfig = {
  visitorBindings: readonly VisitorBinding[]
}

type FormValuesDetail = {
  formId: string
  values: Record<string, unknown>
}

type LoopState = {
  idleChildren: Node[]
  fallback: boolean
  busy: boolean
  failed: boolean
  controller?: AbortController
}

type Summary = { loaded: number; total: number | null }

export function installLoopControlsRuntime(
  document: Document,
  queryConfigs: Record<string, QueryConfig>,
): void {
  const browser = document.defaultView
  if (!browser) return
  const active = browser as Window & typeof globalThis
  const countRoute = '/admin/api/cms/plugins/netsons.site/runtime/catalogue-query/count'
  const buttonStates = new WeakMap<HTMLButtonElement, LoopState>()
  const pendingForms = new Map<string, number>()
  const filterRequests = new Map<HTMLElement, AbortController>()
  const pendingRefreshConfigs = new Set<string>()
  const activeConfigRefreshes = new Map<string, Promise<void>>()
  const countRequests = new Map<string, { key: string; promise: Promise<number | null> }>()
  const countResults = new Map<string, { key: string; total: number }>()

  function configFormId(config: QueryConfig): string | null {
    const ids = Array.from(new Set(config.visitorBindings.map(binding => binding.formId)))
    return ids.length === 1 ? ids[0] : null
  }

  function validCount(value: string | null): number | null {
    if (value === null || !/^\d+$/.test(value)) return null
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
  }

  function encodedValue(value: unknown, binding: VisitorBinding): string | null {
    if (binding.valueType === 'stringArray') {
      if (!Array.isArray(value) || value.length > 1000 || value.some(item => typeof item !== 'string' || item.length > 256)) return null
      return JSON.stringify(value)
    }
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) return null
    const result = value === null ? '' : String(value)
    return result.length <= 2048 ? result : null
  }

  function loops(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('[data-instatic-loop]'))
  }

  function resolveLoop(id: string): HTMLElement | undefined {
    const candidates = loops()
    const exact = candidates.filter(loop => loop.getAttribute('data-instatic-loop') === id)
    if (exact.length === 1) return exact[0]
    if (exact.length > 1) return undefined
    const suffix = candidates.filter(loop => loop.getAttribute('data-instatic-loop')?.endsWith('_' + id))
    return suffix.length === 1 ? suffix[0] : undefined
  }

  function readIds(element: Element): string[] {
    const attribute = element.hasAttribute('data-instatic-loop-count')
      ? 'data-instatic-loop-count'
      : 'data-instatic-loop-empty-group'
    try {
      const parsed: unknown = JSON.parse(element.getAttribute(attribute) || '[]')
      return Array.isArray(parsed) && parsed.every(id => typeof id === 'string')
        ? Array.from(new Set(parsed))
        : []
    } catch {
      return []
    }
  }

  function readConfigIds(element: Element, expectedCount: number): string[] {
    try {
      const parsed: unknown = JSON.parse(element.getAttribute('data-netsons-query-configs') || '[]')
      return Array.isArray(parsed) && parsed.length === expectedCount &&
        parsed.every(id => typeof id === 'string' && Object.hasOwn(queryConfigs, id))
        ? parsed
        : []
    } catch {
      return []
    }
  }

  function referencedLoopsForConfig(configId: string): string[] {
    const references = new Set<string>()
    for (const element of document.querySelectorAll<HTMLElement>('[data-instatic-loop-count], [data-instatic-loop-empty-group]')) {
      const ids = readIds(element)
      const configs = readConfigIds(element, ids.length)
      configs.forEach((candidate, index) => {
        if (candidate === configId) references.add(ids[index])
      })
    }
    return Array.from(references)
  }

  function renderedItems(loop: HTMLElement): number {
    const declared = validCount(loop.getAttribute('data-netsons-loop-loaded'))
    if (declared !== null) return declared
    return Array.from(loop.children).filter(child => !child.matches(
      '[data-instatic-loop-more], [data-instatic-loop-controls], [data-instatic-loop-load-more]',
    )).length
  }

  function summary(ids: string[], configIds: string[] = []): Summary {
    let loaded = 0
    let total = 0
    let totalKnown = ids.length > 0
    for (const [index, id] of ids.entries()) {
      const loop = resolveLoop(id)
      if (loop) loaded += renderedItems(loop)
      const attrTotal = loop ? validCount(loop.getAttribute('data-netsons-loop-total')) : null
      const configTotal = configTotalFor(configIds[index] || '')
      const value = attrTotal ?? configTotal
      if (value === null) totalKnown = false
      else total += value
    }
    return { loaded, total: totalKnown ? total : null }
  }

  function metricValue(metric: string | null, counts: Summary): string {
    if (metric === 'loaded') return String(counts.loaded)
    if (metric === 'remaining') return counts.total === null ? '?' : String(Math.max(0, counts.total - counts.loaded))
    if (metric === 'progress') return `${counts.loaded}/${counts.total === null ? '?' : counts.total}`
    return counts.total === null ? '?' : String(counts.total)
  }

  function updateSummaries(): void {
    for (const element of document.querySelectorAll<HTMLElement>('[data-instatic-loop-count]')) {
      const ids = readIds(element)
      const configIds = readConfigIds(element, ids.length)
      for (const configId of configIds) void ensureCount(configId)
      const value = metricValue(element.getAttribute('data-instatic-loop-count-metric'), summary(ids, configIds))
      if (element.textContent !== value) element.textContent = value
    }
    for (const element of document.querySelectorAll<HTMLElement>('[data-instatic-loop-empty-group]')) {
      const ids = readIds(element)
      const configIds = readConfigIds(element, ids.length)
      for (const configId of configIds) void ensureCount(configId)
      const counts = summary(ids, configIds)
      const condition = element.getAttribute('data-instatic-loop-condition')
      const hidden = counts.total === null || (condition === 'empty' ? counts.total !== 0 : counts.total === 0)
      if (element.hidden !== hidden) element.hidden = hidden
    }
  }

  function label(button: HTMLButtonElement): string {
    const template = button.getAttribute('data-instatic-loop-load-more-label') || 'Load more'
    const id = button.getAttribute('data-instatic-loop-more') || ''
    const counts = summary([id])
    return template
      .replaceAll('{remaining}', counts.total === null ? '?' : String(Math.max(0, counts.total - counts.loaded)))
      .replaceAll('{loaded}', String(counts.loaded))
      .replaceAll('{total}', counts.total === null ? '?' : String(counts.total))
  }

  function displayTransient(button: HTMLButtonElement, value: string): void {
    if (button.childNodes.length !== 1 || button.textContent !== value) {
      button.replaceChildren(document.createTextNode(value))
    }
    button.setAttribute('data-netsons-loop-transient', '')
  }

  function restoreIdle(button: HTMLButtonElement, state: LoopState): void {
    if (button.hasAttribute('data-netsons-loop-transient')) {
      button.replaceChildren(...state.idleChildren)
      button.removeAttribute('data-netsons-loop-transient')
    }
    if (state.fallback) {
      const value = label(button)
      if (button.textContent !== value) button.textContent = value
    }
  }

  function syncMoreButtons(): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-instatic-loop-more]')) {
      let state = buttonStates.get(button)
      if (!state) {
        state = {
          idleChildren: Array.from(button.childNodes),
          fallback: button.hasAttribute('data-instatic-loop-more-fallback'),
          busy: false,
          failed: false,
        }
        buttonStates.set(button, state)
      }
      const id = button.getAttribute('data-instatic-loop-more') || ''
      const loop = resolveLoop(id)
      const hasMore = loop?.getAttribute('data-instatic-loop-has-more') === 'true'
      const filtering = loop ? filterRequests.has(loop) : false
      button.hidden = !loop || (!hasMore && !state.failed)
      button.disabled = state.busy || filtering
      if (state.busy || filtering) {
        button.setAttribute('aria-busy', 'true')
        displayTransient(button, button.getAttribute('data-instatic-loop-loading-label') || 'Loading…')
      } else if (state.failed) {
        button.removeAttribute('aria-busy')
        displayTransient(button, button.getAttribute('data-instatic-loop-retry-label') || 'Try again')
      } else {
        button.removeAttribute('aria-busy')
        restoreIdle(button, state)
      }
    }
  }

  function countRequest(configId: string): { url: string; body: { config: string; path: string; query: Record<string, string> } } | null {
    if (!queryConfigs[configId]) return null
    const page = new URL(active.location.href)
    const query: Record<string, string> = {}
    const config = queryConfigs[configId]
    for (const binding of config.visitorBindings) {
      if (binding.whenFieldEmpty) {
        const condition = config.visitorBindings.find(candidate => candidate.fieldName === binding.whenFieldEmpty)
        const conditionValue = condition ? page.searchParams.get(condition.queryParameter) : null
        if (conditionValue?.trim()) continue
      }
      const value = page.searchParams.get(binding.queryParameter)
      if (value !== null) query[binding.queryParameter] = value
    }
    return { url: new URL(countRoute, active.location.origin).toString(), body: { config: configId, path: page.pathname, query } }
  }

  function configTotalFor(configId: string): number | null {
    const request = countRequest(configId)
    if (!request) return null
    const result = countResults.get(configId)
    return result?.key === JSON.stringify(request.body) ? result.total : null
  }

  function ensureCount(configId: string): Promise<number | null> {
    const request = countRequest(configId)
    if (!request) return Promise.resolve(null)
    const key = JSON.stringify(request.body)
    const cached = countResults.get(configId)
    if (cached?.key === key) return Promise.resolve(cached.total)
    const activeRequest = countRequests.get(configId)
    if (activeRequest?.key === key) return activeRequest.promise
    const promise = (async (): Promise<number | null> => {
      try {
        const response = await active.fetch(request.url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify(request.body),
        })
        if (!response.ok) throw new Error(`Count request failed: ${response.status}`)
        const body: unknown = await response.json()
        if (!body || typeof body !== 'object' || !('totalItems' in body)) throw new Error('Invalid count response')
        const total = (body as { totalItems: unknown }).totalItems
        if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) throw new Error('Invalid count response')
        if (JSON.stringify(countRequest(configId)?.body) !== key) return null
        countResults.set(configId, { key, total })
        scheduleUpdate()
        return total
      } catch (error) {
        console.error('[netsons.loop-controls] Could not update result count:', error)
        return null
      }
    })()
    countRequests.set(configId, { key, promise })
    void promise.then(() => {
      if (countRequests.get(configId)?.promise === promise) countRequests.delete(configId)
    })
    return promise
  }

  async function updateTotal(loop: HTMLElement): Promise<void> {
    const configId = loop.getAttribute('data-netsons-query-config') || ''
    const total = await ensureCount(configId)
    if (total === null || !loop.isConnected || loop.getAttribute('data-netsons-query-config') !== configId) return
    loop.setAttribute('data-netsons-loop-total', String(total))
    loop.setAttribute('data-netsons-loop-loaded', String(renderedItems(loop)))
    scheduleUpdate()
  }

  function loopInNodes(nodes: NodeList): HTMLElement[] {
    const found: HTMLElement[] = []
    for (const node of nodes) {
      if (!(node instanceof active.Element)) continue
      if (node.matches('[data-instatic-loop]')) found.push(node as HTMLElement)
      found.push(...node.querySelectorAll<HTMLElement>('[data-instatic-loop]'))
    }
    return found
  }

  function captureHydratedHoles(records: MutationRecord[]): void {
    const refreshConfigs = new Set<string>()
    for (const record of records) {
      const removed = Array.from(record.removedNodes).find(node =>
        node instanceof active.HTMLElement && node.localName === 'instatic-hole',
      ) as HTMLElement | undefined
      if (!removed) continue
      const holeId = removed.getAttribute('data-instatic-hole')
      const version = removed.getAttribute('data-instatic-version')
      if (!holeId || !version) continue
      for (const loop of loopInNodes(record.addedNodes)) {
        loop.setAttribute('data-netsons-loop-hole', holeId)
        loop.setAttribute('data-netsons-loop-version', version)
        loop.setAttribute('data-netsons-loop-loaded', String(renderedItems(loop)))
        const configId = loop.getAttribute('data-netsons-query-config') || ''
        if (pendingRefreshConfigs.has(configId)) refreshConfigs.add(configId)
        else void updateTotal(loop)
      }
    }
    for (const configId of refreshConfigs) void refreshConfigLoops(configId)
  }

  function loopRequestUrl(loop: HTMLElement, pageNumber: number, base?: URL): URL {
    const holeId = loop.getAttribute('data-netsons-loop-hole') || loop.getAttribute('data-instatic-loop') || ''
    const version = loop.getAttribute('data-netsons-loop-version') || ''
    if (!holeId || !version) throw new Error('The rendered loop has no native hole context')
    const pageUrl = new URL(base?.toString() || active.location.href)
    for (const key of Array.from(pageUrl.searchParams.keys())) {
      if (/^loop_.+_page$/.test(key)) pageUrl.searchParams.delete(key)
    }
    const loopId = loop.getAttribute('data-instatic-loop') || ''
    pageUrl.searchParams.set(`loop_${loopId}_page`, String(pageNumber))
    const endpoint = new URL(`/_instatic/hole/${encodeURIComponent(holeId)}`, active.location.origin)
    endpoint.searchParams.set('v', version)
    endpoint.searchParams.set('u', pageUrl.pathname + pageUrl.search)
    return endpoint
  }

  async function renderLoopPage(loop: HTMLElement, pageNumber: number, replace: boolean, signal?: AbortSignal): Promise<void> {
    const requestUrl = loopRequestUrl(loop, pageNumber)
    const response = await active.fetch(requestUrl.toString(), {
      credentials: 'same-origin',
      headers: { accept: 'text/html' },
      signal,
    })
    if (!response.ok) throw new Error(`Loop fragment request failed: ${response.status}`)
    const html = await response.text()
    if (html.includes('data-instatic-stale="true"')) throw new Error('The published loop fragment is stale')
    const parsed = new active.DOMParser().parseFromString(html, 'text/html')
    const loopId = loop.getAttribute('data-instatic-loop') || ''
    const next = Array.from(parsed.querySelectorAll<HTMLElement>('[data-instatic-loop]'))
      .find(candidate => candidate.getAttribute('data-instatic-loop') === loopId)
    if (!next) throw new Error(`The native fragment did not contain loop ${loopId}`)

    const previousLoaded = renderedItems(loop)
    const pageLoaded = next.children.length
    if (replace) loop.replaceChildren(...Array.from(next.childNodes))
    else loop.append(...Array.from(next.childNodes))
    loop.setAttribute('data-instatic-loop-page', next.getAttribute('data-instatic-loop-page') || String(pageNumber))
    loop.setAttribute('data-instatic-loop-has-more', next.getAttribute('data-instatic-loop-has-more') || 'false')
    loop.setAttribute('data-netsons-loop-loaded', String(replace ? pageLoaded : previousLoaded + pageLoaded))
    void updateTotal(loop)
  }

  async function refreshConfigLoops(configId: string): Promise<void> {
    const activeRefresh = activeConfigRefreshes.get(configId)
    if (activeRefresh) return activeRefresh
    const targets = loops().filter(loop => loop.getAttribute('data-netsons-query-config') === configId)
    if (!targets.length) return
    const promise = Promise.all(targets.map(async loop => {
      filterRequests.get(loop)?.abort()
      const controller = new active.AbortController()
      filterRequests.set(loop, controller)
      loop.removeAttribute('data-netsons-loop-total')
      loop.setAttribute('aria-busy', 'true')
      syncMoreButtons()
      try {
        await renderLoopPage(loop, 1, true, controller.signal)
        return true
      } catch (error) {
        if (!controller.signal.aborted) console.error('[netsons.loop-controls] Could not apply the visitor filter:', error)
        return false
      } finally {
        if (filterRequests.get(loop) === controller) {
          filterRequests.delete(loop)
          loop.removeAttribute('aria-busy')
          syncMoreButtons()
        }
      }
    })).then(results => {
      const expected = referencedLoopsForConfig(configId)
      if (results.every(Boolean) && expected.every(id => resolveLoop(id))) pendingRefreshConfigs.delete(configId)
    }).finally(() => {
      if (activeConfigRefreshes.get(configId) === promise) activeConfigRefreshes.delete(configId)
    })
    activeConfigRefreshes.set(configId, promise)
    return promise
  }

  async function loadMore(button: HTMLButtonElement): Promise<void> {
    const id = button.getAttribute('data-instatic-loop-more') || ''
    const loop = resolveLoop(id)
    const state = buttonStates.get(button)
    if (!loop || !state || (loop.getAttribute('data-instatic-loop-has-more') !== 'true' && !state.failed)) return
    if (state.busy) return
    const page = Number(loop.getAttribute('data-instatic-loop-page') || '1')
    state.busy = true
    state.failed = false
    loop.setAttribute('aria-busy', 'true')
    state.controller?.abort()
    const controller = new active.AbortController()
    state.controller = controller
    syncMoreButtons()
    try {
      await renderLoopPage(loop, page + 1, false, controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error('[netsons.loop-controls] Could not load the next loop page:', error)
        state.failed = true
      }
    } finally {
      state.busy = false
      loop.removeAttribute('aria-busy')
      syncMoreButtons()
      updateSummaries()
    }
  }

  function applyFormValues(detail: FormValuesDetail): void {
    const matchingConfigs = Object.entries(queryConfigs).filter(([, config]) => configFormId(config) === detail.formId)
    if (!matchingConfigs.length) return
    const next = new URL(active.location.href)
    let changed = false
    const affectedConfigIds = new Set<string>()
    for (const [configId, config] of matchingConfigs) {
      for (const binding of config.visitorBindings) {
        if (!Object.hasOwn(detail.values, binding.fieldName)) continue
        affectedConfigIds.add(configId)
        const whenValue = binding.whenFieldEmpty ? detail.values[binding.whenFieldEmpty] : ''
        if (binding.whenFieldEmpty && typeof whenValue === 'string' && whenValue.trim() !== '') {
          if (next.searchParams.has(binding.queryParameter)) {
            next.searchParams.delete(binding.queryParameter)
            changed = true
          }
          continue
        }
        const value = encodedValue(detail.values[binding.fieldName], binding)
        if (value === null) continue
        if (value) {
          if (next.searchParams.get(binding.queryParameter) !== value) {
            next.searchParams.set(binding.queryParameter, value)
            changed = true
          }
        } else if (next.searchParams.has(binding.queryParameter)) {
          next.searchParams.delete(binding.queryParameter)
          changed = true
        }
      }
    }
    if (!changed) return

    for (const key of Array.from(next.searchParams.keys())) {
      if (/^loop_.+_page$/.test(key)) next.searchParams.delete(key)
    }
    active.history.replaceState(null, '', next.pathname + next.search + next.hash)
    for (const configId of affectedConfigIds) {
      pendingRefreshConfigs.add(configId)
      countResults.delete(configId)
      void ensureCount(configId)
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-instatic-loop-more]')) {
      const target = button.getAttribute('data-instatic-loop-more') || ''
      const loop = resolveLoop(target)
      if (!loop || !affectedConfigIds.has(loop.getAttribute('data-netsons-query-config') || '')) continue
      const state = buttonStates.get(button)
      state?.controller?.abort()
      if (state) {
        state.busy = false
        state.failed = false
      }
    }
    for (const loop of loops()) {
      if (!affectedConfigIds.has(loop.getAttribute('data-netsons-query-config') || '')) continue
      filterRequests.get(loop)?.abort()
      filterRequests.delete(loop)
      loop.removeAttribute('aria-busy')
      loop.removeAttribute('data-netsons-loop-total')
      void updateTotal(loop)
    }
    syncMoreButtons()
    const timer = pendingForms.get(detail.formId)
    if (timer !== undefined) active.clearTimeout(timer)
    pendingForms.set(detail.formId, active.setTimeout(() => {
      pendingForms.delete(detail.formId)
      for (const configId of affectedConfigIds) void refreshConfigLoops(configId)
    }, 120))
  }

  function readFormValuesEvent(event: Event): FormValuesDetail | null {
    if (!(event instanceof active.CustomEvent)) return null
    const value: unknown = event.detail
    if (!value || typeof value !== 'object') return null
    const detail = value as Partial<FormValuesDetail>
    if (typeof detail.formId !== 'string' || !detail.values || typeof detail.values !== 'object' || Array.isArray(detail.values)) return null
    return { formId: detail.formId, values: detail.values }
  }

  function initialize(): void {
    for (const loop of loops()) {
      loop.setAttribute('data-netsons-loop-loaded', String(renderedItems(loop)))
      void updateTotal(loop)
    }
    updateSummaries()
    syncMoreButtons()
    for (const formId of new Set(Object.values(queryConfigs).map(configFormId).filter((value): value is string => value !== null))) {
      document.dispatchEvent(new active.CustomEvent('instatic:form-values-request', { detail: { formId } }))
    }
  }

  let scheduled = false
  function scheduleUpdate(): void {
    if (scheduled) return
    scheduled = true
    active.queueMicrotask(() => {
      scheduled = false
      updateSummaries()
      syncMoreButtons()
    })
  }

  const observer = new active.MutationObserver(records => {
    captureHydratedHoles(records)
    scheduleUpdate()
  })
  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      'data-instatic-loop',
      'data-instatic-loop-page',
      'data-instatic-loop-has-more',
      'data-instatic-loop-more',
      'data-instatic-loop-count',
      'data-instatic-loop-empty-group',
    ],
  })
  document.addEventListener('instatic:form-values', event => {
    const detail = readFormValuesEvent(event)
    if (detail) applyFormValues(detail)
  })
  document.addEventListener('click', event => {
    if (!(event.target instanceof active.Element)) return
    const button = event.target.closest<HTMLButtonElement>('button[data-instatic-loop-more]')
    if (!button) return
    event.preventDefault()
    const state = buttonStates.get(button)
    if (state?.failed) state.failed = false
    void loadMore(button)
  })

  if (document.readyState === 'complete') initialize()
  else document.addEventListener('DOMContentLoaded', initialize, { once: true })
}
