import type { PageNode, SiteDocument } from '@core/page-tree'
import { loopSourceRegistry, LoopFetchResultSchema, type SourceRequestContext } from '@core/loops'
import type { TemplateRenderDataContext } from '@core/templates'
import { DATA_QUERY_LIMITS, RelationValidationError, RelationResolutionError } from '@core/data-read'
import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { DataReadSnapshot } from './snapshot'

/** Registered non-data sources participate in the same actual-entry walk. */
export async function readRegisteredLoopSource(
  snapshot: DataReadSnapshot, site: SiteDocument, node: PageNode,
  context: TemplateRenderDataContext, request?: SourceRequestContext,
) {
  const path = `nodes.${node.id}.props.sourceId`
  const source = typeof node.props.sourceId === 'string' ? loopSourceRegistry.get(node.props.sourceId) : undefined
  if (!source || source.kind === 'contextual' || source.id === 'data.rows') {
    throw new RelationValidationError(path, 'invalid_collection_query', 'Choose a registered loop source')
  }
  const filters = safeParseValue(Type.Record(Type.String(), Type.Unknown()), node.props.filters ?? {})
  if (!filters.ok) throw new RelationValidationError(path, 'invalid_collection_query', 'Invalid loop source filters')
  const parsed = safeParseValue(LoopFetchResultSchema, await source.fetch({
    db: snapshot.db, site, filters: filters.value,
    orderBy: typeof node.props.orderBy === 'string' && node.props.orderBy ? node.props.orderBy : source.orderByOptions[0]?.id ?? '',
    direction: node.props.direction === 'asc' ? 'asc' : 'desc',
    limit: DATA_QUERY_LIMITS.candidates, offset: 0,
    branchId: snapshot.scope.branchId, drafts: snapshot.view === 'draft', request,
    localization: context.site?.language ? { language: context.site.language, translations: context.site.translations } : undefined,
  }))
  if (!parsed.ok) throw new RelationValidationError(path, 'invalid_collection_query', 'The registered source returned invalid loop entries')
  if (parsed.value.totalItems > DATA_QUERY_LIMITS.candidates || parsed.value.items.length !== parsed.value.totalItems) {
    throw new RelationResolutionError(path, 'query_limit', 'The registered source must provide its complete bounded collection')
  }
  if (parsed.value.items.some(item => item.dataEntry !== undefined)) {
    throw new RelationValidationError(path, 'unbound_entry', 'Registered source values cannot claim native row provenance')
  }
  const ids = parsed.value.items.map(item => item.id)
  if (ids.some(id => !id.trim() || id !== id.trim()) || new Set(ids).size !== ids.length) {
    throw new RelationValidationError(path, 'invalid_collection_query', 'Registered entries require distinct nonempty identities')
  }
  return parsed.value
}
