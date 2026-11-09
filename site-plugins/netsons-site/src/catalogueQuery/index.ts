import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { ServerPluginApi } from '@instatic/plugin-sdk'
import { languageFromPath } from '../localization'
import { projectCatalogueMatrix } from './pivot'
import {
  CATALOGUE_QUERY_CONFIGS,
  isCatalogueQueryConfigId,
  type CatalogueQueryConfig,
  type CatalogueQueryConfigId,
} from './config'
import { CatalogueEntrySchema, CatalogueQueryError, localizeCatalogueCells, queryRows, type CatalogueEntry } from './query'

export const CATALOGUE_QUERY_SOURCE_ID = 'netsons.site.catalogue-query'
export const CATALOGUE_COUNT_ROUTE_PATH = '/catalogue-query/count'
export const CATALOGUE_QUERY_CONTENT_TABLES = [
  'netsons-sitemap',
  'netsons-domains',
  'netsons-knowledge',
  'netsons-catalog',
] as const

const PageSchema = Type.Object({
  entries: Type.Array(CatalogueEntrySchema),
  totalCount: Type.Integer({ minimum: 0 }),
})
const TableSchema = Type.Object({ routeBase: Type.String() })
const RequestContextSchema = Type.Object({
  query: Type.Record(
    Type.String({ minLength: 1, maxLength: 128 }),
    Type.String({ maxLength: 2048 }),
    { maxProperties: 64 },
  ),
  path: Type.String({ minLength: 1 }),
  slug: Type.Union([Type.String(), Type.Null()]),
  cookies: Type.Optional(Type.Record(Type.String(), Type.String())),
})
const FetchContextSchema = Type.Object({
  filters: Type.Record(Type.String(), Type.Unknown()),
  orderBy: Type.String({ minLength: 1 }),
  direction: Type.Union([Type.Literal('asc'), Type.Literal('desc')]),
  limit: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000000 })),
  request: Type.Optional(RequestContextSchema),
})
const LoopFiltersSchema = Type.Object({ configId: Type.String({ minLength: 1 }) }, { additionalProperties: false })
const CountBodySchema = Type.Object({
  config: Type.String({ minLength: 1, maxLength: 128 }),
  path: Type.String({ minLength: 1, maxLength: 4096 }),
  query: Type.Record(Type.String({ minLength: 1, maxLength: 128 }), Type.String({ maxLength: 2048 }), { maxProperties: 16 }),
}, { additionalProperties: false })

type PluginApi = ServerPluginApi
function readConfigId(filters: unknown): CatalogueQueryConfigId {
  if (!Value.Check(LoopFiltersSchema, filters)) throw new Error('Loop must select one fixed catalogue query')
  const configId = Value.Parse(LoopFiltersSchema, filters).configId
  if (!isCatalogueQueryConfigId(configId)) throw new Error('Unknown catalogue query configuration')
  return configId
}

function assertTableSlug(value: string): asserts value is (typeof CATALOGUE_QUERY_CONTENT_TABLES)[number] {
  if (!(CATALOGUE_QUERY_CONTENT_TABLES as readonly string[]).includes(value)) throw new Error('Catalogue query table is not allowlisted')
}

async function readCatalogueEntries(api: PluginApi, tableSlug: string): Promise<CatalogueEntry[]> {
  assertTableSlug(tableSlug)
  const table = await api.cms.content.tables.get(tableSlug)
  if (!table || !Value.Check(TableSchema, table)) throw new Error(`Catalogue table ${tableSlug} is unavailable`)
  const list = api.cms.content.table(tableSlug)
  const entries: CatalogueEntry[] = []
  const limit = 500
  let offset = 0
  let expectedTotal: number | undefined
  while (expectedTotal === undefined || offset < expectedTotal) {
    const rawPage = await list.list({ status: 'any', limit, offset })
    if (!Value.Check(PageSchema, rawPage)) throw new Error(`Invalid catalogue entries from ${tableSlug}`)
    const page = Value.Parse(PageSchema, rawPage)
    if (expectedTotal === undefined) expectedTotal = page.totalCount
    if (page.totalCount !== expectedTotal) throw new Error(`Catalogue ${tableSlug} changed during pagination`)
    if (page.entries.some(entry => entry.tableSlug !== tableSlug)) {
      throw new Error(`Content API returned an entry outside allowlisted table ${tableSlug}`)
    }
    entries.push(...page.entries)
    if (entries.length >= expectedTotal) break
    if (!page.entries.length) throw new Error(`Catalogue ${tableSlug} pagination made no progress`)
    offset += page.entries.length
  }
  if (entries.length !== expectedTotal) throw new Error(`Catalogue ${tableSlug} count changed during pagination`)
  return entries
}

type QueryResult = { items: Array<{ id: string; fields: Record<string, unknown> }>; totalItems: number }

function routeBaseFromTable(api: PluginApi, config: CatalogueQueryConfig): Promise<string> {
  return api.cms.content.tables.get(config.tableSlug).then(table => {
    if (!table || !Value.Check(TableSchema, table)) throw new Error(`Catalogue table ${config.tableSlug} is unavailable`)
    const base = table.routeBase.trim() || `/${config.tableSlug}`
    if (!base || base === '/') return ''
    return `/${base.replace(/^\/+|\/+$/g, '')}`
  })
}

function rowItem(entry: CatalogueEntry, cells: Record<string, unknown>, routeBase: string) {
  const permalink = `${routeBase}/${entry.slug}` || `/${entry.slug}`
  return {
    id: entry.id,
    fields: {
      ...cells,
      id: entry.id,
      rowId: entry.id,
      tableSlug: entry.tableSlug,
      author: null,
      authorName: null,
      authorRoleSlug: null,
      authorRoleName: null,
      publishedBy: null,
      publishedByName: null,
      publishedByRoleSlug: null,
      publishedByRoleName: null,
      featuredMediaId: null,
      featuredMedia: null,
      featuredMediaPath: null,
      featuredMediaUrl: null,
      firstImage: null,
      firstImagePath: null,
      firstImageUrl: null,
      slug: entry.slug,
      publishedAt: entry.publishedAt ?? entry.createdAt,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      permalink,
    },
  }
}

function rowQuery(
  entries: readonly CatalogueEntry[],
  config: CatalogueQueryConfig,
  query: Readonly<Record<string, string>>,
  language: string,
  routeBase: string,
  offset: number,
  limit: number,
  direction: 'asc' | 'desc',
): QueryResult {
  const result = queryRows(entries, config, query, language, direction)
  return {
    items: result.rows.slice(offset, offset + limit).map(row => rowItem(row.entry, row.cells, routeBase)),
    totalItems: result.totalItems,
  }
}

function pivotQuery(
  entries: readonly CatalogueEntry[],
  config: CatalogueQueryConfig,
  query: Readonly<Record<string, string>>,
  language: string,
  offset: number,
  limit: number,
  direction: 'asc' | 'desc',
): QueryResult {
  const orderedEntries = [...entries].sort((a, b) => {
    const left = typeof a.cells.index === 'number' && Number.isFinite(a.cells.index) ? a.cells.index : null
    const right = typeof b.cells.index === 'number' && Number.isFinite(b.cells.index) ? b.cells.index : null
    const order = left === null ? right === null ? 0 : 1 : right === null ? -1 : direction === 'asc' ? left - right : right - left
    return order || a.id.localeCompare(b.id)
  })
  const columns = orderedEntries.map(entry => {
    const localized = localizeCatalogueCells(entry.cells, language)
    return {
    id: entry.id,
    fields: {
      ...localized,
      id: entry.id,
      rowId: entry.id,
      tableSlug: entry.tableSlug,
      slug: entry.slug,
      publishedAt: entry.publishedAt ?? entry.createdAt,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    },
    }
  })
  const result = projectCatalogueMatrix(
    columns,
    { ...config.filters, configId: 'catalogue-comparison', offset, limit },
    query,
    language,
  )
  return result
}

function resolveQuery(
  entries: readonly CatalogueEntry[],
  configId: CatalogueQueryConfigId,
  query: Readonly<Record<string, string>>,
  language: string,
  routeBase: string,
  offset = 0,
  limit = 10,
  direction: 'asc' | 'desc' = 'asc',
): QueryResult {
  const config = CATALOGUE_QUERY_CONFIGS[configId]
  return config.sourceKind === 'rows'
    ? rowQuery(entries, config, query, language, routeBase, offset, limit, direction)
    : pivotQuery(entries, config, query, language, offset, limit, direction)
}

function publicResponse(status: number, body: unknown) {
  return {
    __response: true,
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  }
}

function readCountBody(value: unknown): { configId: CatalogueQueryConfigId; query: Record<string, string>; path: string } | null {
  if (!Value.Check(CountBodySchema, value)) return null
  const body = Value.Parse(CountBodySchema, value)
  if (!isCatalogueQueryConfigId(body.config)) return null
  const config = CATALOGUE_QUERY_CONFIGS[body.config]
  const allowed = new Set(config.visitorBindings.map(binding => binding.queryParameter))
  if (Object.keys(body.query).some(key => !allowed.has(key))) return null
  if (!body.path.startsWith('/') || body.path.startsWith('//') || body.path.includes('?') || body.path.includes('#')) return null
  return { configId: body.config, query: body.query, path: body.path }
}

/** Register the one request-dependent CMS source and its restricted public count route. */
export function registerCatalogueQuery(api: PluginApi): void {
  api.cms.loops.registerSource({
    id: CATALOGUE_QUERY_SOURCE_ID,
    label: 'Netsons catalogue query',
    description: 'Search the Netsons sitemap, domain, knowledge, and plan catalogues.',
    filterSchema: {
      configId: {
        type: 'select',
        label: 'Catalogue query',
        options: Object.keys(CATALOGUE_QUERY_CONFIGS).map(value => ({ value, label: value })),
      },
    },
    orderByOptions: [{ id: 'cell:index', label: 'Catalogue order' }],
    fields: [
      { id: 'id', label: 'Row ID' }, { id: 'rowId', label: 'Row ID' }, { id: 'tableSlug', label: 'Table slug' },
      { id: 'slug', label: 'Slug' }, { id: 'index', label: 'Index' }, { id: 'label', label: 'Label' },
      { id: 'href', label: 'Link', format: 'url' }, { id: 'searchable', label: 'Searchable text' },
      { id: 'groupCode', label: 'Group code' }, { id: 'extension', label: 'Domain extension' },
      { id: 'title', label: 'Title' }, { id: 'excerpt', label: 'Excerpt' }, { id: 'category', label: 'Category' },
      { id: 'categoryId', label: 'Category ID' }, { id: 'permalink', label: 'Permalink', format: 'url' },
      { id: 'publishedAt', label: 'Published date' }, { id: 'createdAt', label: 'Created date' },
      { id: 'updatedAt', label: 'Updated date' }, { id: 'columns', label: 'Matrix columns' },
      { id: 'rows', label: 'Matrix rows' }, { id: 'columnLabel', label: 'Column label' },
      { id: 'hasEmptyColumns', label: 'Empty columns' }, { id: 'columnCount', label: 'Column count' },
      { id: 'colspan', label: 'Column span' }, { id: 'key', label: 'Matrix row key' },
      { id: 'group', label: 'Matrix group' }, { id: 'groupLabel', label: 'Matrix group label' },
      { id: 'cells', label: 'Matrix cells' }, { id: 'isDifferent', label: 'Different values' },
      { id: 'startsGroup', label: 'Starts group' },
    ],
    requestDependent: true,
    async fetch(context: unknown) {
      if (!Value.Check(FetchContextSchema, context)) throw new Error('Invalid catalogue loop context')
      const parsed = Value.Parse(FetchContextSchema, context)
      if (parsed.orderBy !== 'cell:index') throw new Error(`Unsupported catalogue order "${parsed.orderBy}"`)
      const configId = readConfigId(parsed.filters)
      const config = CATALOGUE_QUERY_CONFIGS[configId]
      assertTableSlug(config.tableSlug)
      if (!parsed.request) return { items: [], totalItems: 0 }
      const language = languageFromPath(parsed.request.path)
      const entries = await readCatalogueEntries(api, config.tableSlug)
      const routeBase = config.sourceKind === 'rows' ? await routeBaseFromTable(api, config) : ''
      const offset = parsed.offset ?? 0
      const limit = parsed.limit ?? 10
      return resolveQuery(entries, configId, parsed.request.query, language, routeBase, offset, limit, parsed.direction)
    },
    preview() { return [] },
  })

  api.cms.routes.public.post(CATALOGUE_COUNT_ROUTE_PATH, async ({ body }) => {
    const input = readCountBody(body)
    if (!input) return publicResponse(400, { error: 'Invalid catalogue query parameters' })
    let language: string
    try { language = languageFromPath(input.path) } catch { return publicResponse(400, { error: 'Invalid visitor page path' }) }
    try {
      const config = CATALOGUE_QUERY_CONFIGS[input.configId]
      assertTableSlug(config.tableSlug)
      const entries = await readCatalogueEntries(api, config.tableSlug)
      const routeBase = config.sourceKind === 'rows' ? await routeBaseFromTable(api, config) : ''
      const result = resolveQuery(entries, input.configId, input.query, language, routeBase)
      return { totalItems: result.totalItems }
    } catch (error) {
      if (error instanceof CatalogueQueryError) return publicResponse(400, { error: error.message })
      api.plugin.log('[catalogue-query] Public count failed:', error instanceof Error ? error.message : String(error))
      return publicResponse(500, { error: 'Catalogue query failed' })
    }
  })
}
