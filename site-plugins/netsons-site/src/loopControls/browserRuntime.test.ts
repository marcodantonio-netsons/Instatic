import { describe, expect, it } from 'bun:test'
import { JSDOM } from 'jsdom'
import { Value } from '@sinclair/typebox/value'
import { LoopMoreModule } from './modules'
import { LoopMorePropsSchema } from './schema'
import { installLoopControlsRuntime } from './browserRuntime'

const loopId = 'articles'
const pagePath = '/fr/assistance/base-connaissances?query=cloud&keep=1'

function pageFragment(page: number, hasMore: boolean, itemId = `article-${page}`): string {
  return `<div data-instatic-loop="${loopId}" data-instatic-loop-mode="infinite" data-instatic-loop-page="${page}" data-instatic-loop-has-more="${hasMore}" data-netsons-loop-loaded="1"><article id="${itemId}">Page ${page}</article></div>`
}

function response(html: string, ok = true, body: unknown = { totalItems: 0 }): { ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> } {
  return { ok, status: ok ? 200 : 503, text: async () => html, json: async () => body }
}

type QueryConfig = { visitorBindings: Array<{ formId: string; fieldName: string; queryParameter: string }> }

async function startRuntime(
  mode: 'page' | 'all',
  fetcher: (url: string, init?: RequestInit) => Promise<ReturnType<typeof response>>,
  queryConfigs: Record<string, QueryConfig> = {},
  queryConfigId?: string,
) {
  const queryConfigAttribute = queryConfigId ? ` data-netsons-query-config="${queryConfigId}"` : ''
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="loop" data-instatic-loop="${loopId}" data-instatic-loop-mode="infinite" data-instatic-loop-page="1" data-instatic-loop-has-more="true" data-netsons-loop-hole="hole-articles" data-netsons-loop-version="published-1" data-netsons-loop-loaded="1"${queryConfigAttribute}><article id="article-1">Page 1</article></div>
    <button id="more" data-instatic-loop-more="${loopId}" data-instatic-loop-more-mode="${mode}" data-instatic-loop-load-more-label="More articles" data-instatic-loop-loading-label="Loading articles" data-instatic-loop-retry-label="Retry articles">More articles</button>
  </body></html>`, { url: `https://example.invalid${pagePath}`, runScripts: 'outside-only' })
  Object.defineProperty(dom.window, 'fetch', { value: (url: string, init?: RequestInit) => fetcher(url, init) })
  dom.window.console.error = () => {}
  installLoopControlsRuntime(dom.window.document, queryConfigs)
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'))
  await tick()
  return dom
}

function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (predicate()) return
    await tick()
  }
  throw new Error('Timed out waiting for loop paging to settle')
}

function pageFromRequest(requestUrl: string): { page: number; innerUrl: URL } {
  const request = new URL(requestUrl)
  const inner = new URL(request.searchParams.get('u') || '', 'https://example.invalid')
  return {
    page: Number(inner.searchParams.get(`loop_${loopId}_page`)),
    innerUrl: inner,
  }
}

describe('loop-more mode', () => {
  it('defaults to page mode and publishes the explicit mode attribute', () => {
    expect(Value.Default(LoopMorePropsSchema, { loopId })).toMatchObject({ mode: 'page' })
    const rendered = LoopMoreModule.render({
      loopId,
      mode: 'all',
      label: 'More articles',
      loadingLabel: 'Loading articles',
      retryLabel: 'Retry articles',
      htmlAttributes: {},
    }, [])
    expect(rendered.html).toContain('data-instatic-loop-more-mode="all"')
  })

  it('loads exactly the next native hole page in page mode and preserves filters in the request URL', async () => {
    const requests: string[] = []
    const dom = await startRuntime('page', async url => {
      requests.push(url)
      return response(pageFragment(2, true))
    })
    try {
      dom.window.document.querySelector<HTMLButtonElement>('#more')!.click()
      await waitFor(() => dom.window.document.querySelector('#article-2') !== null)
      expect(requests).toHaveLength(1)
      expect(pageFromRequest(requests[0]).page).toBe(2)
      expect(pageFromRequest(requests[0]).innerUrl.pathname + pageFromRequest(requests[0]).innerUrl.search).toBe(`${pagePath}&loop_${loopId}_page=2`)
      expect(requests[0]).toContain('/_instatic/hole/hole-articles?')
      expect(dom.window.document.querySelector('#loop')?.getAttribute('data-instatic-loop-page')).toBe('2')
      expect(dom.window.document.querySelector<HTMLButtonElement>('#more')?.hidden).toBe(false)
    } finally {
      dom.window.close()
    }
  })

  it('loads all remaining pages serially after one click in all mode', async () => {
    const requests: string[] = []
    let active = 0
    let maxActive = 0
    const dom = await startRuntime('all', async url => {
      requests.push(url)
      active++
      maxActive = Math.max(maxActive, active)
      const { page } = pageFromRequest(url)
      await tick()
      active--
      return response(pageFragment(page, page < 3))
    })
    try {
      dom.window.document.querySelector<HTMLButtonElement>('#more')!.click()
      await waitFor(() => dom.window.document.querySelector('#article-3') !== null)
      expect(requests.map(url => pageFromRequest(url).page)).toEqual([2, 3])
      expect(maxActive).toBe(1)
      for (const url of requests) {
        const innerUrl = pageFromRequest(url).innerUrl
        expect(innerUrl.pathname).toBe('/fr/assistance/base-connaissances')
        expect(innerUrl.searchParams.get('query')).toBe('cloud')
        expect(innerUrl.searchParams.get('keep')).toBe('1')
      }
      expect(dom.window.document.querySelector('#loop')?.getAttribute('data-instatic-loop-has-more')).toBe('false')
      expect(dom.window.document.querySelector<HTMLButtonElement>('#more')?.hidden).toBe(true)
    } finally {
      dom.window.close()
    }
  })

  it('keeps completed pages after a later failure and retries from the failed native page', async () => {
    const requestedPages: number[] = []
    let failPageThreeOnce = true
    const originalConsoleError = console.error
    console.error = () => {}
    let dom: Awaited<ReturnType<typeof startRuntime>> | undefined
    try {
      const activeDom = await startRuntime('all', async url => {
        const { page } = pageFromRequest(url)
        requestedPages.push(page)
        if (page === 3 && failPageThreeOnce) {
          failPageThreeOnce = false
          return response('', false)
        }
        return response(pageFragment(page, page < 3))
      })
      dom = activeDom
      const button = activeDom.window.document.querySelector<HTMLButtonElement>('#more')!
      button.click()
      await waitFor(() => button.textContent === 'Retry articles')
      expect(requestedPages).toEqual([2, 3])
      expect(activeDom.window.document.querySelector('#article-2')).not.toBeNull()
      expect(activeDom.window.document.querySelector('#article-3')).toBeNull()
      expect(button.hidden).toBe(false)

      button.click()
      await waitFor(() => activeDom.window.document.querySelector('#article-3') !== null)
      expect(requestedPages).toEqual([2, 3, 3])
      expect(button.hidden).toBe(true)
    } finally {
      console.error = originalConsoleError
      dom?.window.close()
    }
  })

  it('rejects a non-advancing fragment before appending it, then retries the requested page', async () => {
    const requestedPages: number[] = []
    let returnNonAdvancingPage = true
    const originalConsoleError = console.error
    console.error = () => {}
    let dom: Awaited<ReturnType<typeof startRuntime>> | undefined
    try {
      const activeDom = await startRuntime('page', async url => {
        const { page } = pageFromRequest(url)
        requestedPages.push(page)
        if (returnNonAdvancingPage) {
          returnNonAdvancingPage = false
          return response(pageFragment(1, true))
        }
        return response(pageFragment(2, false))
      })
      dom = activeDom
      const { document } = activeDom.window
      const button = document.querySelector<HTMLButtonElement>('#more')!
      button.click()
      await waitFor(() => button.textContent === 'Retry articles')
      expect(document.querySelector('#article-2')).toBeNull()
      expect(document.querySelector('#loop')?.getAttribute('data-instatic-loop-page')).toBe('1')
      expect(button.hidden).toBe(false)

      button.click()
      await waitFor(() => document.querySelector('#article-2') !== null)
      expect(requestedPages).toEqual([2, 2])
      expect(document.querySelector('#loop')?.getAttribute('data-instatic-loop-page')).toBe('2')
    } finally {
      console.error = originalConsoleError
      dom?.window.close()
    }
  })

  it('keeps the latest filter refresh busy while stale all-mode and older filter responses resolve', async () => {
    const requests: Array<{ page: number; query: string | null }> = []
    const pending = new Map<string, () => void>()
    const queryConfigs = {
      knowledge: { visitorBindings: [{ formId: 'knowledge-filter', fieldName: 'query', queryParameter: 'query' }] },
    }
    const dom = await startRuntime('all', async (url, init) => {
      if (init?.method === 'POST') return response('', true, { totalItems: 5 })
      const { page, innerUrl } = pageFromRequest(url)
      const query = innerUrl.searchParams.get('query')
      requests.push({ page, query })
      if (page === 2 && query === 'cloud') {
        return new Promise(resolve => {
          pending.set('cloud-page-2', () => resolve(response(pageFragment(2, true))))
        })
      }
      if (page === 1 && (query === 'edge' || query === 'vps')) {
        return new Promise(resolve => {
          pending.set(`${query}-page-1`, () => resolve(response(pageFragment(1, query === 'edge', `article-${query}`))))
        })
      }
      return response(pageFragment(page, page < 3))
    }, queryConfigs, 'knowledge')
    try {
      const { document } = dom.window
      document.querySelector<HTMLButtonElement>('#more')!.click()
      await waitFor(() => requests.some(request => request.page === 2 && request.query === 'cloud'))

      const button = document.querySelector<HTMLButtonElement>('#more')!
      const formValues = (query: string) => document.dispatchEvent(new dom.window.CustomEvent('instatic:form-values', {
        detail: { formId: 'knowledge-filter', values: { query } },
      }))

      formValues('edge')
      await waitFor(() => requests.some(request => request.page === 1 && request.query === 'edge'))
      expect(button.disabled).toBe(true)
      expect(document.querySelector('#loop')?.getAttribute('aria-busy')).toBe('true')

      pending.get('cloud-page-2')!()
      await tick()
      expect(document.querySelector('#article-2')).toBeNull()
      expect(button.disabled).toBe(true)
      expect(document.querySelector('#loop')?.getAttribute('aria-busy')).toBe('true')

      formValues('vps')
      await waitFor(() => requests.some(request => request.page === 1 && request.query === 'vps'))
      expect(button.disabled).toBe(true)
      expect(document.querySelector('#loop')?.getAttribute('aria-busy')).toBe('true')

      pending.get('edge-page-1')!()
      await tick()
      expect(document.querySelector('#article-edge')).toBeNull()
      expect(button.disabled).toBe(true)
      expect(document.querySelector('#loop')?.getAttribute('aria-busy')).toBe('true')

      pending.get('vps-page-1')!()
      await waitFor(() => document.querySelector('#article-vps') !== null)
      expect(requests).toEqual([
        { page: 2, query: 'cloud' },
        { page: 1, query: 'edge' },
        { page: 1, query: 'vps' },
      ])
      expect(document.querySelector('#article-2')).toBeNull()
      expect(document.querySelector('#article-edge')).toBeNull()
      expect(document.querySelector('#article-vps')).not.toBeNull()
      expect(document.querySelector('#loop')?.getAttribute('data-instatic-loop-page')).toBe('1')
      expect(dom.window.location.search).toBe('?query=vps&keep=1')
      expect(button.disabled).toBe(false)
      expect(button.hidden).toBe(true)
      expect(document.querySelector('#loop')?.hasAttribute('aria-busy')).toBe(false)
    } finally {
      dom.window.close()
    }
  })
})
