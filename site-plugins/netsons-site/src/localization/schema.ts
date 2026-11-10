import { Type, type Static } from '@sinclair/typebox'

export const TranslationMessagesSchema = Type.Recursive(Self => Type.Record(
  Type.String({ pattern: '^[A-Za-z][A-Za-z0-9_-]*$' }),
  Type.Union([Type.String(), Self]),
  { additionalProperties: false },
))
export const LanguageCatalogueSchema = Type.Object({ language: Type.String(), messages: TranslationMessagesSchema }, { additionalProperties: false })
export type TranslationMessages = Static<typeof TranslationMessagesSchema>
