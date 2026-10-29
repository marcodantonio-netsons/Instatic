import { describe, expect, it } from 'bun:test'
import { loopFormOptions } from '@site/panels/PropertiesPanel/loopQueryModel'
import { makeNode, makePage, makeSite, makeVC, makeVCNode, makeVCTree } from '../fixtures'

describe('native loop form binding choices', () => {
  it('uses materialized component parameters, native controls and calculated values', () => {
    const component = makeVC({ id: 'find-component', name: 'Search',
      params: [{ id: 'form-id', name: 'formId', type: 'string', defaultValue: 'default-find', required: false }],
      tree: makeVCTree('form', [
        makeVCNode({ id: 'form', moduleId: 'base.form', props: { formId: 'default-find', calculations: { selected: { literal: ['row-1'] } } }, propBindings: { formId: { paramId: 'form-id' } }, children: ['query', 'choice'] }),
        makeVCNode({ id: 'query', moduleId: 'base.input', props: { name: 'q' } }),
        makeVCNode({ id: 'choice', moduleId: 'base.checkbox', props: { name: 'category' } }),
      ]) })
    const page = makePage({ nodes: {
      root: makeNode({ id: 'root', moduleId: 'base.body', children: ['ref'] }),
      ref: makeNode({ id: 'ref', moduleId: 'base.visual-component-ref', props: { componentId: component.id, propOverrides: { 'form-id': 'catalog-find' } } }),
    } })
    const site = makeSite({ pages: [page], visualComponents: [component] })
    expect(loopFormOptions(page, site)).toEqual([{ id: 'catalog-find', fields: ['selected', 'q', 'category'] }])
  })

  it('follows the renderer form default and stable page tokens', () => {
    const page = makePage({ slug: 'catalog', nodes: {
      root: makeNode({ id: 'root', moduleId: 'base.body', children: ['default', 'bound'] }),
      default: makeNode({ id: 'default', moduleId: 'base.form', children: ['default-input'] }),
      'default-input': makeNode({ id: 'default-input', moduleId: 'base.input', props: { name: 'q' } }),
      bound: makeNode({ id: 'bound', moduleId: 'base.form', props: { formId: '{page.slug}' }, children: ['bound-input'] }),
      'bound-input': makeNode({ id: 'bound-input', moduleId: 'base.input', props: { name: 'category' } }),
    } })
    expect(loopFormOptions(page, makeSite({ pages: [page] }))).toEqual([{ id: 'form', fields: ['q'] }, { id: 'catalog', fields: ['category'] }])
  })
})
