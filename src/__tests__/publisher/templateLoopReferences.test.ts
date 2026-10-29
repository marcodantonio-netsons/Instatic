import { describe, expect, it } from 'bun:test'
import '@modules/base'
import { registry } from '@core/module-engine'
import { assertSiteLoopScopes, collectLoopRenderScopes, publishPage } from '@core/publisher'
import { buildTemplateRenderContext, composeTemplateChain } from '@core/templates'
import type { Page } from '@core/page-tree'
import { makeNode, makePage, makeSite } from '../fixtures'

function loopPage(id: string): Page {
  return makePage({ id, slug: id, nodes: {
    root: makeNode({ id: 'root', moduleId: 'base.body', children: ['loop', 'more', 'count', 'results'] }),
    loop: makeNode({ id: 'loop', moduleId: 'base.loop', props: { pagination: 'infinite' }, children: ['row'] }),
    row: makeNode({ id: 'row', moduleId: 'base.text', props: { text: '{currentEntry.title}' } }),
    more: makeNode({ id: 'more', moduleId: 'base.loop-more', props: { loopId: 'loop', label: 'More {remaining}' } }),
    count: makeNode({ id: 'count', moduleId: 'base.loop-count', props: { loopIds: 'loop', metric: 'progress' } }),
    results: makeNode({ id: 'results', moduleId: 'base.loop-conditional', props: { loopIds: 'loop', when: 'results' }, children: ['caption'] }),
    caption: makeNode({ id: 'caption', moduleId: 'base.text', props: { text: 'Matching entries' } }),
  } })
}
function template(id: string, priority: number, withLoop = false): Page {
  const page = withLoop ? loopPage(id) : makePage({ id, slug: id })
  page.template = { enabled: true, target: { kind: 'everywhere' }, priority }
  page.nodes.outlet = makeNode({ id: 'outlet', moduleId: 'base.outlet' })
  page.nodes.root.children.push('outlet')
  return page
}

describe('template-composed native loop references', () => {
  it('publishes the composed loop, authored pager, count and results against one remapped target', () => {
    const sourcePage = loopPage('catalog'), layout = template('layout', 0), site = makeSite({ pages: [sourcePage, layout] })
    const before = structuredClone(site), page = composeTemplateChain([layout], { kind: 'page', page: sourcePage })
    expect(() => assertSiteLoopScopes(site)).not.toThrow()
    expect(page.nodes.c0_more.props.loopId).toBe('c0_loop')
    expect(page.nodes.c0_count.props.loopIds).toBe('c0_loop')
    expect(page.nodes.c0_results.props.loopIds).toBe('c0_loop')
    const data = { items: [{ id: 'a', fields: { title: 'A' } }, { id: 'b', fields: { title: 'B' } }], totalItems: 5, pageNumber: 1, hasMore: true }
    const html = publishPage(page, site, registry, { templateContext: buildTemplateRenderContext(sourcePage, site, undefined), loopData: new Map([['c0_loop', data]]), dynamicNodes: 'inline' }).html
    const view = document.createElement('div'); view.innerHTML = html
    expect(view.querySelector('[data-instatic-loop="c0_loop"]')!.textContent).toBe('AB')
    expect(view.querySelector('[data-instatic-loop-more="c0_loop"]')!.textContent).toBe('More 3')
    expect(view.querySelector('[data-instatic-loop-count]')!.getAttribute('data-instatic-loop-count')).toBe('["c0_loop"]')
    expect(view.querySelector('[data-instatic-loop-count]')!.textContent).toBe('2/5')
    const results = view.querySelector('[data-instatic-loop-empty-group]')!
    expect(results.getAttribute('data-instatic-loop-empty-group')).toBe('["c0_loop"]')
    expect(results.hasAttribute('hidden')).toBe(false)
    expect(site).toEqual(before)
  })

  it('keeps colliding loop/control IDs local across two nested templates and a terminal page', () => {
    const sourcePage = loopPage('catalog'), outer = template('outer', 0, true), inner = template('inner', 1, true)
    const site = makeSite({ pages: [sourcePage, outer, inner] }), before = structuredClone(site)
    const page = composeTemplateChain([outer, inner], { kind: 'page', page: sourcePage })
    expect(() => assertSiteLoopScopes(site)).not.toThrow()
    const ids = collectLoopRenderScopes(page, site).map(scope => scope.node.id)
    expect(ids).toEqual(['loop', 't0_loop', 't0_c0_loop'])
    for (const prefix of ['', 't0_', 't0_c0_']) {
      expect(page.nodes[prefix + 'more'].props.loopId).toBe(prefix + 'loop')
      expect(page.nodes[prefix + 'count'].props.loopIds).toBe(prefix + 'loop')
      expect(page.nodes[prefix + 'results'].props.loopIds).toBe(prefix + 'loop')
    }
    const loopData = new Map(ids.map((id, index) => [id, { items: [{ id: 'item', fields: { title: 'Entry ' + index } }], totalItems: 4 + index, pageNumber: 1, hasMore: true }]))
    const html = publishPage(page, site, registry, { templateContext: buildTemplateRenderContext(sourcePage, site, undefined), loopData, dynamicNodes: 'inline' }).html
    const view = document.createElement('div'); view.innerHTML = html
    expect([...view.querySelectorAll('[data-instatic-loop-count]')].map(element => element.textContent)).toEqual(['1/4', '1/5', '1/6'])
    expect([...view.querySelectorAll('[data-instatic-loop-more]')].map(element => element.getAttribute('data-instatic-loop-more'))).toEqual(ids)
    expect(site).toEqual(before)
  })

  it('preserves unknown external targets so preflight still rejects genuinely missing loops', () => {
    const sourcePage = loopPage('catalog'), layout = template('layout', 0)
    sourcePage.nodes.count.props.loopIds = 'loop missing-loop'
    sourcePage.nodes.more.props.loopId = 'missing-loop'
    const site = makeSite({ pages: [sourcePage, layout] }), before = structuredClone(sourcePage)
    const page = composeTemplateChain([layout], { kind: 'page', page: sourcePage })
    expect(page.nodes.c0_count.props.loopIds).toBe('c0_loop missing-loop')
    expect(page.nodes.c0_more.props.loopId).toBe('missing-loop')
    expect(() => assertSiteLoopScopes(site)).toThrow('Loop summaries require existing rendered loops')
    expect(sourcePage).toEqual(before)
  })
})
