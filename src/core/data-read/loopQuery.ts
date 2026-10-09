import type { PageNode } from '@core/page-tree-schema'
import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'
import { DataCollectionQuerySchema, DataQueryUrlInputSchema } from './querySchema'
import { decodeDataQueryUrlInputs } from './urlInputs'
import { RelationValidationError } from './errors'
import { assertDataCollectionQuery } from './query'
import type { DataField } from '@core/data/schemas'
import { DATA_QUERY_LIMITS, type DataCollectionQuery } from './querySchema'

/** The loop owns pagination; its source owns only collection operands. */
export const DataLoopDefinitionSchema = Type.Object({
  query: Type.Omit(DataCollectionQuerySchema, ['offset', 'limit']),
  urlInputs: Type.Optional(Type.Array(DataQueryUrlInputSchema)),
}, { additionalProperties: false })
export type DataLoopDefinition = Static<typeof DataLoopDefinitionSchema>

function readDefinition(node: PageNode) {
  const path = `nodes.${node.id}.props.filters`
  const parsed = safeParseValue(DataLoopDefinitionSchema, node.props.filters)
  if (!parsed.ok) throw new RelationValidationError(path + (parsed.errors[0]?.path ?? ''), 'invalid_collection_query', parsed.errors[0]?.message ?? 'Invalid collection query')
  const infinite = node.props.pagination === 'infinite'
  const limit = node.props[infinite ? 'pageSize' : 'limit'] ?? 10
  const offset = node.props.offset ?? 0
  const query = safeParseValue(DataCollectionQuerySchema, { ...parsed.value.query, limit, offset })
  if (!query.ok) throw new RelationValidationError(path + (query.errors[0]?.path ?? ''), 'invalid_collection_query', query.errors[0]?.message ?? 'Invalid collection page')
  // Declaration conflicts are configuration errors even when the URL is empty.
  decodeDataQueryUrlInputs(query.value, parsed.value.urlInputs ?? [], new URLSearchParams())
  return { definition: parsed.value, query: query.value }
}

export function readDataLoopQuery(node: PageNode, params = new URLSearchParams()) {
  const { definition, query } = readDefinition(node)
  return decodeDataQueryUrlInputs(query, definition.urlInputs ?? [], params)
}

/** Finite relation-owner choices and a broad search envelope cover later visitor reads. */
export function dataLoopIntegrityQueries(node: PageNode): {
  states: Array<{ query: DataCollectionQuery; inputs: Record<string, string> }>
  allVariants: boolean
} {
  const { definition, query } = readDefinition(node)
  if (definition.urlInputs?.some(input => input.operand === 'search') && query.search) query.search.text = ''
  const states = [{ query, inputs: {} }]
  for (const input of definition.urlInputs ?? []) {
    if (input.operand !== 'relationOwner') continue
    for (const rowId of input.allowedRowIds) {
      if (states.length >= DATA_QUERY_LIMITS.demands) throw new RelationValidationError(`nodes.${node.id}`, 'query_limit', 'The declared relation choices exceed the native demand limit')
      states.push({ query: { ...structuredClone(query), source: {
        kind: 'relation', owner: { tableId: input.ownerTableId, rowId }, field: structuredClone(input.field),
      } }, inputs: { [input.parameter]: rowId } })
    }
  }
  return { states, allVariants: Boolean(definition.urlInputs?.length) }
}

/** Validate every declared operand against the actual authorized target schema, even at zero matches. */
export function assertDataLoopUrlDeclarations(node: PageNode, fields: readonly DataField[]): void {
  const { definition, query } = readDefinition(node)
  let choices = 0
  for (const input of definition.urlInputs ?? []) {
    if (input.operand !== 'predicate') continue
    for (const value of input.allowedValues) {
      if (++choices > DATA_QUERY_LIMITS.membership) throw new RelationValidationError(`nodes.${node.id}`, 'query_limit', 'The declared predicate choices exceed the native limit')
      const decoded = decodeDataQueryUrlInputs(query, definition.urlInputs ?? [], new URLSearchParams([[input.parameter, value]]))
      assertDataCollectionQuery(decoded.query, fields)
    }
  }
}

/** Query dependencies come from the same validated persisted definition. */
export function dataLoopQueryParameterNames(node: PageNode): string[] {
  return (readDefinition(node).definition.urlInputs ?? []).map(input => input.parameter)
}
