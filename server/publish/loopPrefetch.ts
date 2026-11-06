import type { Page, PageNode, SiteDocument } from '@core/page-tree'
import { loopPageQueryKey, type SourceRequestContext } from '@core/loops'
import type { TemplateRenderDataContext } from '@core/templates'
import type { RenderTreeFrame, RenderTreeWalkOptions } from '@core/visualComponents'
import { RelationValidationError, readDataLoopQuery, type DataRenderQueryInputs } from '@core/data-read'
import { Type, Value, safeParseValue, type Static } from '@core/utils/typeboxHelpers'
import { readDataRenderView, readRegisteredLoopSource, type DataReadSnapshot } from '../repositories/data'

const LoopSourcePropsSchema = Type.Object({
  sourceId: Type.String({ minLength: 1 }), filters: Type.Record(Type.String(), Type.Unknown(), { default: {} }),
  orderBy: Type.String({ default: '' }), direction: Type.Union([Type.Literal('asc'), Type.Literal('desc')], { default: 'desc' }),
  limit: Type.Integer({ minimum: 1, maximum: 500, default: 10 }),
  offset: Type.Integer({ minimum: 0, maximum: 1_000_000, default: 0 }),
  pagination: Type.Union([Type.Literal('none'), Type.Literal('infinite')], { default: 'none' }),
  pageSize: Type.Integer({ minimum: 1, maximum: 500, default: 10 }),
})
export type LoopSourceProps = Static<typeof LoopSourcePropsSchema>

/** Defaults apply only to absent properties; malformed authored values stay errors. */
export function readLoopProps(node: PageNode): LoopSourceProps {
  const props = Value.Default(LoopSourcePropsSchema, structuredClone(node.props))
  const parsed = safeParseValue(LoopSourcePropsSchema, props)
  if (!parsed.ok) throw new RelationValidationError(`nodes.${node.id}.props${parsed.errors[0]?.path ?? ''}`, 'invalid_collection_query', parsed.errors[0]?.message ?? 'Invalid loop configuration')
  return parsed.value
}

export function readLoopPageNumber(params: URLSearchParams, nodeId: string): number {
  const key = loopPageQueryKey(nodeId)
  const values = params.getAll(key)
  if (!values.length) return 1
  if (values.length !== 1 || !/^[1-9][0-9]*$/.test(values[0])) throw new RelationValidationError(key, 'invalid_collection_query', 'The loop page requires one positive integer')
  const page = Number(values[0])
  if (!Number.isSafeInteger(page)) throw new RelationValidationError(key, 'query_limit', 'The loop page exceeds the native limit')
  return page
}

/** Native query declarations determine which visitor inputs affect this render. */
export function canonicalRenderQuery(params: URLSearchParams, inputs: DataRenderQueryInputs): string {
  const allowed = inputs.kind === 'declared' ? new Set(inputs.names) : undefined
  const kept = [...params].filter(([name]) => !allowed || allowed.has(name))
  kept.sort(([left, leftValue], [right, rightValue]) => left === right ? leftValue.localeCompare(rightValue) : left.localeCompare(right))
  return kept.length ? `?${new URLSearchParams(kept).toString()}` : ''
}

/** The public renderer, fragment resolver and authoring preview share this actual-entry read. */
export async function prefetchLoopReadView(
  page: Page, site: SiteDocument, snapshot: DataReadSnapshot, url: URL | undefined,
  options: {
    templateContext: TemplateRenderDataContext
    request?: SourceRequestContext
    rootNodeId?: string
    mode?: 'render' | 'targets' | 'integrity'
    walk?: RenderTreeWalkOptions
    /** Continuation changes the selected real instance, never its native identity. */
    pageNumber?: (node: PageNode, frame: RenderTreeFrame, context: TemplateRenderDataContext) => number
  },
) {
  const params = url?.searchParams ?? new URLSearchParams()
  return readDataRenderView(snapshot, page, site, {
    mode: options.mode ?? 'render', contexts: [options.templateContext], rootNodeId: options.rootNodeId, walk: options.walk,
    queryForLoop: async node => readDataLoopQuery(node, params).query,
    pageNumber: options.pageNumber ?? (node => readLoopPageNumber(params, node.id)),
    readSource: (node, context) => readRegisteredLoopSource(snapshot, site, node, context, options.request),
  })
}
