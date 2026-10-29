import { expect, it } from 'bun:test'
import '@modules/base'
import { resolveDynamicProps, buildTemplateRenderContext } from '@core/templates'
import { findDynamicNodeIds } from '@core/publisher'
import { registry } from '@core/module-engine'
import { makeNode, makePage, makeSite } from '../fixtures'
it('resolves nested expression copy in nine native language frames and retains unchanged branches', () => {
  for (const language of ['it','en','de','fr','es','pt','nl','pl','ro']) {
    const page = makePage({ language })
    const site = makeSite({ pages: [page], files: [{ id: 'catalogue', path: 'locale.json', type: 'config', content: JSON.stringify({ language, messages: { quote: language + ' & copy' } }), createdAt: 0, updatedAt: 0 }], settings: { shortcuts: {}, localization: { catalogues: [{ language, fileId: 'catalogue' }] } } })
    const untouched = { literal: 'unchanged' }, props = { calculations: { subject: { op: 'concat', values: [{ literal: '{site.translations.quote}' }, untouched] } } }
    const result = resolveDynamicProps(props, undefined, buildTemplateRenderContext(page, site, undefined))
    expect(result.calculations).toEqual({ subject: { op: 'concat', values: [{ literal: language + ' & copy' }, untouched] } })
    expect((result.calculations as typeof props.calculations).subject.values[1]).toBe(untouched)
  }
})
it('classifies request tokens inside structured expression arrays with the same traversal as interpolation', () => {
  const root = makeNode({ id: 'root', moduleId: 'base.body', children: ['form'] })
  const form = makeNode({ id: 'form', moduleId: 'base.form', props: { calculations: { label: { op: 'concat', values: [{ literal: '{route.query.subject}' }] } } } })
  const page = makePage({ nodes: { root, form } }), site = makeSite({ pages: [page] })
  expect(findDynamicNodeIds(page, site, registry).has('form')).toBe(true)
})
