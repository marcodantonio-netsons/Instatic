import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import '@modules/base'
import { registry } from '@core/module-engine'
import { assertScrollStateForest, publishPage, ScrollStateConfigurationError } from '@core/publisher'
import { parseValue } from '@core/utils/typeboxHelpers'
import { VisualComponentSchema } from '@core/visualComponents'
import { ScrollStateModule, ScrollStateEditor, installScrollStateBehavior, SCROLL_STATE_RUNTIME_JS } from '@modules/base/scrollState'
import { makePage, makeSite } from '../publisher/helpers'

const releases: Array<() => void> = []
afterEach(() => {
  cleanup(); releases.splice(0).forEach(release => release())
  document.body.replaceChildren(); document.documentElement.removeAttribute('data-instatic-motion')
})
const settle = () => new Promise(resolve => window.setTimeout(resolve, 30))
function target(id = 'hero', bottom = 800, height = 800) {
  const element = document.createElement('section')
  element.id = id
  const box = { bottom, height }
  Object.defineProperty(element, 'getBoundingClientRect', { value: () => ({ top: box.bottom - box.height, bottom: box.bottom, height: box.height, left: 0, right: 100, width: 100 }) })
  document.body.append(element)
  return { element, box }
}
function controller(overrides: Partial<typeof ScrollStateModule.defaults> = {}) {
  const holder = document.createElement('div')
  holder.innerHTML = ScrollStateModule.render({ ...ScrollStateModule.defaults, targetId: 'hero', ...overrides }, ['<nav>Navigation</nav>']).html
  const element = holder.firstElementChild!
  document.body.append(element)
  return element
}

describe('native Scroll state', () => {
  it('switches at the exact end threshold, reverses on scroll, and supports an authored start/offset', async () => {
    const { box } = target(), element = controller()
    releases.push(installScrollStateBehavior(document))
    expect(element.getAttribute('data-instatic-scroll-state')).toBe('before')
    box.bottom = 0; window.dispatchEvent(new Event('scroll')); await settle()
    expect(element.getAttribute('data-instatic-scroll-state')).toBe('after')
    box.bottom = 1; window.dispatchEvent(new Event('scroll')); await settle()
    expect(element.getAttribute('data-instatic-scroll-state')).toBe('before')
    element.setAttribute('data-instatic-scroll-offset', '20'); box.bottom = 20
    window.dispatchEvent(new Event('resize')); await settle()
    expect(element.getAttribute('data-instatic-scroll-state')).toBe('after')
    element.setAttribute('data-instatic-scroll-edge', 'start'); box.bottom = 821
    window.dispatchEvent(new Event('resize')); await settle(); expect(element.getAttribute('data-instatic-scroll-state')).toBe('before')
    box.bottom = 820; window.dispatchEvent(new Event('scroll')); await settle()
    expect(element.getAttribute('data-instatic-scroll-state')).toBe('after')
    expect(element.getAttribute('style')).toBeNull()
  })

  it('resolves late fragment targets, rejects runtime ambiguity, and observes target resizing', async () => {
    const observe = spyOn(window.ResizeObserver.prototype, 'observe')
    const element = controller()
    releases.push(installScrollStateBehavior(document))
    expect(element.getAttribute('data-instatic-scroll-state')).toBe('unresolved')
    const first = target('hero', -1)
    document.dispatchEvent(new Event('instatic:content')); await settle()
    expect(element.getAttribute('data-instatic-scroll-state')).toBe('after')
    expect(observe.mock.calls.some(([observed]) => observed === first.element)).toBe(true)
    const duplicate = target('hero', 50); await settle()
    expect(element.getAttribute('data-instatic-scroll-state')).toBe('unresolved')
    duplicate.element.remove(); first.box.bottom = 1; window.dispatchEvent(new Event('resize')); await settle()
    expect(element.getAttribute('data-instatic-scroll-state')).toBe('before')
    first.element.remove(); await settle()
    expect(element.getAttribute('data-instatic-scroll-state')).toBe('unresolved')
    observe.mockRestore()
  })

  it('shares document leases, honors native reduced motion, and restores attributes on final cleanup', async () => {
    const { box } = target('hero', -10), element = controller()
    const first = installScrollStateBehavior(document), last = installScrollStateBehavior(document)
    expect(element.getAttribute('data-instatic-scroll-state')).toBe('after')
    document.documentElement.setAttribute('data-instatic-motion', 'reduced'); await settle()
    expect(element.getAttribute('data-instatic-scroll-motion')).toBe('reduced')
    first(); first(); box.bottom = 100; window.dispatchEvent(new Event('scroll')); await settle()
    expect(element.getAttribute('data-instatic-scroll-state')).toBe('before')
    box.bottom = -10; window.dispatchEvent(new Event('scroll')); await settle()
    expect(element.getAttribute('data-instatic-scroll-state')).toBe('after')
    last(); expect(element.getAttribute('data-instatic-scroll-state')).toBe('before')
    expect(element.hasAttribute('data-instatic-scroll-motion')).toBe(false)
    window.dispatchEvent(new Event('scroll')); await settle()
    expect(element.getAttribute('data-instatic-scroll-state')).toBe('before')
  })

  it('uses the same runtime on the semantic canvas element and in the self-contained published asset', () => {
    target('hero', -1)
    const props = { ...ScrollStateModule.defaults, tag: 'header', targetId: 'hero', htmlAttributes: { 'aria-label': 'Navigation', 'data-instatic-scroll-state': 'after' } }
    const result = render(<ScrollStateEditor props={props} nodeId="navigation" isSelected={false} mcClassName="authoredHeader" nodeWrapperProps={{ 'data-node-id': 'navigation' }}><nav>Navigation</nav></ScrollStateEditor>)
    const element = result.getByLabelText('Navigation')
    expect(element.tagName).toBe('HEADER'); expect(element.className).toBe('authoredHeader')
    expect(element.getAttribute('data-node-id')).toBe('navigation')
    expect(element.getAttribute('data-instatic-scroll-state')).toBe('after')
    cleanup()
    const publicElement = controller({ tag: 'header' })
    const release: unknown = new Function('document', 'return ' + SCROLL_STATE_RUNTIME_JS)(document)
    expect(typeof release).toBe('function')
    if (typeof release !== 'function') throw new Error('Published installer must return cleanup')
    releases.push(() => release())
    expect(publicElement.getAttribute('data-instatic-scroll-state')).toBe('after')
    expect(publicElement.textContent).toBe('Navigation')
    expect(SCROLL_STATE_RUNTIME_JS.toLowerCase()).not.toContain('netsons')
  })

  it('validates composed targets without rewriting a shared component or affecting ordinary pages', () => {
    const definition = makePage({ root: { moduleId: 'base.container', children: ['nav'] }, nav: { moduleId: 'base.container', children: ['link'] }, link: { moduleId: 'base.link', props: { href: '/', text: 'Home' } } })
    const component = parseValue(VisualComponentSchema, { id: 'navigation', name: 'Navigation', tree: { nodes: definition.nodes, rootNodeId: definition.rootNodeId }, params: [], classIds: [], createdAt: 0 })
    const page = makePage({ root: { moduleId: 'base.body', children: ['state', 'hero'] }, state: { moduleId: 'base.scroll-state', props: { targetId: 'hero' }, children: ['ref'] }, ref: { moduleId: 'base.visual-component-ref', props: { componentId: component.id, propOverrides: {} } }, hero: { moduleId: 'base.container', props: { htmlAttributes: { id: 'hero' } } } })
    const site = makeSite({ pages: [page], visualComponents: [component] }), before = JSON.stringify(component)
    const published = publishPage(page, site, registry)
    expect(published.jsModuleIds).toEqual(['base.scroll-state'])
    expect(published.html).toContain('data-instatic-scroll-state="before"')
    expect(published.html).toContain('data-instatic-scroll-target="hero"')
    expect(published.html).toContain('>Home</a>'); expect(JSON.stringify(component)).toBe(before)
    page.nodes.state.props.targetId = 'absent'
    expect(() => publishPage(page, site, registry)).toThrow(ScrollStateConfigurationError)
    page.nodes.state.props.targetId = 'hero'; page.nodes.ref.props.htmlAttributes = { id: 'hero' }
    expect(() => publishPage(page, site, registry)).not.toThrow()
    page.nodes.nav = { ...page.nodes.hero, id: 'duplicate' }; page.nodes.root.children.push('nav')
    expect(() => assertScrollStateForest({ nodes: page.nodes, rootNodeIds: [page.rootNodeId] })).toThrow('one other rendered element')
  })
})
