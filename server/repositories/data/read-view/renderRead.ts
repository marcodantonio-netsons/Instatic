import type { Page, PageNode, SiteDocument } from '@core/page-tree'
import type { DataField, DataTable } from '@core/data/schemas'
import {
  DATA_QUERY_LIMITS, RelationResolutionError, RelationValidationError,
  readRelationRepeaterValue, relationReadKey, selectDataCollectionEntries,
  type DataCollectionQuery, type RelationMaterializationRequest,
  dataLoopIntegrityQueries, assertDataLoopUrlDeclarations,
} from '@core/data-read'
import { dataEntryToLoopItem, loopReadKey, type LoopItem, type LoopFetchResult } from '@core/loops'
import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import { effectiveNodeBindings, parseTokenString, type TemplateRenderDataContext } from '@core/templates'
import { walkRenderTree, type RenderTreeFrame, type RenderTreeWalkOptions } from '@core/visualComponents'
import { assertLoopSourceConfiguration, type ResolvedLoopRenderData } from '@core/publisher'
import type { DataReadSnapshot } from './snapshot'
import { materializeDataRelations } from './materialize'
import { readDataCollectionCandidates } from './query'
import { projectDataMediaCells, readDataMediaIds } from '@core/data/mediaCells'
import { assertRelationReadDemand } from './authority'

/** Schema admission carries no invented row, value, or editable entry fields. */
export interface DataRenderEntryShape {
  tableId: string
  fields: readonly DataField[]
  repeaterFieldId?: string
}

interface ReadLane {
  nodes: Page['nodes']
  rootNodeId: string
  context: TemplateRenderDataContext
  walk: RenderTreeWalkOptions
  depth: number
  entryShape?: DataRenderEntryShape
  /** Missing positions are recorded separately from the actual render stack. */
  entryAvailability: readonly boolean[]
}

interface LoopDemand {
  node: PageNode
  frame: RenderTreeFrame
  lane: ReadLane
  key: string
  offset: number
  limit: number
  pageNumber: number
  infinite: boolean
  query?: DataCollectionQuery
  table?: DataTable
  relation?: RelationMaterializationRequest
  result?: LoopFetchResult
  integrityItems?: Array<{ item: LoopItem; context: TemplateRenderDataContext }>
  allVariants?: boolean
  childShape?: DataRenderEntryShape
}

export interface DataRenderReadOptions {
  /** Integrity includes later infinite pages, using their real variant positions. */
  mode: 'render' | 'targets' | 'integrity'
  contexts: readonly TemplateRenderDataContext[]
  /** Integrity-only schema admission when an entry route has no actual rows. */
  schemaContexts?: readonly { context: TemplateRenderDataContext; entryShape: DataRenderEntryShape }[]
  rootNodeId?: string
  /** Resume a real fragment frame; the canonical walker retains VC/slot identity. */
  walk?: RenderTreeWalkOptions
  queryForLoop: (node: PageNode, snapshot: DataReadSnapshot) => Promise<DataCollectionQuery>
  pageNumber?: (node: PageNode, frame: RenderTreeFrame, context: TemplateRenderDataContext) => number
  /** Other registered sources use this same traversal, with their native result. */
  readSource: (node: PageNode, context: TemplateRenderDataContext) => Promise<LoopFetchResult>
  onTable?: (table: DataTable) => void
  onRelation?: (edge: { sourceTableId: string; fieldId: string; repeaterFieldId?: string; targetTableId: string }) => void
  /** Includes explicit deferred schema lanes; does not claim a render target. */
  onDeclarationNode?: (node: PageNode, frame: RenderTreeFrame) => void
  /** Fragment targets are registered only from this actual materialized tree. */
  onNode?: (node: PageNode, frame: RenderTreeFrame, context: TemplateRenderDataContext) => void
}

function pageSlice(node: PageNode, frame: RenderTreeFrame, context: TemplateRenderDataContext, options: DataRenderReadOptions) {
  const integer = (key: string, fallback: number, minimum: number): number => {
    const value = node.props[key] ?? fallback
    if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || (key !== 'offset' && value > DATA_QUERY_LIMITS.pageSize)) {
      throw new RelationValidationError(`nodes.${node.id}.props.${key}`, 'invalid_collection_query', 'The loop page is outside the native limit')
    }
    return value
  }
  const infinite = node.props.pagination === 'infinite'
  const pageNumber = infinite ? options.pageNumber?.(node, frame, context) ?? 1 : 1
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) throw new RelationValidationError(`nodes.${node.id}`, 'invalid_collection_query', 'The loop page must be a positive integer')
  const limit = integer(infinite ? 'pageSize' : 'limit', 10, 1)
  const offset = integer('offset', 0, 0) + (pageNumber - 1) * limit
  if (!Number.isSafeInteger(offset) || offset > 1_000_000) throw new RelationValidationError(`nodes.${node.id}`, 'query_limit', 'The loop offset exceeds the native limit')
  return { infinite, pageNumber, limit, offset }
}

function currentEntryShape(demand: LoopDemand): DataRenderEntryShape | undefined {
  const stack = demand.lane.context.entryStack
  const frame = demand.lane.entryAvailability.at(-1) === false ? undefined : stack.at(-1)?.dataEntry
  return frame ? { tableId: frame.reference.tableId, fields: frame.fields,
    ...(frame.reference.repeater ? { repeaterFieldId: frame.reference.repeater.fieldId } : {}),
  } : demand.lane.entryShape
}

async function entryFieldDemand(
  demand: LoopDemand, snapshot: DataReadSnapshot, options: DataRenderReadOptions,
): Promise<void> {
  const shape = currentEntryShape(demand)
  if (!shape) throw new RelationValidationError(`nodes.${demand.frame.id}`, 'unbound_entry', 'This field loop requires a native entry frame or its explicit collection schema')
  const filters = safeParseValue(Type.Object({ fieldId: Type.String({ minLength: 1 }) }), demand.node.props.filters)
  if (!filters.ok) throw new RelationValidationError(`nodes.${demand.frame.id}.props.filters.fieldId`, 'invalid_relation_field', 'Choose an existing entry field')
  const field = shape.fields.find(candidate => candidate.id === filters.value.fieldId)
  if (!field) throw new RelationValidationError(`nodes.${demand.frame.id}.props.filters.fieldId`, 'invalid_relation_field', 'Choose an existing entry field')
  const entry = demand.lane.entryAvailability.at(-1) === false ? undefined : demand.lane.context.entryStack.at(-1)
  const frame = entry?.dataEntry
  if (field.type === 'relation') {
    const source = await snapshot.table(shape.tableId)
    const target = await snapshot.table(field.targetTableId)
    await snapshot.assertTableLanguage(target)
    assertRelationReadDemand(snapshot.authority, source.id, { fieldId: field.id,
      ...(shape.repeaterFieldId ? { repeater: { fieldId: shape.repeaterFieldId } } : {}),
    }, target.id, `nodes.${demand.frame.id}.props.filters.fieldId`)
    options.onTable?.(source)
    options.onTable?.(target)
    options.onRelation?.({ sourceTableId: source.id, fieldId: field.id, targetTableId: target.id,
      ...(shape.repeaterFieldId ? { repeaterFieldId: shape.repeaterFieldId } : {}),
    })
    demand.childShape = { tableId: target.id, fields: target.fields }
    if (frame) demand.relation = { owner: frame.reference, field: { fieldId: field.id } }
    else demand.result = { items: [], totalItems: 0 }
    return
  }
  if (field.type === 'repeater') {
    demand.childShape = { tableId: shape.tableId, fields: field.fields, repeaterFieldId: field.id }
    const items = frame ? readRelationRepeaterValue(frame.cells[field.id], `entries.${entry!.id}.${field.id}`).map((item, index): LoopItem => ({
      id: item.id,
      dataEntry: { reference: { ...frame.reference, repeater: { fieldId: field.id, itemId: item.id } }, fields: structuredClone(field.fields), cells: structuredClone(item.cells), media: structuredClone(frame.media) },
      fields: { ...projectDataMediaCells(item.cells, field.fields, frame.media), id: item.id, value: structuredClone(item.cells), index },
    })) : []
    demand.result = { items, totalItems: items.length }
    return
  }
  if (field.type !== 'multiSelect' && !(field.type === 'media' && field.allowMultiple === true)) {
    throw new RelationValidationError(`nodes.${demand.frame.id}.props.filters.fieldId`, 'invalid_relation_field', 'The selected field is not an iterable collection')
  }
  if (!frame) { demand.result = { items: [], totalItems: 0 }; return }
  const value = frame.cells[field.id]
  if (field.type === 'media') {
    const ids = readDataMediaIds(value, true, `entries.${entry!.id}.${field.id}`)
    demand.result = { items: ids.map((id, index) => {
      const media = frame.media[id]
      if (!media) throw new RelationResolutionError(`entries.${entry!.id}.${field.id}`, 'relation_unavailable', 'A referenced media asset is unavailable')
      return { id: `${entry!.id}:${field.id}:${index}`, fields: { id, value: media.publicPath, src: media.publicPath, url: media.publicPath, path: media.publicPath, ...media, index } }
    }), totalItems: ids.length }
    return
  }
  const parsed = safeParseValue(Type.Array(Type.String()), value ?? [])
  if (!parsed.ok) throw new RelationValidationError(`entries.${entry!.id}.${field.id}`, 'invalid_relation_value', 'Collection values must be an ordered array of strings')
  const values = parsed.value
  demand.result = { items: values.map((member, index) => ({ id: `${entry!.id}:${field.id}:${index}`, fields: { value: member, index } })), totalItems: values.length }
}

/**
 * One actual-entry traversal for prefetch, admission and active-plan integrity.
 * Pause the canonical VC/slot walker at each loop, batch the next relation
 * level, then resume only materialized variants with immutable real frames.
 */
export async function readDataRenderTree(
  snapshot: DataReadSnapshot, page: Page, site: SiteDocument, options: DataRenderReadOptions,
): Promise<Map<string, ResolvedLoopRenderData>> {
  if (options.schemaContexts?.length && options.mode !== 'integrity') throw new RelationValidationError('tree', 'unbound_entry', 'Schema-only entry contexts are not renderable rows')
  let lanes: ReadLane[] = options.contexts.map(context => ({ nodes: page.nodes, rootNodeId: options.rootNodeId ?? page.rootNodeId,
    context, walk: options.walk ?? {}, depth: 0, entryAvailability: context.entryStack.map(() => true),
  }))
  for (const deferred of options.schemaContexts ?? []) lanes.push({ nodes: page.nodes, rootNodeId: options.rootNodeId ?? page.rootNodeId,
    context: deferred.context, walk: options.walk ?? {}, depth: 0, entryShape: deferred.entryShape,
    entryAvailability: [...deferred.context.entryStack.map(() => true), false],
  })
  const results = new Map<string, ResolvedLoopRenderData>()
  let demandCount = 0
  while (lanes.length) {
    const demands: LoopDemand[] = []
    for (const lane of lanes) {
      if (lane.depth > DATA_QUERY_LIMITS.depth) throw new RelationResolutionError('tree', 'query_limit', 'The native data demand exceeds the nesting limit')
      walkRenderTree(lane.nodes, lane.rootNodeId, site.visualComponents, (node, frame) => {
        if (options.mode === 'integrity' && node.moduleId === 'base.visual-component-ref') {
          const authored = frame.nodes[node.id]
          const binding = effectiveNodeBindings(authored ?? node)?.componentId
          const queryBinding = binding?.source === 'route' && (binding.field === 'query' || binding.field.startsWith('query.'))
          const componentId = authored?.props.componentId
          const queryToken = typeof componentId === 'string' && parseTokenString(componentId).some(segment =>
            segment.kind === 'token' && segment.source === 'route' && (segment.field === 'query' || segment.field.startsWith('query.')))
          const absentEntrySource = (source: string) => source === 'currentEntry' ? lane.entryAvailability.at(-1) === false
            : source === 'parentEntry' && lane.entryAvailability.at(-2) === false
          const deferredSelection = (binding && absentEntrySource(binding.source)) || (typeof componentId === 'string' &&
            parseTokenString(componentId).some(segment => segment.kind === 'token' && absentEntrySource(segment.source)))
          if (deferredSelection) throw new RelationValidationError(`nodes.${frame.id}.props.componentId`, 'unbound_entry', 'A component selection from an absent entry cannot be certified; choose a fixed component')
          if (queryBinding || queryToken) throw new RelationValidationError(`nodes.${frame.id}.props.componentId`, 'invalid_collection_query', 'A published component selection needs a fixed component or a real entry value; arbitrary visitor component identities cannot be certified')
        }
        options.onDeclarationNode?.(node, frame)
        if (!lane.entryAvailability.includes(false)) options.onNode?.(node, frame, lane.context)
        if (node.moduleId !== 'base.loop') return
        assertLoopSourceConfiguration(page, { node, nodes: frame.nodes, nested: frame.ancestors.some(ancestor => ancestor.moduleId === 'base.loop') })
        if (++demandCount > DATA_QUERY_LIMITS.demands) throw new RelationResolutionError('tree', 'query_limit', 'The native data demand exceeds the iteration limit')
        demands.push({ node, frame, lane, key: loopReadKey(frame.id, lane.context.entryStack), ...pageSlice(node, frame, lane.context, options) })
      }, lane.context, { ...lane.walk, shouldDescend: node => node.moduleId !== 'base.loop' })
    }

    await Promise.all(demands.map(async demand => {
      if (demand.node.props.sourceId === 'data.rows') {
        demand.query = await options.queryForLoop(demand.node, snapshot)
        demand.limit = demand.query.limit
        demand.offset = demand.query.offset + (demand.pageNumber - 1) * demand.limit
        const candidates = await readDataCollectionCandidates(snapshot, demand.query.source)
        for (const table of candidates.tables) options.onTable?.(table)
        for (const relation of candidates.relations) options.onRelation?.(relation)
        demand.table = candidates.table
        demand.childShape = { tableId: candidates.table.id, fields: candidates.table.fields }
        assertDataLoopUrlDeclarations(demand.node, candidates.table.fields)
        const matching = selectDataCollectionEntries(candidates.items, demand.query, candidates.table.fields, snapshot.language)
        demand.result = { items: matching.map(dataEntryToLoopItem), totalItems: matching.length }
        if (options.mode === 'integrity') {
          const integrity = dataLoopIntegrityQueries(demand.node)
          demand.allVariants = integrity.allVariants
          demand.integrityItems = []
          for (const state of integrity.states) {
            const source = await readDataCollectionCandidates(snapshot, state.query.source)
            for (const table of source.tables) options.onTable?.(table)
            for (const relation of source.relations) options.onRelation?.(relation)
            assertDataLoopUrlDeclarations(demand.node, source.table.fields)
            const members = selectDataCollectionEntries(source.items, state.query, source.table.fields, snapshot.language)
            const selectedMembers = demand.infinite || demand.allVariants ? members.slice(demand.query.offset) : members.slice(demand.offset, demand.offset + demand.limit)
            const context = { ...demand.lane.context, ...(demand.lane.context.route ? {
              route: { ...demand.lane.context.route, query: { ...demand.lane.context.route.query, ...state.inputs } },
            } : {}) }
            demand.integrityItems.push(...selectedMembers.map(member => ({ item: dataEntryToLoopItem(member), context })))
          }
        }
      } else if (demand.node.props.sourceId === 'entry.field') {
        await entryFieldDemand(demand, snapshot, options)
      } else {
        demand.result = await options.readSource(demand.node, demand.lane.context)
      }
    }))

    const requests = demands.flatMap(demand => demand.relation ? [demand.relation] : [])
    const relations = await materializeDataRelations(snapshot, requests)
    for (const demand of demands) {
      if (!demand.relation) continue
      const relation = relations.get(relationReadKey(demand.relation.owner, demand.relation.field))!
      const target = await snapshot.table(relation.targetTableId)
      options.onTable?.(target)
      options.onRelation?.({ sourceTableId: relation.owner.tableId, fieldId: relation.field.fieldId,
        ...(relation.owner.repeater ? { repeaterFieldId: relation.owner.repeater.fieldId } : {}), targetTableId: target.id })
      demand.result = { items: relation.items.map(dataEntryToLoopItem), totalItems: relation.totalItems }
    }

    const next: ReadLane[] = []
    for (const demand of demands) {
      const source = demand.result!
      const ordered = demand.node.props.sourceId === 'entry.field' && demand.node.props.direction === 'desc' ? [...source.items].reverse() : source.items
      const selected = ordered.slice(demand.offset, demand.offset + demand.limit)
      const value = { items: selected, totalItems: source.totalItems, pageNumber: demand.pageNumber,
        hasMore: demand.infinite && demand.offset + selected.length < source.totalItems }
      const previous = results.get(demand.key)
      if (options.mode === 'render' && previous && JSON.stringify(previous) !== JSON.stringify(value)) throw new RelationValidationError(`nodes.${demand.frame.id}`, 'invalid_collection_query', 'One render frame has conflicting loop reads')
      if (!demand.lane.entryAvailability.includes(false)) results.set(demand.key, value)
      const children = demand.node.children
      if (!children.length) continue
      const items = demand.integrityItems ?? (options.mode !== 'render' && demand.infinite ? ordered.slice(demand.offset) : selected).map(item => ({ item, context: demand.lane.context }))
      const resumeWalk = { prefix: demand.frame.id.slice(0, -demand.node.id.length), parentId: demand.frame.id,
        ancestors: [...demand.frame.ancestors, demand.node], componentIds: demand.frame.componentIds,
        ancestorNodeIds: new Set(demand.frame.ancestorNodeIds).add(demand.node.id),
      }
      // A currently empty collection still admits every authored variant's
      // declared schema and fixed child queries. It never supplies a sample row.
      if (options.mode === 'integrity' && !items.length) for (const variant of children) next.push({
        nodes: demand.frame.nodes, rootNodeId: variant, context: demand.lane.context,
        depth: demand.lane.depth + 1, walk: resumeWalk, entryShape: demand.childShape,
        entryAvailability: [...demand.lane.entryAvailability, false],
      })
      for (let index = 0; index < items.length; index++) {
        // Every future infinite page starts its own round-robin at zero,
        // exactly as the renderer and continuation do.
        const position = options.mode !== 'render' && demand.infinite ? index % demand.limit : index
        const variants = demand.allVariants ? children : [children[position % children.length]]
        for (const variant of variants) next.push({ nodes: demand.frame.nodes, rootNodeId: variant,
          context: { ...items[index].context, entryStack: [...items[index].context.entryStack, items[index].item] },
          depth: demand.lane.depth + 1,
          walk: resumeWalk, entryShape: items[index].item.dataEntry ? { tableId: items[index].item.dataEntry!.reference.tableId,
            fields: items[index].item.dataEntry!.fields,
            ...(items[index].item.dataEntry!.reference.repeater ? { repeaterFieldId: items[index].item.dataEntry!.reference.repeater!.fieldId } : {}),
          } : undefined,
          entryAvailability: [...demand.lane.entryAvailability, true],
        })
      }
    }
    lanes = next
  }
  await snapshot.assertFresh()
  return results
}
