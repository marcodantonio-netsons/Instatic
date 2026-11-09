/** Browser-safe catalogue configuration registry, shared by loops and controls. */
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import rawQueryConfigs from './query-configs.json'

const VisitorBindingSchema = Type.Object({
  formId: Type.String({ minLength: 1 }),
  fieldName: Type.String({ minLength: 1 }),
  filterKey: Type.String({ minLength: 1 }),
  queryParameter: Type.String({ minLength: 1 }),
  valueType: Type.Optional(Type.Union([Type.Literal('text'), Type.Literal('stringArray')])),
  whenFieldEmpty: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false })

const CatalogueQueryConfigsSchema = Type.Record(
  Type.String({ minLength: 1 }),
  Type.Object({
    tableSlug: Type.String({ minLength: 1 }),
    sourceKind: Type.Union([Type.Literal('rows'), Type.Literal('pivot')]),
    filters: Type.Record(Type.String(), Type.Unknown()),
    visitorBindings: Type.Array(VisitorBindingSchema),
  }, { additionalProperties: false }),
)

export type VisitorBinding = Static<typeof VisitorBindingSchema>
export type CatalogueQueryConfig = Static<typeof CatalogueQueryConfigsSchema>[string]
const allowedTables = new Set(['netsons-sitemap', 'netsons-domains', 'netsons-knowledge', 'netsons-catalog'])
if (!Value.Check(CatalogueQueryConfigsSchema, rawQueryConfigs)) throw new Error('Invalid static catalogue query configuration')
const parsedConfigs = Value.Parse(CatalogueQueryConfigsSchema, rawQueryConfigs)
for (const [id, config] of Object.entries(parsedConfigs)) {
  if (!allowedTables.has(config.tableSlug)) throw new Error(`Catalogue query ${id} uses an unapproved table`)
  if (config.visitorBindings.some(binding => binding.formId !== config.visitorBindings[0]?.formId)) {
    throw new Error(`Catalogue query ${id} binds more than one form`)
  }
}
export const CATALOGUE_QUERY_CONFIGS = Object.fromEntries(Object.entries(parsedConfigs).map(([id, config]) => [
  id,
  { ...config, formId: config.visitorBindings[0]?.formId ?? '' },
]))
export type CatalogueQueryConfigId = keyof typeof CATALOGUE_QUERY_CONFIGS

export function isCatalogueQueryConfigId(value: unknown): value is CatalogueQueryConfigId {
  return typeof value === 'string' && Object.hasOwn(CATALOGUE_QUERY_CONFIGS, value)
}
