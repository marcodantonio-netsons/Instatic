import { Type, type TObject } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { CmsServerFilterContexts, ServerPluginApi } from '@instatic/plugin-sdk'
import { LanguageRouteSchema, renderLanguageLinks } from '../languageLinks'
import { SeoJsonValueSchema, SeoRecordSchema, renderSeoHtml } from '../seo'

export const PAGE_METADATA_TABLE = 'netsons-pages'
export const PAGE_GROUP_TABLE = 'netsons-page-groups'

function storedRepeater<T extends TObject>(item: T) {
  return Type.Array(Type.Object({
    id: Type.String({ minLength: 1 }),
    cells: Type.Omit(item, ['id']),
  }, { additionalProperties: false }))
}

function flattenRepeater<T extends Record<string, unknown>>(items: readonly { id: string; cells: T }[]) {
  return items.map(item => ({ ...item.cells, id: item.id }))
}

export const StoredPageMetadataSchema = Type.Object({
  ...Type.Omit(SeoRecordSchema, ['alternates']).properties,
  structuredData: Type.String(),
  groupId: Type.String({ minLength: 1 }),
  meta: storedRepeater(SeoRecordSchema.properties.meta.items),
  links: storedRepeater(SeoRecordSchema.properties.links.items),
}, { additionalProperties: false })

export const StoredPageGroupSchema = Type.Object({
  slug: Type.Optional(Type.String({ minLength: 1 })),
  groupId: Type.String({ minLength: 1 }),
  alternates: storedRepeater(SeoRecordSchema.properties.alternates.items),
  languageRoutes: storedRepeater(LanguageRouteSchema),
}, { additionalProperties: false })

const EntrySchema = Type.Object({
  id: Type.String(),
  tableSlug: Type.Literal(PAGE_METADATA_TABLE),
  cells: StoredPageMetadataSchema,
})
const StructuredDataSchema = Type.Array(Type.Record(Type.String(), SeoJsonValueSchema))
const GroupEntrySchema = Type.Object({
  id: Type.String(),
  tableSlug: Type.Literal(PAGE_GROUP_TABLE),
  cells: StoredPageGroupSchema,
})

export function renderPageMetadata(html: string, raw: unknown, rawGroup: unknown, context: CmsServerFilterContexts['publish.html']): string {
  if (!Value.Check(EntrySchema, raw)) throw new Error('Missing or invalid page metadata: ' + context.pageId)
  const { cells } = Value.Parse(EntrySchema, raw)
  if (cells.pageId !== context.pageId || cells.slug !== context.slug) {
    throw new Error('Page metadata does not match its published route: ' + context.pageId)
  }
  if (!Value.Check(GroupEntrySchema, rawGroup)) throw new Error('Missing or invalid page language group: ' + cells.groupId)
  const { cells: group } = Value.Parse(GroupEntrySchema, rawGroup)
  if (group.groupId !== cells.groupId) throw new Error('Page metadata does not match its language group')
  let structuredData: unknown
  try {
    structuredData = JSON.parse(cells.structuredData)
  } catch (cause) {
    throw new Error('Invalid page JSON-LD: ' + context.pageId, { cause })
  }
  if (!Value.Check(StructuredDataSchema, structuredData)) throw new Error('Invalid page JSON-LD values: ' + context.pageId)
  const metadata = Object.fromEntries(Object.keys(SeoRecordSchema.properties).map(key => [key,
    key === 'structuredData' ? structuredData
      : key === 'alternates' ? flattenRepeater(group.alternates)
      : key === 'meta' ? flattenRepeater(cells.meta)
      : key === 'links' ? flattenRepeater(cells.links)
      : Reflect.get(cells, key),
  ]).filter(([, value]) => value !== undefined))
  const seoHtml = renderSeoHtml(html, metadata)
  return renderLanguageLinks(seoHtml, flattenRepeater(group.languageRoutes))
}

/** Read metadata through the official content API, keeping the CMS as its only owner. */
export function registerPageMetadata(api: ServerPluginApi): void {
  api.cms.hooks.filter('publish.html', async (html, context) => {
    const raw: unknown = await api.cms.content.table(PAGE_METADATA_TABLE).get('seo-' + context.pageId)
    if (!Value.Check(EntrySchema, raw)) throw new Error('Missing or invalid page metadata: ' + context.pageId)
    const group = await api.cms.content.table(PAGE_GROUP_TABLE).get('seo-group-' + raw.cells.groupId)
    return renderPageMetadata(html, raw, group, context)
  })
}
