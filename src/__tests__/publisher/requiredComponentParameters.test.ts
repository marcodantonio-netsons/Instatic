import { describe, expect, it } from 'bun:test'
import { assertSiteComponentParameters, publishPage } from '@core/publisher'
import { registry } from '@core/module-engine'
import { Type } from '@core/utils/typeboxHelpers'
import { VisualComponentParameterError } from '@core/visualComponents'
import { makeNode, makePage, makeSite, makeVC, makeVCNode, makeVCTree } from '../fixtures'
import { makeModule } from './helpers'
import '@modules/base'

function linkFixture(value: unknown = '/default') {
  const vc = makeVC({ id: 'link-card', name: 'Link Card', params: [{
    id: 'url', name: 'URL', type: 'url', required: true, defaultValue: value,
  }], tree: makeVCTree('card-body', [
    makeVCNode({ id: 'card-body', moduleId: 'base.body', children: ['link'] }),
    makeVCNode({ id: 'link', moduleId: 'base.link', props: { href: '', text: 'Go' }, propBindings: { href: { paramId: 'url' } } }),
  ]) })
  const page = makePage({ nodes: {
    root: makeNode({ id: 'root', moduleId: 'base.body', children: ['ref'] }),
    ref: makeNode({ id: 'ref', moduleId: 'base.visual-component-ref', props: { componentId: vc.id, propOverrides: {} } }),
  } })
  return { vc, page, site: makeSite({ pages: [page], visualComponents: [vc] }) }
}

describe('required arguments in the native publisher', () => {
  it('preserves zero and false from a structured native argument bag through module parsing', () => {
    const moduleId = 'test.required-native-values'
    registry.register(makeModule(moduleId, {
      propsSchema: Type.Object({ quantity: Type.Number(), enabled: Type.Boolean() }),
      defaults: { quantity: 0, enabled: false },
      schema: { quantity: { type: 'number', label: 'Quantity' }, enabled: { type: 'toggle', label: 'Enabled' } },
      render: (props) => ({ html: `<span>${props.quantity}:${props.enabled}</span>` }),
    }))
    try {
      const { vc, page, site } = linkFixture()
      vc.params = [
        { id: 'quantity', name: 'Quantity', type: 'number', required: true, defaultValue: null },
        { id: 'enabled', name: 'Enabled', type: 'boolean', required: true, defaultValue: null },
      ]
      vc.tree.nodes.link = makeVCNode({ id: 'link', moduleId, propBindings: { quantity: { paramId: 'quantity' }, enabled: { paramId: 'enabled' } } })
      page.nodes.ref.dynamicBindings = { propOverrides: { source: 'currentEntry', field: 'arguments' } }
      const html = publishPage(page, site, registry, {
        templateContext: { entryStack: [{ id: 'row', fields: { arguments: { quantity: 0, enabled: false } } }] },
      }).html
      expect(html).toContain('<span>0:false</span>')
    } finally { registry.unregister(moduleId) }
  })

  it('renders a valid default and rejects an explicit empty URL before emitting a link', () => {
    const { page, site } = linkFixture()
    expect(publishPage(page, site, registry).html).toContain('href="/default"')
    page.nodes.ref.props.propOverrides = { url: '' }
    expect(() => publishPage(page, site, registry)).toThrow(VisualComponentParameterError)
    expect(() => assertSiteComponentParameters(site)).toThrow('nodes.ref.props.propOverrides.url')
  })

  it('uses the actual page frame and interpolates escaped argument tokens once', () => {
    const { page, site } = linkFixture('{page.permalink}')
    page.slug = 'real-page'
    expect(() => assertSiteComponentParameters(site)).not.toThrow()
    expect(publishPage(page, site, registry).html).toContain('href="/real-page"')
    page.nodes.ref.props.propOverrides = { url: '\\{page.permalink}' }
    expect(publishPage(page, site, registry).html).toContain('href="{page.permalink}"')
  })

  it('does not interpolate a field result a second time while checking the parameter', () => {
    const { page, site } = linkFixture('{currentEntry.url}')
    const html = publishPage(page, site, registry, {
      templateContext: { entryStack: [{ id: 'row', fields: { url: '{site.name}' } }] },
    }).html
    expect(html).toContain('href="{site.name}"')
    expect(html).not.toContain('href="Test SiteDocument"')
  })

  it('resolves a structured argument bag from each actual loop row, including zero rows', () => {
    const { page, site } = linkFixture('')
    page.nodes.root.children = ['loop']
    page.nodes.loop = makeNode({ id: 'loop', moduleId: 'base.loop', children: ['ref'] })
    page.nodes.ref.dynamicBindings = { propOverrides: { source: 'currentEntry', field: 'arguments' } }
    expect(() => assertSiteComponentParameters(site)).not.toThrow()
    const data = (items: { id: string; fields: Record<string, unknown> }[]) => new Map([['loop', {
      items, totalItems: items.length, pageNumber: 1, hasMore: false,
    }]])
    const html = publishPage(page, site, registry, { loopData: data([
      { id: 'a', fields: { arguments: { url: '/a' } } },
      { id: 'b', fields: { arguments: { url: '/b?q=1#target' } } },
    ]) }).html
    expect(html).toContain('href="/a"')
    expect(html).toContain('href="/b?q=1#target"')
    expect(() => publishPage(page, site, registry, { loopData: data([]) })).not.toThrow()
    expect(() => publishPage(page, site, registry, { loopData: data([{ id: 'empty', fields: { arguments: { url: '' } } }]) })).toThrow(VisualComponentParameterError)
  })

  it('keeps required arguments and parent/current entry frames through a filled native slot', () => {
    const { page, site } = linkFixture('{currentEntry.url}#{parentEntry.slug}')
    const wrapper = makeVC({ id: 'wrapper', name: 'Wrapper', params: [{
      id: 'children', name: 'children', type: 'slot', required: true, defaultValue: [],
    }], tree: makeVCTree('wrapper-body', [
      makeVCNode({ id: 'wrapper-body', moduleId: 'base.body', children: ['slot'] }),
      makeVCNode({ id: 'slot', moduleId: 'base.slot-outlet', props: { slotName: 'children' } }),
    ]) })
    site.visualComponents.push(wrapper)
    page.nodes.root.children = ['loop']
    page.nodes.loop = makeNode({ id: 'loop', moduleId: 'base.loop', children: ['wrapper-ref'] })
    page.nodes['wrapper-ref'] = makeNode({ id: 'wrapper-ref', moduleId: 'base.visual-component-ref', props: { componentId: wrapper.id }, children: ['fill'] })
    page.nodes.fill = makeNode({ id: 'fill', moduleId: 'base.slot-instance', props: { slotName: 'children' }, children: ['ref'] })
    const html = publishPage(page, site, registry, {
      templateContext: { entryStack: [{ id: 'parent', fields: { slug: 'parent-slug' } }] },
      loopData: new Map([['loop', { items: [{ id: 'child', fields: { url: '/child' } }], totalItems: 1, pageNumber: 1, hasMore: false }]]),
    }).html
    expect(html).toContain('href="/child#parent-slug"')
    page.nodes.fill.children = []
    expect(() => publishPage(page, site, registry, {
      loopData: new Map([['loop', { items: [{ id: 'child', fields: { url: '/child' } }], totalItems: 1, pageNumber: 1, hasMore: false }]]),
    })).toThrow('parameter "children" is required')
  })
})

describe('canonical required-parameter preflight', () => {
  it('rejects a literal failure even on a request-dependent reference before a hole can hide it', () => {
    const { vc, page, site } = linkFixture('')
    vc.tree.nodes['card-body'].children.push('request-label')
    vc.tree.nodes['request-label'] = makeVCNode({ id: 'request-label', moduleId: 'base.text', props: { text: '{route.query.label}' } })
    expect(publishPage(page, site, registry).html).toContain('instatic-hole')
    expect(() => assertSiteComponentParameters(site)).toThrow(VisualComponentParameterError)
  })

  it('does not manufacture an entry or request frame to validate dynamic values', () => {
    const { page, site } = linkFixture('{page.permalink}')
    page.template = { enabled: true, target: { kind: 'postTypes', tableSlugs: ['posts'] }, priority: 10 }
    expect(() => assertSiteComponentParameters(site)).not.toThrow()
    page.template = undefined
    site.visualComponents[0].params[0].defaultValue = ''
    page.nodes.ref.dynamicBindings = { propOverrides: { source: 'route', field: 'query' } }
    expect(() => assertSiteComponentParameters(site)).not.toThrow()
    expect(() => publishPage(page, site, registry, { dynamicNodes: 'inline', templateContext: { entryStack: [], route: { path: '/', slug: null, segments: [], query: { url: '/real-target' } } } })).not.toThrow()
    expect(() => publishPage(page, site, registry, { dynamicNodes: 'inline' })).toThrow('is required and has no value')
  })

  it('checks nested references using the inherited bag selected by the same walker', () => {
    const { page, site } = linkFixture('')
    const wrapper = makeVC({ id: 'wrapper', name: 'Wrapper', params: [{
      id: 'arguments', name: 'Arguments', type: 'string', required: false, defaultValue: { url: '{page.permalink}' },
    }], tree: makeVCTree('wrapper-body', [
      makeVCNode({ id: 'wrapper-body', moduleId: 'base.body', children: ['nested-ref'] }),
      makeVCNode({ id: 'nested-ref', moduleId: 'base.visual-component-ref', props: { componentId: 'link-card', propOverrides: {} }, propBindings: { propOverrides: { paramId: 'arguments' } } }),
    ]) })
    site.visualComponents.push(wrapper)
    page.nodes.ref.props.componentId = wrapper.id
    expect(() => assertSiteComponentParameters(site)).not.toThrow()
    page.nodes.ref.props.propOverrides = { arguments: { url: '' } }
    expect(() => assertSiteComponentParameters(site)).toThrow('nodes.ref:nested-ref.props.propOverrides.url')
  })

  it('does not defer a concrete nested failure just because an unrelated parent token is unresolved', () => {
    const { page, site } = linkFixture('')
    const wrapper = makeVC({ id: 'wrapper', name: 'Wrapper', params: [{
      id: 'title', name: 'Title', type: 'string', required: true, defaultValue: '{currentEntry.title}',
    }], tree: makeVCTree('wrapper-body', [
      makeVCNode({ id: 'wrapper-body', moduleId: 'base.body', children: ['nested-ref'] }),
      makeVCNode({ id: 'nested-ref', moduleId: 'base.visual-component-ref', props: { componentId: 'link-card' } }),
    ]) })
    site.visualComponents.push(wrapper)
    page.nodes.ref.props.componentId = wrapper.id
    expect(() => assertSiteComponentParameters(site)).toThrow('nodes.ref:nested-ref.props.propOverrides.url')
  })

  it('defers only children actually bound to an unavailable parent argument bag', () => {
    const { page, site } = linkFixture('')
    const wrapper = makeVC({ id: 'wrapper', name: 'Wrapper', params: [{
      id: 'arguments', name: 'Arguments', type: 'string', required: false, defaultValue: { url: '' },
    }], tree: makeVCTree('wrapper-body', [
      makeVCNode({ id: 'wrapper-body', moduleId: 'base.body', children: ['nested-ref'] }),
      makeVCNode({ id: 'nested-ref', moduleId: 'base.visual-component-ref', props: { componentId: 'link-card' }, propBindings: { propOverrides: { paramId: 'arguments' } } }),
    ]) })
    site.visualComponents.push(wrapper)
    page.nodes.ref.props.componentId = wrapper.id
    page.nodes.ref.dynamicBindings = { propOverrides: { source: 'currentEntry', field: 'wrapperArguments' } }
    expect(() => assertSiteComponentParameters(site)).not.toThrow()
    wrapper.tree.nodes['wrapper-body'].children.push('independent-ref')
    wrapper.tree.nodes['independent-ref'] = makeVCNode({ id: 'independent-ref', moduleId: 'base.visual-component-ref', props: { componentId: 'link-card' } })
    expect(() => assertSiteComponentParameters(site)).toThrow('nodes.ref:independent-ref.props.propOverrides.url')
  })

  it('ignores unused definitions, unused templates, hidden references and orphan nodes', () => {
    const { page, site } = linkFixture('/valid')
    const invalid = linkFixture('').vc
    invalid.id = 'unused'
    site.visualComponents.push(invalid)
    const badRef = makeNode({ id: 'bad-ref', moduleId: 'base.visual-component-ref', props: { componentId: invalid.id } })
    page.nodes.orphan = { ...badRef, id: 'orphan' }
    page.nodes.hidden = { ...badRef, id: 'hidden', hidden: true }
    page.nodes.root.children.push('hidden')
    site.pages.push(makePage({ id: 'unused-not-found', template: { enabled: true, priority: 1, target: { kind: 'notFound' } }, nodes: { root: makeNode({ id: 'root', moduleId: 'base.body', children: ['bad-ref'] }), 'bad-ref': badRef } }))
    site.pages.push(makePage({ id: 'active-not-found', template: { enabled: true, priority: 10, target: { kind: 'notFound' } } }))
    const before = structuredClone(site)
    expect(() => assertSiteComponentParameters(site)).not.toThrow()
    expect(site).toEqual(before)
    page.nodes.hidden.hidden = false
    expect(() => assertSiteComponentParameters(site)).toThrow(VisualComponentParameterError)
  })
})
