import { Type, type Static } from '@sinclair/typebox'

const nonEmpty = Type.String({ minLength: 1 })

export const SeoJsonValueSchema = Type.Recursive((Self) => Type.Union([
  Type.Null(), Type.Boolean(), Type.Number(), Type.String(), Type.Array(Self), Type.Record(Type.String(), Self),
]), { $id: 'NetsonsSeoJsonValue' })

export const SeoAlternateSchema = Type.Object({
  id: nonEmpty,
  language: nonEmpty,
  href: nonEmpty,
}, { additionalProperties: false })

export const SeoMetaSchema = Type.Object({
  id: nonEmpty,
  attribute: Type.Union([Type.Literal('name'), Type.Literal('property'), Type.Literal('http-equiv')]),
  key: nonEmpty,
  content: Type.String(),
  media: Type.Optional(Type.String()),
}, { additionalProperties: false })

export const SEO_LINK_RELATIONS = [
  'author', 'icon', 'apple-touch-icon', 'manifest', 'license', 'help', 'me', 'search', 'prev', 'next',
] as const

export const SeoLinkSchema = Type.Object({
  id: nonEmpty,
  rel: Type.Union(SEO_LINK_RELATIONS.map((rel) => Type.Literal(rel))),
  href: nonEmpty,
  type: Type.Optional(Type.String()),
  sizes: Type.Optional(Type.String()),
  media: Type.Optional(Type.String()),
}, { additionalProperties: false })

/** A normalized CMS SEO row; page identity is retained for publisher diagnostics. */
export const SeoRecordSchema = Type.Object({
  pageId: nonEmpty,
  slug: nonEmpty,
  language: Type.String({ minLength: 2 }),
  title: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  canonical: Type.Optional(nonEmpty),
  alternates: Type.Array(SeoAlternateSchema),
  meta: Type.Array(SeoMetaSchema),
  links: Type.Array(SeoLinkSchema),
  structuredData: Type.Array(Type.Record(Type.String(), SeoJsonValueSchema)),
}, { additionalProperties: false })

export type SeoRecord = Static<typeof SeoRecordSchema>
export type SeoAlternate = Static<typeof SeoAlternateSchema>
export type SeoMeta = Static<typeof SeoMetaSchema>
export type SeoLink = Static<typeof SeoLinkSchema>

