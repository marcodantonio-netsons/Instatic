import { afterEach, describe, expect, it } from 'bun:test'
import { Window } from 'happy-dom'
import { LOOP_RUNTIME_JS } from '../../../server/publish/loopRuntime'
import type { LoopQueryBinding } from '@core/loops-schema'

const windows: Window[] = []
afterEach(async () => { for (const window of windows.splice(0)) await window.happyDOM.abort() })
const snapshotHash = '7'.repeat(64)
const labels = `data-instatic-loop-load-more-label="More" data-instatic-loop-loading-label="Loading" data-instatic-loop-retry-label="Retry" data-instatic-loop-empty-label="No matches" data-instatic-loop-version="${snapshotHash}"`
const binding = [{ filterKey: 'searchText', formId: 'find', fieldName: 'q', queryParameter: 'q' }]
function markup(id = 'a', bindings: LoopQueryBinding[] = binding, hasMore = false, tag = 'div') {
  const initial = Object.fromEntries(bindings.map(binding => [binding.queryParameter, binding.valueType === 'stringArray' ? '[]' : '']))
  return `<${tag} data-instatic-loop="${id}" data-instatic-loop-mode="infinite" data-instatic-loop-page="1" data-instatic-loop-total="1" data-instatic-loop-has-more="${hasMore}" data-instatic-loop-query-bindings='${JSON.stringify(bindings)}' data-instatic-loop-query-initial='${JSON.stringify(initial)}' ${labels}><span>Original</span></${tag}>`
}
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))
function setup(body: string, fetcher: typeof fetch) {
  const window = new Window({ url: 'http://localhost/catalog?keep=yes' }); windows.push(window)
  window.document.body.innerHTML = body
  const snapshots: string[] = []
  window.document.addEventListener('instatic:form-values-request', event => { if (event instanceof window.CustomEvent) snapshots.push(event.detail.formId) })
  new Function('document', 'location', 'CustomEvent', 'fetch', 'AbortController', LOOP_RUNTIME_JS)(window.document, window.location, window.CustomEvent, fetcher, AbortController)
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'))
  return { window, snapshots, loop: window.document.querySelector('[data-instatic-loop]')!, values(formId: string, values: Record<string, unknown>) {
    window.document.dispatchEvent(new window.CustomEvent('instatic:form-values', { detail: { formId, values } }))
  } }
}
const response = (html: string, pageNumber = 1, totalItems = 2, hasMore = false) => new Response(JSON.stringify({ html, pageNumber, totalItems, hasMore }), { headers: { 'content-type': 'application/json' } })

describe('native loop visitor queries', () => {
  it('does not refetch an unchanged initial form snapshot', async () => {
    let calls = 0
    const view = setup(markup(), (async () => { calls++; return response('Unnecessary') }) as typeof fetch)
    view.values('find', { q: '' }); await tick(140)
    expect(calls).toBe(0)
    expect(view.loop.textContent).toBe('Original')
  })
  it('attaches exhausted loops, requests form state, resets filtered results and appends the same query', async () => {
    const requests: URL[] = []
    const view = setup(markup(), (async input => {
      const url = new URL(String(input), 'http://localhost'); requests.push(url)
      return requests.length === 1 ? response('<span>Filtered</span>', 1, 2, true) : response('<span>Next</span>', 2, 2)
    }) as typeof fetch)
    expect(view.snapshots).toEqual(['find'])
    view.values('other', { q: 'ignored' }); view.values('find', { q: 'cloud', dangerous: 'not-bound' })
    await tick(150)
    expect(requests).toHaveLength(1)
    expect(requests[0].searchParams.get('page')).toBe('1')
    expect(requests[0].searchParams.get('v')).toBe(snapshotHash)
    expect(requests[0].searchParams.get('pagePath')).toBe('/catalog?keep=yes&q=cloud')
    expect(view.loop.textContent).toBe('Filtered')
    const button = view.window.document.querySelector<HTMLButtonElement>('[data-instatic-loop-load-more]')!
    button.click(); await tick()
    expect(requests[1].searchParams.get('page')).toBe('2')
    expect(requests[1].searchParams.get('pagePath')).toBe('/catalog?keep=yes&q=cloud')
    expect(view.loop.textContent).toBe('FilteredNext')
    expect(button.hidden).toBe(true)
  })

  it('discards a stale response even when the transport ignores abort', async () => {
    const pending: Array<{ resolve: (response: Response) => void; signal: AbortSignal }> = []
    const view = setup(markup(), ((_input, init) => new Promise<Response>(resolve => pending.push({ resolve, signal: init!.signal! }))) as typeof fetch)
    view.values('find', { q: 'old' }); await tick(140)
    view.values('find', { q: 'new' }); await tick(140)
    expect(pending[0].signal.aborted).toBe(true)
    pending[1].resolve(response('<b>New</b>')); await tick()
    pending[0].resolve(response('<b>Old</b>')); await tick()
    expect(view.loop.textContent).toBe('New')
    expect(view.loop.getAttribute('aria-busy')).toBe('false')
  })

  it('limits concurrent requests across separate loops to two', async () => {
    const pending: Array<(response: Response) => void> = []
    let active = 0, maximum = 0
    const view = setup(markup('a') + markup('b') + markup('c'), (() => {
      active++; maximum = Math.max(maximum, active)
      return new Promise<Response>(resolve => pending.push(result => { active--; resolve(result) }))
    }) as typeof fetch)
    view.values('find', { q: 'x' }); await tick(140)
    expect(pending).toHaveLength(2)
    pending.shift()!(response('<b>First</b>')); await tick()
    expect(pending).toHaveLength(2)
    expect(maximum).toBe(2)
    for (const resolve of pending.splice(0)) resolve(response('<b>Done</b>'))
    await tick()
  })

  it('serializes declared collections, updates aggregate counts and both empty conditions', async () => {
    let requested = ''
    const bindings: LoopQueryBinding[] = [{ filterKey: 'rowIds', formId: 'find', fieldName: 'selected', queryParameter: 'ids', valueType: 'stringArray' }]
    const view = setup(markup('a', bindings) + '<output data-instatic-loop-count=\'["a"]\'></output><section data-instatic-loop-empty-group=\'["a"]\' data-instatic-loop-condition="results">Results</section><section data-instatic-loop-empty-group=\'["a"]\' data-instatic-loop-condition="empty">Empty</section>', (async input => { requested = String(input); return response('', 1, 0) }) as typeof fetch)
    view.values('find', { selected: ['id-a', 'id-b'] }); await tick(140)
    const query = new URL(new URL(requested, 'http://localhost').searchParams.get('pagePath')!, 'http://localhost')
    expect(query.searchParams.get('ids')).toBe('["id-a","id-b"]')
    expect(view.window.document.querySelector('output')!.textContent).toBe('0')
    const groups = view.window.document.querySelectorAll<HTMLElement>('[data-instatic-loop-empty-group]')
    expect(groups[0].hidden).toBe(true); expect(groups[1].hidden).toBe(false)
    expect(view.window.document.querySelector('[role=status]')!.textContent).toBe('No matches')
  })

  it('keeps table rows valid and offers a user retry for failed filter replacement', async () => {
    let calls = 0
    const view = setup('<table>' + markup('a', binding, false, 'tbody').replace('<span>Original</span>', '<tr><td>Original</td></tr>') + '</table>', (async () => {
      calls++
      return calls === 1 ? new Response('{}', { status: 503 }) : response('<tr><td>Recovered</td></tr>')
    }) as typeof fetch)
    view.values('find', { q: 'x' }); await tick(140)
    const controls = view.window.document.querySelector('[data-instatic-loop-controls]')!
    expect(controls.parentElement!.tagName).toBe('BODY')
    const button = controls.querySelector('button')!
    expect(button.textContent).toBe('Retry')
    button.click(); await tick()
    expect(view.loop.innerHTML).toBe('<tr><td>Recovered</td></tr>')
    expect(view.loop.getAttribute('data-instatic-loop-page')).toBe('1')
  })

  it('rejects responses without a valid total before modifying the list', async () => {
    const view = setup(markup('a', [], true), (async () => new Response(JSON.stringify({ html: '<b>Bad</b>', pageNumber: 2, hasMore: false }))) as typeof fetch)
    view.window.document.querySelector<HTMLButtonElement>('button')!.click(); await tick()
    expect(view.loop.textContent).toBe('Original')
    expect(view.window.document.querySelector('button')!.textContent).toBe('Retry')
  })

  it('preserves an authored control and its count child through busy/idle updates', async () => {
    let complete: ((response: Response) => void) | undefined
    const button = '<section id="authored-position"><button class="source-button" data-instatic-loop-more="a" data-instatic-loop-load-more-label="More {remaining}" data-instatic-loop-loading-label="Please wait" data-instatic-loop-retry-label="Retry"><span>More entries </span><span data-instatic-loop-count=\'["a"]\' data-instatic-loop-count-metric="progress">1/3</span></button></section>'
    const view = setup(markup('a', [], true).replace('data-instatic-loop-total="1"', 'data-instatic-loop-total="3" data-instatic-loop-loaded="1" data-instatic-loop-page-size="1"') + button, (() => new Promise<Response>(resolve => { complete = resolve })) as typeof fetch)
    const authored = view.window.document.querySelector<HTMLButtonElement>('[data-instatic-loop-more]')!
    const count = authored.querySelector('[data-instatic-loop-count]')!
    authored.click()
    expect(authored.textContent).toBe('Please wait')
    expect(authored.disabled).toBe(true)
    complete!(response('<span>Remaining two</span>', 2, 3, false)); await tick()
    expect(authored.className).toBe('source-button')
    expect(authored.parentElement!.id).toBe('authored-position')
    expect(authored.querySelector('[data-instatic-loop-count]')).toBe(count)
    expect(count.textContent).toBe('3/3')
    expect(authored.hidden).toBe(true)
    expect(view.window.document.querySelectorAll('button')).toHaveLength(1)
  })
})
