import { describe, expect, it } from 'bun:test'
import { publishPage, renderNode } from '@core/publisher'
import { ImageModule } from '@modules/base/image'
import { TextModule } from '@modules/base/text'
import { LoopModule } from '@modules/base/loop'
import { VisualComponentRefModule } from '@modules/base/visualComponentRef'
import { makeAccumulators, makePage, makeRegistry, makeSite } from './helpers'

const registry = makeRegistry({ 'base.image': ImageModule, 'base.text': TextModule, 'base.loop': LoopModule, 'base.visual-component-ref': VisualComponentRefModule })

describe('publisher per-property module-props repair', () => {
  it('uses declared defaults for missing props', () => {
    const page = makePage({ root: { moduleId: 'base.text' } })
    expect(publishPage(page, makeSite({ pages: [page] }), registry).html).toContain('Add your text here.')
  })

  it('repairs an unsupported enum without resetting authored image content', () => {
    const page = makePage({ root: { moduleId: 'base.image', props: { src: '/authored.jpg', loading: 'unsupported' } } })
    const html = publishPage(page, makeSite({ pages: [page] }), registry).html
    expect(html).toContain('src="/authored.jpg"')
    expect(html).toContain('loading="lazy"')
  })

  it('parses real resolved values rather than editorial binding fallbacks', () => {
    const page = makePage({ root: {
      moduleId: 'base.image', props: { src: '/authored.jpg', loading: 'unsupported' },
      dynamicBindings: { loading: { source: 'currentEntry', field: 'loading', fallback: 'static' } },
    } })
    const config = { page, site: makeSite({ pages: [page] }), registry,
      templateContext: { entryStack: [{ id: 'row', fields: { loading: 'eager' } }] },
    }
    expect(renderNode('root', config, makeAccumulators())).toContain('loading="eager"')
    const repaired = renderNode('root', { ...config, templateContext: { entryStack: [{ id: 'row', fields: { loading: 'unsupported' } }] } }, makeAccumulators())
    expect(repaired).toContain('loading="lazy"')
    expect(repaired).toContain('src="/authored.jpg"')
  })

  it.each([
    { moduleId: 'base.loop', props: { pagination: 'unsupported' } },
    { moduleId: 'base.visual-component-ref', props: { componentId: { invalid: true } } },
  ])('repairs props before the special renderer %j', root => {
    const page = makePage({ root })
    expect(() => publishPage(page, makeSite({ pages: [page] }), registry)).not.toThrow()
  })

  it('defers visitor-dependent holes and repairs props on their real request render', () => {
    const page = makePage({ root: { moduleId: 'base.image', props: { src: '/authored.jpg', loading: 'unsupported' } } })
    const config = { page, site: makeSite({ pages: [page] }), registry, dynamicNodeIds: new Set(['root']) }
    expect(renderNode('root', config, makeAccumulators())).toContain('<instatic-hole')
    const html = renderNode('root', { ...config, dynamicNodeIds: undefined }, makeAccumulators())
    expect(html).toContain('src="/authored.jpg"')
    expect(html).toContain('loading="lazy"')
  })
})
