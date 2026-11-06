import { describe, expect, test } from 'bun:test'
import type { PageNode } from '@core/page-tree'
import { loopSourceRegistry } from '@core/loops'
import { collectDataRenderQueryInputs } from './renderQueryInputs'

function node(props: Record<string, unknown>, moduleId = 'base.text'): PageNode {
  return { id: 'native', moduleId, label: 'Native', props, children: [], classIds: [], breakpointOverrides: {}, parentId: null }
}

describe('native render query dependencies', () => {
  test('collects ordinary bindings and authored HTML attributes without guessing from all props', () => {
    const value = node({ text: '{route.query.q}', htmlAttributes: { href: '/?c={route.query.category}', 'data-fixed': 'fixed' }, unrelated: { nested: '{route.query.private}' } })
    value.dynamicBindings = { text: { source: 'route', field: 'query.sort' } }
    expect(collectDataRenderQueryInputs({ kind: 'declared', names: [] }, value)).toEqual({ kind: 'declared', names: ['category', 'q', 'sort'] })
  })

  test('uses loop URL declarations and the initial page key', () => {
    const value = node({ sourceId: 'data.rows', pagination: 'infinite', pageSize: 3, filters: {
      query: { source: { kind: 'table', tableId: 'guides' }, search: { fieldIds: ['heading'], text: '' } },
      urlInputs: [{ parameter: 'q', operand: 'search' }],
    } }, 'base.loop')
    expect(collectDataRenderQueryInputs({ kind: 'declared', names: ['category'] }, value)).toEqual({ kind: 'declared', names: ['category', 'loop_native_page', 'q'] })
  })

  test('an entire query binding requires the full query rather than an invented named subset', () => {
    expect(collectDataRenderQueryInputs({ kind: 'declared', names: [] }, node({ text: '{route.query}' }))).toEqual({ kind: 'all' })
  })

  test('a source that receives arbitrary request input declares the entire query', () => {
    const id = 'test.request-source'
    loopSourceRegistry.register({ id, label: 'Request', kind: 'contextual', fields: [], filterSchema: {}, orderByOptions: [], requestDependent: true })
    try { expect(collectDataRenderQueryInputs({ kind: 'declared', names: [] }, node({ sourceId: id }, 'base.loop'))).toEqual({ kind: 'all' }) }
    finally { loopSourceRegistry.unregister(id) }
  })
})
