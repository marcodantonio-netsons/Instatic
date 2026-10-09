import { describe, expect, test } from 'bun:test'
import { isRecord } from '@core/utils/isRecord'
import {
  migrateDataLoopQueries034, type DataLoopQuery034Table,
  type DataLoopQuery034Context,
} from './dataLoopQuery034'

const tables: DataLoopQuery034Table[] = [
  { id: 'catalog', kind: 'data', fields: [
    { id: 'name', type: 'text', label: 'Name' },
    { id: 'price', type: 'number', label: 'Price' },
    { id: 'featured', type: 'boolean', label: 'Featured' },
    { id: 'other', type: 'relation', label: 'Other', targetTableId: 'posts' },
    { id: 'tags', type: 'multiSelect', label: 'Tags', options: [] },
  ] },
  { id: 'posts', kind: 'postType', fields: [{ id: 'title', type: 'text', label: 'Title' }] },
  { id: 'pages', kind: 'page', fields: [{ id: 'body', type: 'pageTree', label: 'Body' }, { id: 'notes', type: 'longText', label: 'Notes' }] },
  { id: 'components', kind: 'component', fields: [{ id: 'body', type: 'pageTree', label: 'Body' }, { id: 'params', type: 'fieldSchema', label: 'Parameters' }] },
  { id: 'layouts', kind: 'layout', fields: [{ id: 'body', type: 'pageTree', label: 'Body' }] },
]
const context: DataLoopQuery034Context = { tables }

function loop(id = 'loop', extraProps: Record<string, unknown> = {}) {
  return { id, moduleId: 'base.loop', children: [], props: {
    sourceId: 'data.rows', filters: { tableId: 'catalog' },
    orderBy: 'publishedAt', direction: 'desc', offset: 7, limit: 3,
    pagination: 'infinite', pageSize: 11, retryLabel: 'Again',
    ...extraProps,
  } }
}
function tree(nodes: ReturnType<typeof loop>[] = [loop()]) {
  return { rootNodeId: nodes[0]?.id ?? 'root', nodes: Object.fromEntries(nodes.map(node => [node.id, node])) }
}
function migrate(value: unknown, ctx: DataLoopQuery034Context = context) {
  return migrateDataLoopQueries034({ kind: 'nodeTree', value, path: 'draft.body' }, ctx)
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Expected a stored object')
  return value
}
function node(value: unknown, id = 'loop') { return record(record(record(value).nodes)[id]) }
function props(value: unknown, id = 'loop') { return record(node(value, id).props) }
function query(value: unknown, id = 'loop') { return record(record(props(value, id).filters).query) }
function param(id: string, defaultValue: unknown, type: 'string' | 'slot' = 'string') {
  return { id, name: id, type, defaultValue, required: false }
}
function component(body: unknown, params: unknown[] = []) { return { id: 'card', tree: body, params } }

describe('migration 034 native data loop query carriers', () => {
  test('rewrites a legacy data loop, makes the date proxy explicit, and preserves all unrelated props', () => {
    const source = tree()
    const result = migrate(source)
    expect(result.issues).toEqual([])
    expect(result.changed).toBe(true)
    expect(query(result.value)).toEqual({ source: { kind: 'table', tableId: 'catalog' }, order: [{ kind: 'row', field: 'createdAt', direction: 'desc' }] })
    expect(props(result.value)).toMatchObject({ sourceId: 'data.rows', offset: 7, limit: 3, pagination: 'infinite', pageSize: 11, retryLabel: 'Again' })
    expect(Object.hasOwn(props(result.value), 'orderBy')).toBe(false)
    expect(Object.hasOwn(props(result.value), 'direction')).toBe(false)
    expect(source.nodes.loop?.props.orderBy).toBe('publishedAt')
  })

  test('post-type ordering keeps publishedAt and cell ordering uses the actual field identity', () => {
    const result = migrate(tree([
      loop('post', { filters: { tableId: 'posts' }, orderBy: 'publishedAt', direction: 'asc' }),
      loop('price', { orderBy: 'cell: price ', direction: 'asc' }),
    ]))
    expect(result.issues).toEqual([])
    expect(query(result.value, 'post').order).toEqual([{ kind: 'row', field: 'publishedAt', direction: 'asc' }])
    expect(query(result.value, 'price').order).toEqual([{ kind: 'field', fieldId: 'price', direction: 'asc' }])
  })

  test('the known unconfigured order uses the old source defaults', () => {
    const raw = { ...loop(), props: { sourceId: 'data.rows', filters: { tableId: 'catalog' } } }
    const result = migrate({ rootNodeId: raw.id, nodes: { loop: raw } })
    expect(result.issues).toEqual([])
    expect(query(result.value).order).toEqual([{ kind: 'row', field: 'createdAt', direction: 'desc' }])
  })

  test.each([
    ['price', ' 12.5 ', 12.5],
    ['price', 0, 0],
    ['featured', 'false', false],
    ['featured', '1', true],
    ['featured', false, false],
    ['name', true, 'true'],
  ])('converts a scalar according to its field type: %s / %s', (fieldId, value, expected) => {
    const result = migrate(tree([loop('loop', { filters: { tableId: 'catalog', cellField: fieldId, cellOperator: 'is', cellValue: value } })]))
    expect(result.issues).toEqual([])
    expect(query(result.value).where).toEqual({ kind: 'field', fieldId, operator: 'eq', value: expected })
  })

  test.each(['{translations.example}', '{route.value}'])('condition token syntax remains an exact literal operand: %s', value => {
    const result = migrate(tree([loop('loop', { filters: {
      tableId: 'catalog', cellField: 'name', cellOperator: 'is', cellValue: value,
    } })]))
    expect(result.issues).toEqual([])
    expect(query(result.value).where).toEqual({ kind: 'field', fieldId: 'name', operator: 'eq', value })
  })

  test('isNot retains missing rows through an explicit empty OR inequality', () => {
    const result = migrate(tree([loop('loop', { filters: { tableId: 'catalog', cellField: 'price', cellOperator: 'isNot', cellValue: '42' } })]))
    expect(query(result.value).where).toEqual({ kind: 'any', predicates: [
      { kind: 'presence', fieldId: 'price', operator: 'empty' },
      { kind: 'field', fieldId: 'price', operator: 'ne', value: 42 },
    ] })
    expect(result.issues).toEqual([])
  })

  test('isFalse retains unset booleans and isSet preserves presence semantics', () => {
    const result = migrate(tree([
      loop('false', { filters: { tableId: 'catalog', cellField: 'featured', cellOperator: 'isFalse' } }),
      loop('set', { filters: { tableId: 'catalog', cellField: 'name', cellOperator: 'isSet' } }),
    ]))
    expect(result.issues).toEqual([])
    expect(query(result.value, 'false').where).toEqual({ kind: 'any', predicates: [
      { kind: 'presence', fieldId: 'featured', operator: 'empty' },
      { kind: 'field', fieldId: 'featured', operator: 'eq', value: false },
    ] })
    expect(query(result.value, 'set').where).toEqual({ kind: 'presence', fieldId: 'name', operator: 'present' })
  })

  test.each([
    ['isTrue', { kind: 'field', fieldId: 'featured', operator: 'eq', value: true }],
    ['isEmpty', { kind: 'presence', fieldId: 'featured', operator: 'empty' }],
  ])('retains the value-less %s operator', (operator, expected) => {
    const result = migrate(tree([loop('loop', { filters: { tableId: 'catalog', cellField: 'featured', cellOperator: operator } })]))
    expect(result.issues).toEqual([])
    expect(query(result.value).where).toEqual(expected)
  })

  test.each([
    { filters: { tableId: 'unknown' } },
    { filters: { tableId: 'catalog', cellField: 'missing', cellOperator: 'is', cellValue: 'x' } },
    { filters: { tableId: 'catalog', cellField: 'price', cellOperator: 'is', cellValue: 'NaN' } },
    { filters: { tableId: 'catalog', cellField: 'featured', cellOperator: 'is', cellValue: 'maybe' } },
    { filters: { tableId: 'catalog', cellField: 'name', cellOperator: 'is', cellValue: '' } },
    { filters: { tableId: 'catalog', cellField: 'tags', cellOperator: 'isEmpty' } },
    { filters: { tableId: 'catalog', cellField: 'name', cellOperator: 'unsupported', cellValue: 'x' } },
    { filters: { tableId: 'catalog', cellValue: { tableId: 'secret' } } },
    { filters: { tableId: 'catalog', unrelated: { nodes: {} } } },
    { orderBy: 'cell:missing' },
    { direction: 'sideways' },
    { pageSize: 501 },
    { offset: -1 },
  ])('does not partly rewrite unresolved configuration: %j', extra => {
    const source = tree([loop('loop', extra)])
    const result = migrate(source)
    expect(result.value).toBe(source)
    expect(result.changed).toBe(false)
    expect(result.issues).toMatchObject([{ path: expect.stringContaining('draft.body.nodes.loop.props'), code: 'invalid_stored_loop_query' }])
    expect(result.issues[0]?.message).not.toContain('secret')
    expect(source.nodes.loop?.props).toHaveProperty('orderBy')
  })

  test('a failed node stays raw even when another node can be migrated', () => {
    const bad = loop('bad', { orderBy: 'cell:absent' })
    const source = tree([bad, loop('good')])
    const result = migrate(source)
    expect(result.changed).toBe(true)
    expect(node(result.value, 'bad')).toBe(bad)
    expect(query(result.value, 'good').source).toEqual({ kind: 'table', tableId: 'catalog' })
    expect(result.issues).toHaveLength(1)
  })

  test('visits hidden and orphan nodes, including native materialized slot children', () => {
    const hidden = { ...loop('hidden'), hidden: true }
    const orphan = loop('orphan')
    const fill = { id: 'fill', moduleId: 'base.slot-instance', props: { slotName: 'content' }, children: ['hidden'] }
    const source = { rootNodeId: 'fill', nodes: { fill, hidden, orphan } }
    const result = migrate(source)
    expect(result.issues).toEqual([])
    expect(node(result.value, 'fill')).toBe(fill)
    expect(query(result.value, 'hidden').source).toEqual({ kind: 'table', tableId: 'catalog' })
    expect(query(result.value, 'orphan').source).toEqual({ kind: 'table', tableId: 'catalog' })
  })

  test('row and stored version cells traverse only fields declared pageTree', () => {
    const decoy = tree([loop('decoy')])
    const source = { body: tree(), notes: decoy, arbitrary: { body: tree() } }
    for (const path of ['rows.saved.cells', 'versions.published.cells']) {
      const result = migrateDataLoopQueries034({ kind: 'cells', value: source, path, tableId: 'pages' }, context)
      expect(result.issues).toEqual([])
      const cells = record(result.value)
      expect(query(cells.body).source).toEqual({ kind: 'table', tableId: 'catalog' })
      expect(cells.notes).toBe(decoy)
      expect(cells.arbitrary).toBe(source.arbitrary)
    }
  })

  test('site snapshots include all pages, unused components, layouts, and flat slot defaults', () => {
    const slot = loop('slot')
    const vc = component(tree([loop('unused')]), [param('slot', [slot], 'slot')])
    const source = { pages: [tree([loop('page')])], visualComponents: [vc], layouts: [tree([loop('layout')])], settings: { decoy: tree() } }
    const result = migrateDataLoopQueries034({ kind: 'siteSnapshot', value: source, path: 'snapshot.site_json' }, context)
    expect(result.issues).toEqual([])
    const snapshot = record(result.value)
    const pages = snapshot.pages
    const components = snapshot.visualComponents
    const layouts = snapshot.layouts
    if (!Array.isArray(pages) || !Array.isArray(components) || !Array.isArray(layouts)) throw new Error('Expected native snapshot collections')
    expect(query(pages[0], 'page').source).toEqual({ kind: 'table', tableId: 'catalog' })
    expect(query(layouts[0], 'layout').source).toEqual({ kind: 'table', tableId: 'catalog' })
    const migratedVC = record(components[0])
    expect(query(migratedVC.tree, 'unused').source).toEqual({ kind: 'table', tableId: 'catalog' })
    const parameters = migratedVC.params
    if (!Array.isArray(parameters)) throw new Error('Expected component parameters')
    const defaults = record(parameters[0]).defaultValue
    if (!Array.isArray(defaults)) throw new Error('Expected native flat slot defaults')
    expect(record(record(defaults[0]).props).filters).toHaveProperty('query')
    expect(snapshot.settings).toBe(source.settings)
  })

  test.each(['filters', 'orderBy', 'direction', 'sourceId'])('structured bindings on %s keep the complete raw legacy node', key => {
    const raw = { ...loop(), dynamicBindings: { [key]: { source: 'currentEntry', field: 'anything' } } }
    const source = { rootNodeId: raw.id, nodes: { loop: raw } }
    const result = migrate(source)
    expect(result.value).toBe(source)
    expect(result.issues).toMatchObject([{ code: 'unbound_loop_query', path: `draft.body.nodes.loop.props.${key}` }])
  })

  test.each([
    { filters: '{currentEntry.query}' },
    { orderBy: '{currentEntry.order}' },
    { filters: { tableId: '{currentEntry.table}' } },
  ])('inline configuration bindings are reported without changing raw values: %j', extra => {
    const source = tree([loop('loop', extra)])
    const result = migrate(source)
    expect(result.value).toBe(source)
    expect(result.issues[0]?.code).toBe('unbound_loop_query')
  })

  test('breakpoint source overrides cannot leave a partially converted base query', () => {
    const raw = { ...loop(), breakpointOverrides: { narrow: { orderBy: 'cell:price' } } }
    const source = { rootNodeId: raw.id, nodes: { loop: raw } }
    const result = migrate(source)
    expect(result.value).toBe(source)
    expect(result.issues).toMatchObject([{ code: 'unbound_loop_query', path: 'draft.body.nodes.loop.breakpointOverrides.narrow' }])
  })

  test('whole filters and scalar order VC defaults and consumer overrides are explicit issues', () => {
    const bound = { ...loop(), propBindings: { filters: { paramId: 'filter' }, orderBy: { paramId: 'sort' } } }
    const vc = component({ rootNodeId: bound.id, nodes: { loop: bound } }, [param('filter', { tableId: 'catalog' }), param('sort', 'cell:price')])
    const ref = { id: 'ref', moduleId: 'base.visual-component-ref', props: { componentId: 'card', propOverrides: { filter: { tableId: 'catalog' }, sort: 'cell:price' } }, children: [] }
    const consumer = { rootNodeId: 'ref', nodes: { ref } }
    const result = migrate(consumer, { tables, visualComponents: [vc] })
    expect(result.value).toBe(consumer)
    expect(result.issues).toMatchObject([{ code: 'unbound_loop_query', path: 'draft.body.nodes.ref.props.propOverrides.filter' }])
    const cells = { body: vc.tree, params: vc.params }
    const definition = migrateDataLoopQueries034({ kind: 'cells', value: cells, path: 'component.cells', tableId: 'components' }, { tables, visualComponents: [vc] })
    expect(definition.value).toBe(cells)
    expect(definition.issues.map(issue => issue.path)).toEqual(expect.arrayContaining(['component.cells.params.0.defaultValue', 'component.cells.params.1.defaultValue']))
    const defaultRef = { ...ref, props: { componentId: 'card', propOverrides: {} } }
    const defaultConsumer = { rootNodeId: 'ref', nodes: { ref: defaultRef } }
    const fromDefault = migrate(defaultConsumer, { tables, visualComponents: [vc] })
    expect(fromDefault.value).toBe(defaultConsumer)
    expect(fromDefault.issues).toMatchObject([{ code: 'unbound_loop_query', path: 'draft.body.nodes.ref.props.componentId' }])
  })

  test('a VC source parameter or consumer override selecting data.rows is not silently ignored', () => {
    const bound = { ...loop(), props: { ...loop().props, sourceId: 'site.pages' }, propBindings: { sourceId: { paramId: 'source' } } }
    const vc = component({ rootNodeId: bound.id, nodes: { loop: bound } }, [param('source', 'data.rows')])
    const result = migrateDataLoopQueries034({ kind: 'cells', value: { body: vc.tree, params: vc.params }, path: 'component.cells', tableId: 'components' }, { tables, visualComponents: [vc] })
    expect(result.changed).toBe(false)
    expect(result.issues.some(issue => issue.code === 'unbound_loop_query')).toBe(true)
    const otherVC = component(vc.tree, [param('source', 'site.pages')])
    const ref = { id: 'ref', moduleId: 'base.visual-component-ref', props: { componentId: 'card', propOverrides: { source: 'data.rows' } }, children: [] }
    const consumer = { rootNodeId: 'ref', nodes: { ref } }
    const override = migrate(consumer, { tables, visualComponents: [otherVC] })
    expect(override.changed).toBe(false)
    expect(override.issues[0]?.code).toBe('unbound_loop_query')
  })

  test('new queries are validated, idempotent, and leave unrelated legacy order props untouched', () => {
    const definition = { query: { source: { kind: 'table', tableId: 'catalog' }, where: { kind: 'field', fieldId: 'price', operator: 'eq', value: 12 } } }
    const source = tree([loop('loop', { filters: definition, orderBy: 'unrelated', direction: 'unrelated' })])
    const result = migrate(source)
    expect(result).toEqual({ value: source, changed: false, issues: [] })
    expect(result.value).toBe(source)
    const converted = migrate(tree())
    expect(migrate(converted.value)).toEqual({ value: converted.value, changed: false, issues: [] })
  })

  test('new queries with wrong typed operands or invalid URL declarations stay raw and report issues', () => {
    for (const filters of [
      { query: { source: { kind: 'table', tableId: 'catalog' }, where: { kind: 'field', fieldId: 'price', operator: 'eq', value: '12' } } },
      { query: { source: { kind: 'table', tableId: 'catalog' } }, urlInputs: [{ parameter: 's', operand: 'search' }] },
    ]) {
      const source = tree([loop('loop', { filters })])
      const result = migrate(source)
      expect(result.value).toBe(source)
      expect(result.issues[0]?.code).toBe('invalid_stored_loop_query')
    }
  })

  test('already-native entries, relation and inbound sources validate against their actual target schema', () => {
    const sources = [
      { kind: 'entries', tableId: 'posts', rowIds: ['one'] },
      { kind: 'relation', owner: { tableId: 'catalog', rowId: 'owner' }, field: { fieldId: 'other' } },
      { kind: 'inbound', tableId: 'posts', sourceTableId: 'catalog', fieldId: 'other', ownerRowIds: ['owner'] },
    ]
    for (const source of sources) {
      const document = tree([loop('loop', { filters: { query: { source, where: { kind: 'field', fieldId: 'title', operator: 'eq', value: 'Hello' } } } })])
      expect(migrate(document)).toEqual({ value: document, changed: false, issues: [] })
      const invalid = tree([loop('loop', { filters: { query: { source, where: { kind: 'field', fieldId: 'price', operator: 'eq', value: 12 } } } })])
      expect(migrate(invalid).issues[0]?.code).toBe('invalid_stored_loop_query')
    }
  })

  test('a native static fallback does not hide an old whole-filter parameter default or override', () => {
    const filters = { query: { source: { kind: 'table', tableId: 'catalog' } } }
    const bound = { ...loop('loop', { filters }), propBindings: { filters: { paramId: 'filter' } } }
    const vc = component({ rootNodeId: bound.id, nodes: { loop: bound } }, [param('filter', { tableId: 'catalog' })])
    const result = migrateDataLoopQueries034({ kind: 'cells', value: { body: vc.tree, params: vc.params }, path: 'component.cells', tableId: 'components' }, { tables, visualComponents: [vc] })
    expect(result.changed).toBe(false)
    expect(result.issues.some(issue => issue.code === 'unbound_loop_query')).toBe(true)
    const validVC = component(vc.tree, [param('filter', filters)])
    const ref = { id: 'ref', moduleId: 'base.visual-component-ref', props: { componentId: 'card', propOverrides: { filter: { tableId: 'catalog' } } }, children: [] }
    const consumer = { rootNodeId: 'ref', nodes: { ref } }
    const overridden = migrate(consumer, { tables, visualComponents: [validVC] })
    expect(overridden.value).toBe(consumer)
    expect(overridden.issues[0]?.code).toBe('invalid_stored_loop_query')
  })

  test('preserves supported URL inputs when converting the old static definition', () => {
    const urlInputs = [{ parameter: 'count', operand: 'pageSize', maximum: 25 }]
    const result = migrate(tree([loop('loop', { filters: { tableId: 'catalog', urlInputs } })]))
    expect(result.issues).toEqual([])
    expect(record(props(result.value).filters).urlInputs).toEqual(urlInputs)
  })

  test('does not identify missing or another source as a data.rows loop', () => {
    for (const sourceId of [undefined, 'site.pages', 'plugin.items']) {
      const source = tree([loop('loop', { sourceId, filters: { tableId: 'catalog' } })])
      expect(migrate(source)).toEqual({ value: source, changed: false, issues: [] })
    }
  })

  test('invalid metadata, malformed tree nodes and noncanonical slot defaults are retained with issues', () => {
    const source = tree()
    const invalidFields: DataLoopQuery034Table[] = [{ id: 'catalog', kind: 'data', fields: [{ id: 'same', label: 'A', type: 'text' }, { id: 'same', label: 'B', type: 'number' }] }]
    expect(migrate(source, { tables: invalidFields })).toMatchObject({ value: source, changed: false, issues: [{ code: 'invalid_stored_loop_query' }] })
    const malformed = { rootNodeId: 'bad', nodes: { bad: { id: 'bad', props: { sourceId: 'data.rows' } } } }
    const result = migrate(malformed)
    expect(result.value).toBe(malformed)
    expect(result.issues).toMatchObject([{ path: 'draft.body.nodes.bad', code: 'invalid_stored_loop_query' }])
    const vc = component(tree([]), [param('slot', { nodes: { loop: loop() }, rootNodeId: 'loop' }, 'slot')])
    const slots = migrateDataLoopQueries034({ kind: 'cells', value: { body: vc.tree, params: vc.params }, path: 'component.cells', tableId: 'components' }, context)
    expect(slots.changed).toBe(false)
    expect(slots.issues).toMatchObject([{ path: 'component.cells.params.0.defaultValue', code: 'invalid_stored_loop_query' }])
  })
})
