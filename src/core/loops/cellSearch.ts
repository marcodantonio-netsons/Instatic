import { LoopSearchConfigurationSchema, type LoopSearchConfiguration } from '@core/loops-schema'
import { safeParseValue } from '../utils/typeboxHelpers'
import { LoopQueryConfigurationError } from './queryBindings'

export interface CellSearch {
  configuration: LoopSearchConfiguration
  value: string
  language?: string
}

export function normalizeSearchText(value: string, configuration: LoopSearchConfiguration, language?: string, query = false): string {
  const options = configuration.normalization
  let result = options.removeDiacritics ? value.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : value
  if (options.lowercase) result = result.toLocaleLowerCase(language)
  if (options.punctuationToSpaces) result = result.replace(/[^\p{L}\p{N}]+/gu, ' ')
  if (options.trim) result = result.trim()
  if (query && options.stripLeading && result.startsWith(options.stripLeading)) result = result.slice(options.stripLeading.length)
  return result
}

/** Search configuration is authored; the query is the only visitor input. */
export function parseCellSearch(filters: Record<string, unknown>, language?: string): CellSearch | null {
  const raw = typeof filters.searchText === 'string' ? filters.searchText : ''
  const parsed = filters.search === undefined ? undefined : safeParseValue(LoopSearchConfigurationSchema, filters.search)
  if (parsed && !parsed.ok) throw new LoopQueryConfigurationError('Invalid search configuration', 'filters.search')
  const configuration = parsed?.value
  if (!raw.trim()) return null
  if (!configuration) throw new LoopQueryConfigurationError('Configure the searchable fields before enabling visitor search', 'filters.search')
  if (raw.length > 2048) throw new LoopQueryConfigurationError('Search text exceeds2048 characters', 'filters.searchText')
  const value = normalizeSearchText(raw, configuration, language, true)
  return value ? { configuration, value, language } : null
}

export function scoreCellSearch(cells: Record<string, unknown>, search: CellSearch): number {
  const texts = search.configuration.fields.map((entry) => ({ ...entry,
    text: normalizeSearchText(typeof cells[entry.field] === 'string' || typeof cells[entry.field] === 'number' ? String(cells[entry.field]) : '', search.configuration, search.language),
  }))
  const terms = search.value.split(/\s+/).filter(Boolean)
  const contains = texts.some((entry) => entry.text.includes(search.value))
  const matches = search.configuration.match === 'contains' ? contains
    : search.configuration.match === 'allTerms' ? terms.every((term) => texts.some((entry) => entry.text.includes(term)))
    : terms.some((term) => texts.some((entry) => entry.text.includes(term)))
  if (!matches) return 0
  if (search.configuration.rank === 'source') return 1
  let score = 0
  for (const entry of texts) {
    if (entry.phraseWeight > 0 && entry.text.includes(search.value)) {
      score += entry.phraseWeight
      if (search.configuration.phraseBoost === 'first') break
    }
  }
  for (const term of terms) for (const entry of texts) if (entry.text.includes(term)) score += entry.termWeight
  return score
}

/** SQL is used only when its normalization has the same portable semantics. */
export function canUseCellSearchSql(search: CellSearch): boolean {
  return search.configuration.match === 'contains' && search.configuration.rank === 'source'
    && !search.configuration.normalization.lowercase
    && !search.configuration.normalization.removeDiacritics && !search.configuration.normalization.punctuationToSpaces
}

/** Literal substring search: SQL wildcard characters remain literal. */
export function cellSearchSql(input: { search: CellSearch; dialect: 'postgres' | 'sqlite'; column: string; nextParamIndex: number }): { sql: string; params: unknown[] } {
  const params: unknown[] = [], conditions: string[] = []
  for (const { field } of input.search.configuration.fields) {
    const fieldParam = input.dialect === 'postgres' ? '$' + (input.nextParamIndex + params.length) : '?'
    params.push(field)
    const valueParam = input.dialect === 'postgres' ? '$' + (input.nextParamIndex + params.length) : '?'
    params.push(input.search.value)
    const raw = input.dialect === 'postgres' ? '(' + input.column + ' #>> array[' + fieldParam + '])'
      : 'cast(json_extract(' + input.column + ", '$.' || " + fieldParam + ') as text)'
    const value = "coalesce(" + raw + ", '')"
    conditions.push(input.dialect === 'postgres' ? 'strpos(' + value + ', ' + valueParam + ') > 0' : 'instr(' + value + ', ' + valueParam + ') > 0')
  }
  return { sql: '(' + conditions.join(' or ') + ')', params }
}
