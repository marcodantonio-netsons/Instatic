/** One-time, lossless carrier rewrite for migration 034. No runtime legacy reader. */
import { DataTableSchema, type DataField } from '@core/data/schemas'
import { DataFieldValidationError, parseDataTableFields } from '@core/data/fields'
import {
  DATA_QUERY_LIMITS, DataCollectionQuerySchema, DataLoopDefinitionSchema, RelationValidationError,
  assertDataCollectionQuery, decodeDataQueryUrlInputs,
  type DataCollectionQuery, type DataCollectionOrder, type DataLoopDefinition,
  type DataPredicate,
} from '@core/data-read'
import { parseTokenString } from '@core/templates'
import { VisualComponentSchema } from '@core/visual-components-schema'
import { Type, type Static } from '@core/utils/typeboxHelpers'
import { compiledCheck } from '@core/utils/typeboxCompiler'
import { isRecord } from '@core/utils/isRecord'

export const DataLoopQuery034TableSchema = Type.Pick(DataTableSchema, ['id', 'kind', 'fields'])
export type DataLoopQuery034Table = Static<typeof DataLoopQuery034TableSchema>

export const DataLoopQuery034IssueSchema = Type.Object({
  path: Type.String(),
  code: Type.Union([Type.Literal('invalid_stored_loop_query'), Type.Literal('unbound_loop_query')]),
  message: Type.String(),
}, { additionalProperties: false })
export type DataLoopQuery034Issue = Static<typeof DataLoopQuery034IssueSchema>

export const DataLoopQuery034CarrierSchema = Type.Union([
  Type.Object({ kind: Type.Literal('nodeTree'), value: Type.Unknown(), path: Type.String() }),
  Type.Object({ kind: Type.Literal('siteSnapshot'), value: Type.Unknown(), path: Type.String() }),
  Type.Object({ kind: Type.Literal('cells'), value: Type.Unknown(), path: Type.String(), tableId: Type.String() }),
])
export type DataLoopQuery034Carrier = Static<typeof DataLoopQuery034CarrierSchema>
export type DataLoopQuery034Context = {
  /** Logical table identities and complete schemas from the carrier's branch. */
  tables: readonly DataLoopQuery034Table[]
  /** Raw canonical {id, tree, params} VC documents from the same branch. */
  visualComponents?: readonly unknown[]
}
export type DataLoopQuery034Result = {
  value: unknown
  changed: boolean
  issues: DataLoopQuery034Issue[]
}

// Narrow structural schemas leave unrelated authored fields exactly as stored.
// The migration never calls the tolerant page/VC readers, which can drop nodes.
const TreeSchema = Type.Object({ rootNodeId: Type.String(), nodes: Type.Record(Type.String(), Type.Unknown()) })
const NodeSchema = Type.Object({
  id: Type.String(), moduleId: Type.String(), props: Type.Optional(Type.Unknown()),
  children: Type.Optional(Type.Array(Type.String())),
  dynamicBindings: Type.Optional(Type.Unknown()), propBindings: Type.Optional(Type.Unknown()),
  breakpointOverrides: Type.Optional(Type.Unknown()),
})
const ComponentSchema = Type.Object({ id: Type.String(), tree: Type.Unknown(), params: Type.Array(Type.Unknown()) })
const ParamSchema = VisualComponentSchema.properties.params.items
const BindingSchema = Type.Object({ paramId: Type.String() })
const SnapshotSchema = Type.Object({ pages: Type.Array(Type.Unknown()), visualComponents: Type.Array(Type.Unknown()), layouts: Type.Array(Type.Unknown()) })
const CONFIG_KEYS = ['sourceId', 'filters', 'orderBy', 'direction'] as const
const LEGACY_FILTER_KEYS = new Set(['tableId', 'cellField', 'cellOperator', 'cellValue', 'urlInputs'])
const LEGACY_OPERATORS = new Set(['is', 'isNot', 'isTrue', 'isFalse', 'isSet', 'isEmpty'])
const STRING_TYPES = new Set(['text', 'localizedText', 'longText', 'richText', 'date', 'dateTime', 'select', 'url', 'email'])
type ConfigKey = typeof CONFIG_KEYS[number]
type ComponentBinding = { paramId: string; propKey: ConfigKey; dataSource: boolean; legacy: boolean; defaultValue: unknown }
type ComponentInfo = { bindings: ComponentBinding[] }

class StoredLoopIssue extends Error {
  constructor(readonly issue: DataLoopQuery034Issue) { super(issue.message) }
}

function invalid(path: string, message: string): never {
  throw new StoredLoopIssue({ path, code: 'invalid_stored_loop_query', message })
}
function unbound(path: string): never {
  throw new StoredLoopIssue({ path, code: 'unbound_loop_query', message: 'Authored loop configuration cannot be converted independently of its binding' })
}
function hasToken(value: unknown): boolean {
  return typeof value === 'string' && parseTokenString(value).some(segment => segment.kind === 'token')
}
function bindingId(node: Record<string, unknown>, key: ConfigKey): string | undefined {
  const bindings = node.propBindings
  if (!isRecord(bindings) || !compiledCheck(BindingSchema, bindings[key])) return undefined
  return bindings[key].paramId
}

function scalarKind(field: DataField, path: string): 'string' | 'number' | 'boolean' {
  if (STRING_TYPES.has(field.type) || (field.type === 'relation' && field.allowMultiple !== true)) return 'string'
  if (field.type === 'number' || field.type === 'boolean') return field.type
  return invalid(path, 'The legacy operand is not a scalar field in the collection schema')
}

function scalarValue(raw: unknown, field: DataField, path: string): string | number | boolean {
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') invalid(path, 'The legacy comparison requires a scalar value')
  if (typeof raw === 'number' && !Number.isFinite(raw)) invalid(path, 'The legacy comparison requires a finite value')
  const text = String(raw).trim()
  if (!text) invalid(path, 'The legacy comparison is incomplete')
  switch (scalarKind(field, path)) {
    case 'string': return text
    case 'boolean':
      if (text === 'true' || text === '1') return true
      if (text === 'false' || text === '0') return false
      return invalid(path, 'The comparison value does not match its boolean field')
    case 'number': {
      if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(text)) invalid(path, 'The comparison value does not match its number field')
      const value = Number(text)
      if (!Number.isFinite(value)) invalid(path, 'The comparison value does not match its number field')
      return value
    }
  }
}

function legacyWhere(filters: Record<string, unknown>, table: DataLoopQuery034Table, path: string): DataPredicate | undefined {
  if (filters.cellValue !== undefined && typeof filters.cellValue !== 'string' && typeof filters.cellValue !== 'number' && typeof filters.cellValue !== 'boolean') invalid(`${path}.cellValue`, 'The legacy comparison value is malformed')
  // The old condition compares a literal scalar; token syntax in its value
  // was never interpolated by the source and must remain literal.
  if (hasToken(filters.cellOperator)) unbound(path)
  const rawField = filters.cellField
  if (rawField === undefined || rawField === '') {
    // Empty controls are a known unconfigured condition. Other retained values
    // cannot be silently discarded merely because legacy parsing ignored them.
    if ((filters.cellOperator !== undefined && filters.cellOperator !== '' && filters.cellOperator !== 'is') ||
      (filters.cellValue !== undefined && filters.cellValue !== '')) invalid(path, 'The legacy condition is incomplete')
    return undefined
  }
  if (typeof rawField !== 'string' || !rawField.trim()) invalid(`${path}.cellField`, 'The legacy condition requires a field identity')
  if (hasToken(rawField)) unbound(`${path}.cellField`)
  const fieldId = rawField.trim()
  const field = table.fields.find(candidate => candidate.id === fieldId)
  if (!field) invalid(`${path}.cellField`, 'The legacy condition field does not exist in its collection schema')
  const type = scalarKind(field, `${path}.cellField`)
  const operator = filters.cellOperator === undefined || filters.cellOperator === '' ? 'is' : filters.cellOperator
  if (typeof operator !== 'string' || !LEGACY_OPERATORS.has(operator)) invalid(`${path}.cellOperator`, 'The legacy condition operator is unsupported')
  const empty: DataPredicate = { kind: 'presence', fieldId, operator: 'empty' }
  const compare = (value: string | number | boolean, op: 'eq' | 'ne' = 'eq'): DataPredicate => ({ kind: 'field', fieldId, operator: op, value })
  if (operator === 'isSet') return { kind: 'presence', fieldId, operator: 'present' }
  if (operator === 'isEmpty') return empty
  if (operator === 'isTrue' || operator === 'isFalse') {
    const checked = operator === 'isTrue'
    const comparisons = type === 'boolean' ? [compare(checked)] : type === 'number' ? [compare(checked ? 1 : 0)]
      : [compare(checked ? 'true' : 'false'), compare(checked ? '1' : '0')]
    return !checked ? { kind: 'any', predicates: [empty, ...comparisons] }
      : comparisons.length === 1 ? comparisons[0] : { kind: 'any', predicates: comparisons }
  }
  const value = scalarValue(filters.cellValue, field, `${path}.cellValue`)
  return operator === 'isNot' ? { kind: 'any', predicates: [empty, compare(value, 'ne')] } : compare(value)
}

function legacyOrder(props: Record<string, unknown>, table: DataLoopQuery034Table, path: string): DataCollectionOrder {
  const direction = props.direction === undefined ? 'desc' : props.direction
  if (direction !== 'asc' && direction !== 'desc') invalid(`${path}.direction`, 'The legacy order direction is invalid')
  const orderBy = props.orderBy === undefined || props.orderBy === '' ? 'publishedAt' : props.orderBy
  if (typeof orderBy !== 'string') invalid(`${path}.orderBy`, 'The legacy order operand is invalid')
  if (orderBy.startsWith('cell:')) {
    const fieldId = orderBy.slice(5).trim()
    const field = table.fields.find(candidate => candidate.id === fieldId)
    if (!field) invalid(`${path}.orderBy`, 'The legacy order field does not exist in its collection schema')
    scalarKind(field, `${path}.orderBy`)
    return { kind: 'field', fieldId, direction }
  }
  if (orderBy !== 'publishedAt' && orderBy !== 'createdAt' && orderBy !== 'updatedAt' && orderBy !== 'slug') invalid(`${path}.orderBy`, 'The legacy order operand is unsupported')
  return { kind: 'row', field: table.kind === 'data' && orderBy === 'publishedAt' ? 'createdAt' : orderBy, direction }
}

/**
 * Only the caller selects a persisted carrier and branch. Successful node
 * rewrites share no references with modified bags; rejected nodes remain the
 * exact raw value. The SQL migration must block when issues is nonempty.
 */
export function migrateDataLoopQueries034(carrier: DataLoopQuery034Carrier, context: DataLoopQuery034Context): DataLoopQuery034Result {
  const initialValue = carrier.value
  const issues: DataLoopQuery034Issue[] = []
  const tables = new Map<string, DataLoopQuery034Table>()
  const components = new Map<string, ComponentInfo>()
  const record = (path: string, message: string, code: DataLoopQuery034Issue['code'] = 'invalid_stored_loop_query') => { issues.push({ path, code, message }) }
  const attempt = (raw: unknown, fn: () => unknown): unknown => {
    try { return fn() }
    catch (cause) {
      if (!(cause instanceof StoredLoopIssue)) throw cause
      issues.push(cause.issue)
      return raw
    }
  }

  if (!compiledCheck(DataLoopQuery034CarrierSchema, carrier)) return { value: initialValue, changed: false, issues: [{ path: '', code: 'invalid_stored_loop_query', message: 'The migration carrier is invalid' }] }
  for (const [index, table] of context.tables.entries()) {
    const path = `${carrier.path}.context.tables.${index}`
    if (!compiledCheck(DataLoopQuery034TableSchema, table) || !table.id.trim() || tables.has(table.id)) {
      record(path, 'The branch requires distinct logical table identities and complete schemas')
      continue
    }
    try { tables.set(table.id, { ...table, fields: parseDataTableFields(table.fields, `${path}.fields`) }) }
    catch (cause) {
      if (!(cause instanceof DataFieldValidationError)) throw cause
      record(cause.path, 'The persisted collection schema is invalid')
    }
  }
  if (issues.length) return { value: carrier.value, changed: false, issues }

  const getTable = (id: string, path: string): DataLoopQuery034Table => {
    const table = tables.get(id)
    if (!table) invalid(path, 'The collection does not resolve within the carrier branch')
    return table
  }
  const queryTable = (query: DataCollectionQuery, path: string): DataLoopQuery034Table => {
    const source = query.source
    if (source.kind !== 'relation') {
      const table = getTable(source.tableId, path)
      if (source.kind === 'inbound') {
        const owner = getTable(source.sourceTableId, path)
        const relation = owner.fields.find(field => field.id === source.fieldId)
        if (relation?.type !== 'relation' || relation.targetTableId !== table.id) invalid(path, 'The inbound relation does not resolve in the collection schema')
      }
      return table
    }
    const owner = getTable(source.owner.tableId, path)
    let fields: readonly DataField[] = owner.fields
    if (source.field.repeater) {
      const repeater = fields.find(field => field.id === source.field.repeater?.fieldId)
      if (repeater?.type !== 'repeater') invalid(path, 'The relation repeater does not resolve in the collection schema')
      fields = repeater.fields
    }
    const field = fields.find(field => field.id === source.field.fieldId)
    if (field?.type !== 'relation') invalid(path, 'The relation does not resolve in the collection schema')
    return getTable(field.targetTableId, path)
  }
  const validateDefinition = (raw: unknown, path: string, pageProps?: Record<string, unknown>): DataLoopDefinition => {
    if (!compiledCheck(DataLoopDefinitionSchema, raw)) invalid(path, 'The stored native loop query is invalid')
    const pageSize = pageProps?.pagination === 'infinite' ? pageProps.pageSize : pageProps?.limit
    const query = { ...raw.query, offset: pageProps?.offset ?? 0, limit: pageProps ? pageSize ?? 10 : 1 }
    if (!compiledCheck(DataCollectionQuerySchema, query)) invalid(path, 'The stored native collection query is invalid')
    const validateQuery = (value: DataCollectionQuery) => assertDataCollectionQuery(value, queryTable(value, path).fields)
    try {
      validateQuery(query)
      decodeDataQueryUrlInputs(query, raw.urlInputs ?? [], new URLSearchParams())
      let choicesCount = 0
      for (const input of raw.urlInputs ?? []) {
        const choices = input.operand === 'predicate' ? input.allowedValues : input.operand === 'relationOwner' ? input.allowedRowIds : []
        choicesCount += choices.length
        if (choicesCount > DATA_QUERY_LIMITS.membership || (input.operand === 'relationOwner' && choices.length >= DATA_QUERY_LIMITS.demands)) invalid(path, 'The declared URL choices exceed the native query limit')
        for (const value of choices) validateQuery(decodeDataQueryUrlInputs(query, raw.urlInputs ?? [], new URLSearchParams([[input.parameter, value]])).query)
      }
    } catch (cause) {
      if (cause instanceof StoredLoopIssue) throw cause
      if (!(cause instanceof RelationValidationError)) throw cause
      invalid(path, 'The stored loop query does not match its collection schema or URL declarations')
    }
    return raw
  }

  const snapshotComponents = carrier.kind === 'siteSnapshot' && compiledCheck(SnapshotSchema, carrier.value) ? carrier.value.visualComponents : []
  for (const [index, raw] of [...(context.visualComponents ?? []), ...snapshotComponents].entries()) {
    if (!compiledCheck(ComponentSchema, raw) || !compiledCheck(TreeSchema, raw.tree)) {
      record(`${carrier.path}.context.visualComponents.${index}`, 'The component catalog requires canonical trees and parameters')
      continue
    }
    const params = new Map<string, Static<typeof ParamSchema>>()
    for (const [paramIndex, param] of raw.params.entries()) {
      if (!compiledCheck(ParamSchema, param) || !param.id.trim() || params.has(param.id)) {
        record(`${carrier.path}.context.visualComponents.${index}.params.${paramIndex}`, 'The component parameter is malformed')
      } else params.set(param.id, param)
    }
    const bindings: ComponentBinding[] = []
    const inspectNode = (node: unknown) => {
      if (!isRecord(node) || node.moduleId !== 'base.loop' || !isRecord(node.props)) return
      const sourceParam = bindingId(node, 'sourceId')
      const dataSource = node.props.sourceId === 'data.rows' || (sourceParam !== undefined && params.get(sourceParam)?.defaultValue === 'data.rows')
      const legacy = !(isRecord(node.props.filters) && Object.hasOwn(node.props.filters, 'query'))
      for (const propKey of CONFIG_KEYS) {
        const paramId = bindingId(node, propKey)
        if (paramId) bindings.push({ paramId, propKey, dataSource, legacy, defaultValue: params.get(paramId)?.defaultValue })
      }
    }
    Object.values(raw.tree.nodes).forEach(inspectNode)
    for (const param of params.values()) if (param.type === 'slot' && Array.isArray(param.defaultValue)) param.defaultValue.forEach(inspectNode)
    components.set(raw.id, { bindings })
  }

  const migrateNode = (raw: unknown, path: string, params?: ReadonlyMap<string, Static<typeof ParamSchema>>): unknown => attempt(raw, () => {
    if (!compiledCheck(NodeSchema, raw)) invalid(path, 'The persisted tree node is malformed')
    if (!isRecord(raw.props)) {
      if (raw.moduleId === 'base.loop') invalid(`${path}.props`, 'The loop properties are malformed')
      return raw
    }
    if (raw.moduleId === 'base.visual-component-ref') {
      const info = typeof raw.props.componentId === 'string' ? components.get(raw.props.componentId) : undefined
      if (!info) return raw
      const overrides = raw.props.propOverrides
      const sourceOverrides = info.bindings.filter(binding => binding.propKey === 'sourceId' && isRecord(overrides) && overrides[binding.paramId] === 'data.rows')
      const relevant = info.bindings.filter(binding => binding.dataSource || sourceOverrides.length > 0)
      for (const binding of relevant) {
        const own = isRecord(overrides) && Object.hasOwn(overrides, binding.paramId)
        const bindingPath = own ? `${path}.props.propOverrides.${binding.paramId}` : `${path}.props.componentId`
        if (binding.legacy) unbound(bindingPath)
        if (binding.propKey === 'filters') {
          const value = own && isRecord(overrides) ? overrides[binding.paramId] : binding.defaultValue
          validateDefinition(value, bindingPath)
        }
      }
      if (relevant.length && (hasToken(overrides) || (isRecord(raw.dynamicBindings) && Object.hasOwn(raw.dynamicBindings, 'propOverrides')) ||
        (isRecord(raw.propBindings) && Object.hasOwn(raw.propBindings, 'propOverrides')))) unbound(`${path}.props.propOverrides`)
      return raw
    }
    if (raw.moduleId !== 'base.loop') return raw
    const sourceParam = bindingId(raw, 'sourceId')
    const dataSource = raw.props.sourceId === 'data.rows' || (sourceParam !== undefined && params?.get(sourceParam)?.defaultValue === 'data.rows')
    if (!dataSource) return raw
    if (isRecord(raw.props.filters) && Object.hasOwn(raw.props.filters, 'query')) {
      validateDefinition(raw.props.filters, `${path}.props.filters`, raw.props)
      const filtersParam = bindingId(raw, 'filters')
      if (filtersParam) {
        const param = params?.get(filtersParam)
        if (!param || !compiledCheck(DataLoopDefinitionSchema, param.defaultValue)) unbound(`${path}.propBindings.filters`)
        validateDefinition(param.defaultValue, `${path}.propBindings.filters`)
      }
      return raw
    }
    for (const key of CONFIG_KEYS) {
      if ((isRecord(raw.dynamicBindings) && Object.hasOwn(raw.dynamicBindings, key)) ||
        (isRecord(raw.propBindings) && Object.hasOwn(raw.propBindings, key)) || hasToken(raw.props[key])) unbound(`${path}.props.${key}`)
    }
    if (isRecord(raw.breakpointOverrides)) for (const [breakpoint, override] of Object.entries(raw.breakpointOverrides)) {
      if (isRecord(override) && CONFIG_KEYS.some(key => Object.hasOwn(override, key))) unbound(`${path}.breakpointOverrides.${breakpoint}`)
    }
    const filters = raw.props.filters
    if (!isRecord(filters)) invalid(`${path}.props.filters`, 'The legacy loop filters are malformed')
    if (Object.keys(filters).some(key => !LEGACY_FILTER_KEYS.has(key))) invalid(`${path}.props.filters`, 'The legacy loop filters contain unsupported operands')
    if (typeof filters.tableId !== 'string' || !filters.tableId.trim()) invalid(`${path}.props.filters.tableId`, 'The legacy loop requires a logical collection identity')
    if (hasToken(filters.tableId)) unbound(`${path}.props.filters.tableId`)
    const table = getTable(filters.tableId, `${path}.props.filters.tableId`)
    const where = legacyWhere(filters, table, `${path}.props.filters`)
    const definition = validateDefinition({ query: { source: { kind: 'table', tableId: table.id }, ...(where ? { where } : {}), order: [legacyOrder(raw.props, table, `${path}.props`)] },
      ...(Object.hasOwn(filters, 'urlInputs') ? { urlInputs: filters.urlInputs } : {}),
    }, `${path}.props.filters`, raw.props)
    const props: Record<string, unknown> = { ...raw.props, filters: definition }
    delete props.orderBy
    delete props.direction
    return { ...raw, props }
  })

  const migrateTree = (raw: unknown, path: string, params?: ReadonlyMap<string, Static<typeof ParamSchema>>): unknown => attempt(raw, () => {
    if (!compiledCheck(TreeSchema, raw)) invalid(path, 'The persisted node tree is malformed')
    const nodes = Object.fromEntries(Object.entries(raw.nodes).map(([id, node]) => [id, migrateNode(node, `${path}.nodes.${id}`, params)]))
    return Object.keys(nodes).some(id => nodes[id] !== raw.nodes[id]) ? { ...raw, nodes } : raw
  })
  const migrateParams = (raw: unknown, tree: unknown, path: string): unknown => attempt(raw, () => {
    if (!Array.isArray(raw)) invalid(path, 'The component parameters are malformed')
    const params = new Map<string, Static<typeof ParamSchema>>()
    for (const [index, param] of raw.entries()) {
      if (!compiledCheck(ParamSchema, param) || !param.id.trim() || params.has(param.id)) invalid(`${path}.${index}`, 'The component parameter is malformed')
      params.set(param.id, param)
    }
    if (compiledCheck(TreeSchema, tree)) for (const node of Object.values(tree.nodes)) {
      if (!isRecord(node) || node.moduleId !== 'base.loop' || !isRecord(node.props)) continue
      const sourceParam = bindingId(node, 'sourceId')
      const dataSource = node.props.sourceId === 'data.rows' || (sourceParam !== undefined && params.get(sourceParam)?.defaultValue === 'data.rows')
      if (!dataSource) continue
      const native = isRecord(node.props.filters) && Object.hasOwn(node.props.filters, 'query')
      for (const key of CONFIG_KEYS) {
        const paramId = bindingId(node, key)
        if (!paramId || (native && key !== 'filters')) continue
        const index = raw.findIndex(param => compiledCheck(ParamSchema, param) && param.id === paramId)
        const parameter = params.get(paramId)
        if (native && parameter && compiledCheck(DataLoopDefinitionSchema, parameter.defaultValue)) {
          attempt(parameter.defaultValue, () => validateDefinition(parameter.defaultValue, `${path}.${index}.defaultValue`))
        } else record(index < 0 ? path : `${path}.${index}.defaultValue`, 'A component parameter supplies legacy loop configuration that requires a complete field-aware rewrite', 'unbound_loop_query')
      }
    }
    const values = raw.map((param, index) => {
      if (!compiledCheck(ParamSchema, param) || param.type !== 'slot') return param
      if (!Array.isArray(param.defaultValue)) {
        if (param.defaultValue !== '' && param.defaultValue !== null && param.defaultValue !== undefined) record(`${path}.${index}.defaultValue`, 'The slot default requires the canonical flat node array')
        return param
      }
      const defaults = param.defaultValue
      const nodes = defaults.map((node, nodeIndex) => migrateNode(node, `${path}.${index}.defaultValue.${nodeIndex}`, params))
      return nodes.some((node, nodeIndex) => node !== defaults[nodeIndex]) ? { ...param, defaultValue: nodes } : param
    })
    return values.some((param, index) => param !== raw[index]) ? values : raw
  })
  const paramMap = (raw: unknown): Map<string, Static<typeof ParamSchema>> => new Map(Array.isArray(raw)
    ? raw.flatMap(param => compiledCheck(ParamSchema, param) ? [[param.id, param] as const] : []) : [])
  const migrateComponent = (raw: unknown, path: string): unknown => attempt(raw, () => {
    if (!compiledCheck(ComponentSchema, raw)) invalid(path, 'The persisted component is malformed')
    const params = migrateParams(raw.params, raw.tree, `${path}.params`)
    const tree = migrateTree(raw.tree, `${path}.tree`, paramMap(raw.params))
    return params !== raw.params || tree !== raw.tree ? { ...raw, params, tree } : raw
  })

  let value: unknown = carrier.value
  if (carrier.kind === 'nodeTree') value = migrateTree(value, carrier.path)
  else if (carrier.kind === 'cells') value = attempt(value, () => {
    const table = getTable(carrier.tableId, `${carrier.path}.tableId`)
    if (!isRecord(carrier.value)) invalid(carrier.path, 'The persisted row cells are malformed')
    const original = carrier.value
    const cells = { ...original }
    for (const field of table.fields) if (field.type === 'pageTree' && cells[field.id] != null) {
      cells[field.id] = migrateTree(cells[field.id], `${carrier.path}.${field.id}`, table.kind === 'component' ? paramMap(cells.params) : undefined)
    }
    if (table.kind === 'component' && Object.hasOwn(cells, 'params')) cells.params = migrateParams(cells.params, original.body, `${carrier.path}.params`)
    return Object.keys(cells).some(key => cells[key] !== original[key]) ? cells : original
  })
  else value = attempt(value, () => {
    if (!compiledCheck(SnapshotSchema, carrier.value)) invalid(carrier.path, 'The persisted site snapshot is malformed')
    const original = carrier.value
    const pages = original.pages.map((page, index) => migrateTree(page, `${carrier.path}.pages.${index}`))
    const visualComponents = original.visualComponents.map((component, index) => migrateComponent(component, `${carrier.path}.visualComponents.${index}`))
    const layouts = original.layouts.map((layout, index) => migrateTree(layout, `${carrier.path}.layouts.${index}`))
    return pages.some((page, index) => page !== original.pages[index]) || visualComponents.some((component, index) => component !== original.visualComponents[index]) || layouts.some((layout, index) => layout !== original.layouts[index])
      ? { ...original, pages, visualComponents, layouts } : original
  })
  return { value, changed: value !== carrier.value, issues }
}
