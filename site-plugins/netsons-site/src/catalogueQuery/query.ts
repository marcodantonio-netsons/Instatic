/**
 * Pure row filtering and ordering for the fixed Netsons catalogue queries.
 * The normalization and scoring rules mirror Instatic's MIT-licensed
 * `cellFilter` and `cellSearch` helpers, without importing core runtime code.
 */
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { compareLocale } from '../collation'
import { localizeProps, nativeArgumentName } from '../localization'
import type { CatalogueQueryConfig, VisitorBinding } from './config'

export const CatalogueEntrySchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  tableSlug: Type.String({ minLength: 1 }),
  slug: Type.String(),
  status: Type.Union([Type.Literal('draft'), Type.Literal('published'), Type.Literal('unpublished'), Type.Literal('scheduled')]),
  cells: Type.Record(Type.String(), Type.Unknown()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  publishedAt: Type.Union([Type.String(), Type.Null()]),
  scheduledPublishAt: Type.Union([Type.String(), Type.Null()]),
  authorUserId: Type.Union([Type.String(), Type.Null()]),
  pluginActorId: Type.Union([Type.String(), Type.Null()]),
})
const EntryListSchema = Type.Array(CatalogueEntrySchema)
const QuerySchema = Type.Record(
  Type.String({ minLength: 1, maxLength: 128 }),
  Type.String({ maxLength: 2048 }),
  { maxProperties: 64 },
)
const StringArraySchema = Type.Array(Type.String({ maxLength: 256 }), { maxItems: 1000 })
const SearchSchema = Type.Object({
  rank: Type.Union([Type.Literal('source'), Type.Literal('score')]),
  match: Type.Union([Type.Literal('contains'), Type.Literal('allTerms'), Type.Literal('anyTerm')]),
  fields: Type.Array(Type.Object({
    field: Type.String({ minLength: 1 }),
    termWeight: Type.Number({ minimum: 0 }),
    phraseWeight: Type.Number({ minimum: 0 }),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 32 }),
  phraseBoost: Type.Union([Type.Literal('sum'), Type.Literal('first')]),
  tieBreakField: Type.Optional(Type.String({ minLength: 1 })),
  normalization: Type.Object({
    trim: Type.Boolean(), lowercase: Type.Boolean(), stripLeading: Type.String(),
    removeDiacritics: Type.Boolean(), punctuationToSpaces: Type.Boolean(),
  }, { additionalProperties: false }),
})
export type CatalogueEntry = Static<typeof CatalogueEntrySchema>
type SearchConfiguration = Static<typeof SearchSchema>
const LocalizedCellsSchema = Type.Record(Type.String(), Type.Unknown())
export type CatalogueQueryRow = {
  entry: CatalogueEntry
  cells: Record<string, unknown>
}

/** Resolve each cell's `{i18n.*}` copy while supplying its native currentEntry tokens. */
export function localizeCatalogueCells(cells: Record<string, unknown>, language: string): Record<string, unknown> {
  const args = Object.fromEntries(Object.entries(cells)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .map(([field, value]) => [nativeArgumentName(`currentEntry.${field}`), value]))
  const localized = localizeProps(cells, language, args)
  if (!Value.Check(LocalizedCellsSchema, localized)) throw new CatalogueQueryError('Invalid localized catalogue cells')
  return Value.Parse(LocalizedCellsSchema, localized)
}

export class CatalogueQueryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CatalogueQueryError'
  }
}

/** Resolve only statically declared visitor bindings; unrelated page params are ignored. */
export function resolveVisitorFilters(
  baseFilters: Readonly<Record<string, unknown>>,
  bindings: readonly VisitorBinding[],
  query: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const filters = { ...baseFilters }
  const seen = new Set<string>()
  for (const binding of bindings) {
    if (seen.has(binding.filterKey)) throw new CatalogueQueryError('Duplicate visitor filter binding')
    seen.add(binding.filterKey)
    if (binding.whenFieldEmpty) {
      const dependency = bindings.find(candidate => candidate.formId === binding.formId && candidate.fieldName === binding.whenFieldEmpty)
      if (!dependency) throw new CatalogueQueryError('Visitor binding refers to an unbound form field')
      if (query[dependency.queryParameter]?.trim()) {
        delete filters[binding.filterKey]
        continue
      }
    }
    const value = query[binding.queryParameter]
    if (value === undefined) continue
    if (value.length > 2048) throw new CatalogueQueryError('Visitor filter value exceeds 2048 characters')
    if (binding.valueType === 'stringArray') {
      let parsed: unknown
      try { parsed = JSON.parse(value) } catch { throw new CatalogueQueryError('Visitor filter must be a JSON array of strings') }
      if (!Value.Check(StringArraySchema, parsed)) throw new CatalogueQueryError('Visitor filter must be a JSON array of strings')
      filters[binding.filterKey] = parsed
    } else filters[binding.filterKey] = value
  }
  return filters
}

type CellFilter = { field: string; operator: 'is' | 'isNot' | 'isTrue' | 'isFalse' | 'isSet' | 'isEmpty'; value: string }
const operators = new Set<CellFilter['operator']>(['is', 'isNot', 'isTrue', 'isFalse', 'isSet', 'isEmpty'])
const valueless = new Set<CellFilter['operator']>(['isTrue', 'isFalse', 'isSet', 'isEmpty'])

function isCellFilterOperator(value: unknown): value is CellFilter['operator'] {
  return typeof value === 'string' && ['is', 'isNot', 'isTrue', 'isFalse', 'isSet', 'isEmpty'].includes(value)
}

function parseCellFilter(filters: Record<string, unknown>): CellFilter | null {
  const field = typeof filters.cellField === 'string' ? filters.cellField.trim() : ''
  if (!field) return null
  const operator = isCellFilterOperator(filters.cellOperator) && operators.has(filters.cellOperator)
    ? filters.cellOperator : 'is'
  const raw = filters.cellValue
  const value = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : ''
  if (!valueless.has(operator) && !value) return null
  return { field, operator, value }
}

function matchesCellFilter(cells: Record<string, unknown>, filter: CellFilter): boolean {
  const value = cells[filter.field]
  const text = value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  switch (filter.operator) {
    case 'is': return text === filter.value
    case 'isNot': return text !== filter.value
    case 'isTrue': return text === 'true' || text === '1'
    case 'isFalse': return text === 'false' || text === '0' || text === ''
    case 'isSet': return text !== ''
    case 'isEmpty': return text === ''
  }
}

function normalizeSearchText(value: string, configuration: SearchConfiguration, language: string, query = false): string {
  const options = configuration.normalization
  let result = options.removeDiacritics ? value.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : value
  if (options.lowercase) result = result.toLocaleLowerCase(language)
  if (options.punctuationToSpaces) result = result.replace(/[^\p{L}\p{N}]+/gu, ' ')
  if (options.trim) result = result.trim()
  if (query && options.stripLeading && result.startsWith(options.stripLeading)) result = result.slice(options.stripLeading.length)
  return result
}

function scoreSearch(cells: Record<string, unknown>, raw: string, configuration: SearchConfiguration, language: string): number {
  if (!raw.trim()) return 1
  if (raw.length > 2048) throw new CatalogueQueryError('Search text exceeds 2048 characters')
  const value = normalizeSearchText(raw, configuration, language, true)
  if (!value) return 1
  const texts = configuration.fields.map(field => ({
    ...field,
    text: normalizeSearchText(typeof cells[field.field] === 'string' || typeof cells[field.field] === 'number'
      ? String(cells[field.field]) : '', configuration, language),
  }))
  const terms = value.split(/\s+/).filter(Boolean)
  const contains = texts.some(field => field.text.includes(value))
  const matches = configuration.match === 'contains' ? contains
    : configuration.match === 'allTerms' ? terms.every(term => texts.some(field => field.text.includes(term)))
    : terms.some(term => texts.some(field => field.text.includes(term)))
  if (!matches) return 0
  if (configuration.rank === 'source') return 1
  let score = 0
  for (const field of texts) {
    if (field.phraseWeight > 0 && field.text.includes(value)) {
      score += field.phraseWeight
      if (configuration.phraseBoost === 'first') break
    }
  }
  for (const term of terms) for (const field of texts) if (field.text.includes(term)) score += field.termWeight
  return score
}

function compareCellValues(a: unknown, b: unknown, language: string, direction: 'asc' | 'desc'): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  const comparison = typeof a === 'number' && typeof b === 'number' ? a - b
    : typeof a === 'boolean' && typeof b === 'boolean' ? Number(a) - Number(b)
    : compareLocale(String(a), String(b), language, { numeric: true, sensitivity: 'base' })
  return direction === 'desc' ? -comparison : comparison
}

/** Filter, locale-project, rank, and source-order all matching catalogue rows. */
export function queryRows(
  entries: readonly CatalogueEntry[],
  config: CatalogueQueryConfig,
  query: Readonly<Record<string, string>>,
  language: string,
  direction: 'asc' | 'desc' = 'asc',
): { rows: CatalogueQueryRow[]; totalItems: number } {
  if (!Value.Check(EntryListSchema, entries)) throw new CatalogueQueryError('Invalid catalogue entries')
  if (!Value.Check(QuerySchema, query)) throw new CatalogueQueryError('Invalid visitor query')
  if (config.sourceKind !== 'rows') throw new CatalogueQueryError('This configuration is not a row query')
  const filters = resolveVisitorFilters(config.filters, config.visitorBindings, query)
  const filter = parseCellFilter(filters)
  const rawSearch = typeof filters.searchText === 'string' ? filters.searchText : ''
  const hasSearch = typeof filters.search === 'undefined' || Value.Check(SearchSchema, filters.search)
  if (!hasSearch) throw new CatalogueQueryError('Invalid static search configuration')
  const search = filters.search === undefined ? undefined : Value.Parse(SearchSchema, filters.search)
  if (rawSearch.trim() && !search) throw new CatalogueQueryError('Search fields are not configured')

  const rows = entries.map(entry => {
    return { entry, cells: localizeCatalogueCells(entry.cells, language) }
  }).filter(row => {
    if (filter && !matchesCellFilter(row.cells, filter)) return false
    return !search || scoreSearch(row.cells, rawSearch, search, language) > 0
  })

  rows.sort((a, b) => compareCellValues(a.cells.index, b.cells.index, language, direction) || a.entry.id.localeCompare(b.entry.id))
  if (search?.rank === 'score' && rawSearch.trim()) {
    const scores = new Map(rows.map(row => [row.entry.id, scoreSearch(row.cells, rawSearch, search, language)]))
    const tie = search.tieBreakField
    rows.sort((a, b) => (scores.get(b.entry.id) ?? 0) - (scores.get(a.entry.id) ?? 0)
      || (tie ? compareLocale(String(a.cells[tie] ?? ''), String(b.cells[tie] ?? ''), language) : 0))
  }
  return { rows, totalItems: rows.length }
}
