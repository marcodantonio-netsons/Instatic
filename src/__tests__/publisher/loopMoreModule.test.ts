import { describe, expect, it } from 'bun:test'
import { publishPage } from '@core/publisher'
import { registry } from '@core/module-engine'
import { makeNode, makePage, makeSite } from '../fixtures'
import '@modules/base/index'

describe('authored native load more button', () => {
  it('publishes resolved count placeholders, normal children and native runtime wiring', () => {
    const page = makePage({ nodes: {
      root: makeNode({ id: 'root', moduleId: 'base.body', children: ['loop', 'more'] }),
      loop: makeNode({ id: 'loop', moduleId: 'base.loop', props: { pagination: 'infinite' }, children: ['row'] }),
      row: makeNode({ id: 'row', moduleId: 'base.text', props: { text: '{currentEntry.title}' } }),
      more: makeNode({ id: 'more', moduleId: 'base.loop-more', props: { loopId: 'loop', label: 'More {remaining}', loadingLabel: 'Wait', retryLabel: 'Retry' } }),
    } })
    const site = makeSite({ pages: [page] })
    const data = { items: [{ id: 'a', fields: { title: 'A' } }, { id: 'b', fields: { title: 'B' } }], totalItems: 5, pageNumber: 1, hasMore: true }
    const html = publishPage(page, site, registry, { loopData: new Map([['loop', data]]) }).html
    document.body.innerHTML = html
    const button = document.querySelector<HTMLButtonElement>('[data-instatic-loop-more="loop"]')!
    expect(button.textContent).toBe('More 3')
    expect(button.type).toBe('button')
    expect(button.hidden).toBe(false)
    expect(button.getAttribute('data-instatic-loop-load-more-label')).toBe('More {remaining}')
    expect(button.getAttribute('data-instatic-loop-loading-label')).toBe('Wait')
    page.nodes.more.children = ['count']
    page.nodes.count = makeNode({ id: 'count', moduleId: 'base.loop-count', props: { loopIds: 'loop', metric: 'progress' } })
    const withChildren = publishPage(page, site, registry, { loopData: new Map([['loop', { ...data, hasMore: false }]]) }).html
    document.body.innerHTML = withChildren
    const authored = document.querySelector<HTMLButtonElement>('[data-instatic-loop-more="loop"]')!
    expect(authored.hidden).toBe(true)
    expect(authored.querySelector('[data-instatic-loop-count]')!.textContent).toBe('2/5')
    expect(authored.querySelector('[data-instatic-loop-count]')!.tagName).toBe('SPAN')
    document.body.innerHTML = ''
  })
})
