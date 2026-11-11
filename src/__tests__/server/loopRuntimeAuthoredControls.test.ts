import { describe, expect, it } from 'bun:test'
import { JSDOM } from 'jsdom'
import { LOOP_RUNTIME_JS } from '../../../server/publish/loopRuntime'

const loopId = 'articles'
const authoredMarkup = `<button id="authored-more" data-instatic-loop-more="${loopId}" data-instatic-loop-load-more-label="More articles" data-instatic-loop-loading-label="Loading articles" data-instatic-loop-retry-label="Retry articles"><span>More articles</span><i aria-hidden="true">↓</i></button>`
const pageMarkup = `<div id="articles-loop" data-instatic-loop="${loopId}" data-instatic-loop-mode="infinite" data-instatic-loop-page="1" data-instatic-loop-has-more="true"><article id="article-one">One</article></div>${authoredMarkup}<div id="news-loop" data-instatic-loop="news" data-instatic-loop-mode="infinite" data-instatic-loop-page="1" data-instatic-loop-has-more="true"><article id="news-one">One</article></div>`

async function startRuntime(fetcher: (input: string) => Promise<unknown>) {
  const dom = new JSDOM(`<!doctype html><html><head><script type="module" src="/_instatic/assets/loop-runtime.js"></script></head><body>${pageMarkup}</body></html>`, {
    url: 'https://example.invalid/it/articles?q=test',
    runScripts: 'outside-only',
  })
  const { window } = dom
  const runtimeConsole = { error: () => {} }
  new Function('document', 'location', 'fetch', 'URLSearchParams', 'console', LOOP_RUNTIME_JS)(
    window.document,
    window.location,
    fetcher,
    window.URLSearchParams,
    runtimeConsole,
  )
  if (window.document.readyState === 'loading') {
    await new Promise<void>(resolve => window.document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }))
  }
  return dom
}

function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('official infinite loop runtime with an authored load-more control', () => {
  it('leaves a uniquely matched authored control to its plugin owner and keeps the native default for other loops', async () => {
    const requests: string[] = []
    const dom = await startRuntime(input => {
      requests.push(input)
      return Promise.resolve({ ok: true, json: async () => ({ html: '<article id="news-two">Two</article>', hasMore: false }) })
    })
    const { document, MouseEvent } = dom.window
    try {
      const authored = document.querySelector<HTMLButtonElement>('#authored-more')!
      const articlesLoop = document.querySelector<HTMLElement>('#articles-loop')!
      const newsLoop = document.querySelector<HTMLElement>('#news-loop')!

      expect(document.querySelectorAll('.instatic-loop-load-more')).toHaveLength(1)
      expect(document.querySelectorAll('button[data-instatic-loop-load-more]')).toHaveLength(1)
      expect(authored.parentElement).toBe(document.body)

      authored.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      expect(authored.innerHTML).toBe('<span>More articles</span><i aria-hidden="true">↓</i>')
      expect(authored.hidden).toBe(false)
      expect(articlesLoop.querySelector('.instatic-loop-load-more')).toBeNull()
      expect(articlesLoop.getAttribute('data-instatic-loop-page')).toBe('1')
      expect(requests).toHaveLength(0)

      const nativeDefault = newsLoop.querySelector<HTMLButtonElement>('.instatic-loop-load-more')!
      nativeDefault.click()
      await tick()
      expect(newsLoop.querySelector('#news-two')?.textContent).toBe('Two')
      expect(nativeDefault.isConnected).toBe(false)
      expect(requests).toHaveLength(1)
      expect(requests[0]).toContain('/_instatic/loop/news?page=2')
    } finally {
      dom.window.close()
    }
  })
})
