import { LoopQueryBindingsSchema, type LoopQueryBinding } from '@core/loops-schema'
import { safeParseValue, Type } from '../utils/typeboxHelpers'
import { safeParseJson } from '../utils/jsonValidate'

export class LoopQueryConfigurationError extends Error {
  readonly path: string
  constructor(message: string, path = 'queryBindings') {
    super(message)
    this.name = 'LoopQueryConfigurationError'
    this.path = path
  }
}

export function readLoopQueryBindings(value: unknown): LoopQueryBinding[] {
  if (value === undefined) return []
  const parsed = safeParseValue(LoopQueryBindingsSchema, value)
  if (!parsed.ok) throw new LoopQueryConfigurationError('Invalid visitor query bindings')
  return parsed.value
}

const StringArraySchema = Type.Array(Type.String({ maxLength: 256 }), { maxItems: 1000 })

/** The author chooses the source and field; visitors supply declared filter values. */
export function resolveLoopQueryFilters(
  filters: Record<string, unknown>, bindings: readonly LoopQueryBinding[],
  query: Readonly<Record<string, string>>, allowedFilterKeys: readonly string[],
): Record<string, unknown> {
  if (!bindings.length) return filters
  const next = { ...filters }, seen = new Set<string>()
  for (const binding of bindings) {
    if (!allowedFilterKeys.includes(binding.filterKey)) throw new LoopQueryConfigurationError('This source does not expose visitor filter "' + binding.filterKey + '"')
    if (seen.has(binding.filterKey)) throw new LoopQueryConfigurationError('Duplicate visitor filter "' + binding.filterKey + '"')
    seen.add(binding.filterKey)
    if (binding.whenFieldEmpty) {
      const dependency = bindings.find(other => other.formId === binding.formId && other.fieldName === binding.whenFieldEmpty)
      if (!dependency) throw new LoopQueryConfigurationError('Conditional visitor filter references an unbound form field')
      if (query[dependency.queryParameter]?.trim()) {
        delete next[binding.filterKey]
        continue
      }
    }
    const value = query[binding.queryParameter]
    if (value !== undefined) {
      if (value.length > 2048) throw new LoopQueryConfigurationError('Visitor filter value exceeds 2048 characters', 'query.' + binding.queryParameter)
      if (binding.valueType === 'stringArray') {
        const parsed = safeParseJson(value, StringArraySchema)
        if (!parsed.ok) throw new LoopQueryConfigurationError('Visitor filter must be a JSON array of strings', 'query.' + binding.queryParameter)
        next[binding.filterKey] = parsed.value
      } else next[binding.filterKey] = value
    }
  }
  return next
}
