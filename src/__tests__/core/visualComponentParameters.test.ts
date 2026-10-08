import { describe, expect, it } from 'bun:test'
import {
  assertVCRequiredParameters, inspectVCRequiredParameters, instantiateVCAtRef,
  parseVisualComponent, VisualComponentParameterError,
  type VCParam,
} from '@core/visualComponents'
import type { TemplateRenderDataContext } from '@core/templates'
import { makeNode, makeVC, makeVCNode, makeVCTree } from '../fixtures'

function component(param: Partial<VCParam> = {}) {
  return makeVC({ id: 'card', name: 'Card', params: [{
    id: 'value', name: 'Value', type: 'string', required: true, defaultValue: 'Default', ...param,
  }], tree: makeVCTree('body', [
    makeVCNode({ id: 'body', moduleId: 'base.body', children: ['text'] }),
    makeVCNode({ id: 'text', moduleId: 'base.text', props: { text: '' }, propBindings: { text: { paramId: 'value' } } }),
  ]) })
}

function inspect(param: Partial<VCParam>, overrides: Record<string, unknown> = {}, context?: TemplateRenderDataContext) {
  const vc = component(param)
  const instance = instantiateVCAtRef(vc, overrides, {}, {}, 'ref')
  return inspectVCRequiredParameters(vc, instance, 'ref', context)
}

describe('required visual component arguments', () => {
  it('keeps incomplete definitions and draft materialization valid', () => {
    const vc = component({ defaultValue: '' })
    expect(parseVisualComponent(vc)).not.toBeNull()
    expect(instantiateVCAtRef(vc, {}, {}, {}, 'ref').nodes.text.props.text).toBe('')
    expect(() => assertVCRequiredParameters(vc, instantiateVCAtRef(vc, {}, {}, {}, 'ref'), 'ref', undefined)).toThrow(VisualComponentParameterError)
  })

  it('uses the declared default only when there is no own override', () => {
    expect(inspect({})).toEqual([])
    for (const value of [undefined, null, '', ' \t\n']) {
      const issues = inspect({}, { value })
      expect(issues[0]?.reason).toBe('missing')
      expect(issues[0]?.path).toBe('nodes.ref.props.propOverrides.value')
    }
    expect(inspect({}, Object.create({ value: '' }))).toEqual([])
  })

  it.each([
    ['number', 0], ['number', 2.5], ['boolean', false], ['boolean', true],
    ['string', 'Text'], ['color', 'var(--accent)'], ['richText', '<p>Body</p>'],
    ['url', '/contact?q=1#form'], ['url', '#content'], ['url', 'tel:+390123456'],
    ['image', '/uploads/media/image.webp'],
  ] as const)('accepts a native %s value %s', (type, value) => {
    expect(inspect({ type, defaultValue: value })).toEqual([])
    expect(inspect({ type }, { value })).toEqual([])
  })

  it.each([
    ['number', '0'], ['number', NaN], ['number', Infinity], ['boolean', 'false'],
    ['string', 0], ['string', false], ['url', 'javascript:alert(1)'],
    ['image', 'data:image/svg+xml,<svg/>'], ['richText', {}],
  ] as const)('rejects an invalid native %s value', (type, value) => {
    expect(inspect({ type }, { value })[0]?.reason).toBe('invalid')
  })

  it('requires an enum member and leaves optional argument behavior unchanged', () => {
    expect(inspect({ type: 'enum', enumOptions: ['small', 'large'] }, { value: 'small' })).toEqual([])
    expect(inspect({ type: 'enum', enumOptions: ['small', 'large'] }, { value: 'other' })[0]?.reason).toBe('invalid')
    expect(inspect({ type: 'enum', defaultValue: 'small' })[0]?.reason).toBe('invalid')
    expect(inspect({ required: false }, { value: null })).toEqual([])
  })

  it('distinguishes an unavailable frame from an available frame with an empty field', () => {
    expect(inspect({}, { value: '{currentEntry.title}' })[0]?.reason).toBe('unresolved')
    expect(inspect({}, { value: '{currentEntry.title}' }, { entryStack: [] })[0]?.reason).toBe('unresolved')
    expect(inspect({}, { value: '{currentEntry.title}' }, { entryStack: [{ id: 'row', fields: { title: '' } }] })[0]?.reason).toBe('missing')
    expect(inspect({}, { value: '{currentEntry.title}' }, { entryStack: [{ id: 'row', fields: { title: 'Actual title' } }] })).toEqual([])
    expect(inspect({}, { value: '{parentEntry.title}' }, { entryStack: [{ id: 'row', fields: { title: 'Actual title' } }] })[0]?.reason).toBe('unresolved')
  })

  it('does not rewrite escaped tokens or tokens obtained from a real field', () => {
    const context = { entryStack: [{ id: 'row', fields: { title: '{site.name}' } }], site: { id: 'site', name: 'Resolved site' } }
    const vc = component()
    for (const value of ['\\{site.name}', '{currentEntry.title}']) {
      const instance = instantiateVCAtRef(vc, { value }, {}, {}, 'ref')
      expect(inspectVCRequiredParameters(vc, instance, 'ref', context)).toEqual([])
      expect(instance.nodes.text.props.text).toBe(value)
      expect(instance.parameterValues.get('value')).toBe(value)
    }
  })

  it('reports an unavailable structured argument-bag binding without accepting static defaults', () => {
    const vc = component()
    const instance = instantiateVCAtRef(vc, {}, {}, {}, 'ref')
    const binding = { source: 'currentEntry', field: 'arguments' } as const
    expect(inspectVCRequiredParameters(vc, instance, 'ref', { entryStack: [] }, binding)[0]?.reason).toBe('unresolved')
    expect(() => assertVCRequiredParameters(vc, instance, 'ref', { entryStack: [] }, binding)).toThrow('requires a real render context')
  })

  it('preserves typed diagnostics and a stable domain path', () => {
    const vc = component()
    try {
      assertVCRequiredParameters(vc, instantiateVCAtRef(vc, { value: '' }, {}, {}, 'ref'), 'ref', undefined)
      throw new Error('Expected required parameter failure')
    } catch (error) {
      expect(error).toBeInstanceOf(VisualComponentParameterError)
      expect(error).toHaveProperty('path', 'nodes.ref.props.propOverrides.value')
      expect(error).toHaveProperty('issue.componentId', 'card')
      expect(error).toHaveProperty('issue.parameterId', 'value')
      expect(error).toHaveProperty('issue.reason', 'missing')
    }
  })
})

describe('required native slots', () => {
  function slotComponent() {
    return makeVC({ id: 'slot-card', name: 'Slot Card', params: [{
      id: 'content', name: 'children', type: 'slot', defaultValue: [], required: true,
    }], tree: makeVCTree('body', [
      makeVCNode({ id: 'body', moduleId: 'base.body', children: ['outlet'] }),
      makeVCNode({ id: 'outlet', moduleId: 'base.slot-outlet', props: { slotName: 'children' } }),
    ]) })
  }

  it('uses visible actual nodes, never a prop bag or missing/hidden node IDs', () => {
    const vc = slotComponent()
    const text = makeNode({ id: 'text', moduleId: 'base.text', props: { text: 'Content' } })
    const filled = instantiateVCAtRef(vc, { content: [] }, { children: ['text'] }, { text }, 'ref')
    expect(inspectVCRequiredParameters(vc, filled, 'ref', undefined)).toEqual([])
    for (const instance of [
      instantiateVCAtRef(vc, { content: [text], slotContent: { children: [text] } }, {}, { text }, 'ref'),
      instantiateVCAtRef(vc, {}, { children: ['missing'] }, {}, 'ref'),
      instantiateVCAtRef(vc, {}, { children: ['text'] }, { text: { ...text, hidden: true } }, 'ref'),
    ]) expect(inspectVCRequiredParameters(vc, instance, 'ref', undefined)[0]?.reason).toBe('missing')
  })

  it('accepts a materialized native default but an explicit empty fill clears it', () => {
    const vc = slotComponent()
    const text = makeVCNode({ id: 'default-text', moduleId: 'base.text', props: { text: 'Default content' } })
    vc.params[0].defaultValue = [text]
    const defaultInstance = instantiateVCAtRef(vc, {}, {}, {}, 'ref')
    expect(inspectVCRequiredParameters(vc, defaultInstance, 'ref', undefined)).toEqual([])
    const cleared = instantiateVCAtRef(vc, {}, { children: [] }, {}, 'ref')
    expect(cleared.nodes['default-text']).toBeUndefined()
    expect(inspectVCRequiredParameters(vc, cleared, 'ref', undefined)[0]?.reason).toBe('missing')
  })
})
