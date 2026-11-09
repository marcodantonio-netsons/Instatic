import { Type, type Static } from '@sinclair/typebox'

export const TranslationMessagesSchema = Type.Recursive(Self => Type.Record(Type.String(), Type.Union([Type.String(), Self])))
export const LanguageCatalogueSchema = Type.Object({ language: Type.String(), messages: TranslationMessagesSchema }, { additionalProperties: false })
export type TranslationMessages = Static<typeof TranslationMessagesSchema>
