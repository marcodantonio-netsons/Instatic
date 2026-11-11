import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const VisitorPreferenceThemeSchema = Type.Union([
  Type.Literal('system'), Type.Literal('default'), Type.Literal('alt'),
])
export const VisitorPreferenceMotionSchema = Type.Union([
  Type.Literal('system'), Type.Literal('reduced'),
])
export const VisitorPreferenceMediaSchema = Type.Union([
  Type.Literal('full'), Type.Literal('reduced'),
])

export const VisitorPreferenceDefaultsSchema = Type.Object({
  theme: Type.Union(VisitorPreferenceThemeSchema.anyOf, { default: 'default' }),
  motion: Type.Union(VisitorPreferenceMotionSchema.anyOf, { default: 'system' }),
  media: Type.Union(VisitorPreferenceMediaSchema.anyOf, { default: 'full' }),
}, { additionalProperties: false })
export type VisitorPreferenceDefaults = Static<typeof VisitorPreferenceDefaultsSchema>

export const VisitorPreferencesPluginSettingsSchema = Type.Object({
  defaultTheme: Type.Union(VisitorPreferenceThemeSchema.anyOf, { default: 'default' }),
  defaultMotion: Type.Union(VisitorPreferenceMotionSchema.anyOf, { default: 'system' }),
  defaultMedia: Type.Union(VisitorPreferenceMediaSchema.anyOf, { default: 'full' }),
}, { additionalProperties: false })
export type VisitorPreferencesPluginSettings = Static<typeof VisitorPreferencesPluginSettingsSchema>
export const VISITOR_PREFERENCES_PLUGIN_SETTINGS_DEFAULTS = Value.Create(VisitorPreferencesPluginSettingsSchema)

export const VisitorPreferenceOverridesSchema = Type.Object({
  theme: Type.Optional(VisitorPreferenceThemeSchema),
  motion: Type.Optional(VisitorPreferenceMotionSchema),
  media: Type.Optional(VisitorPreferenceMediaSchema),
}, { additionalProperties: false })
export type VisitorPreferenceOverrides = Static<typeof VisitorPreferenceOverridesSchema>

export const VisitorPreferencePatchSchema = Type.Object({
  theme: Type.Optional(VisitorPreferenceThemeSchema),
  motion: Type.Optional(VisitorPreferenceMotionSchema),
  media: Type.Optional(VisitorPreferenceMediaSchema),
}, { additionalProperties: false, minProperties: 1 })
export type VisitorPreferencePatch = Static<typeof VisitorPreferencePatchSchema>

export const VisitorPreferenceNameSchema = Type.Union([
  Type.Literal('theme'), Type.Literal('motion'), Type.Literal('media'),
])
export type VisitorPreferenceName = Static<typeof VisitorPreferenceNameSchema>

export const VisitorPreferencesRuntimeConfigSchema = Type.Object({
  defaults: VisitorPreferenceDefaultsSchema,
  storage: Type.Union([Type.Literal('persistent'), Type.Literal('memory')]),
}, { additionalProperties: false })
export type VisitorPreferencesRuntimeConfig = Static<typeof VisitorPreferencesRuntimeConfigSchema>
export const VISITOR_PREFERENCES_RUNTIME_CONFIG_ATTRIBUTE = 'data-instatic-visitor-preferences'

export const VisitorPreferenceStatusSchema = Type.Union([
  Type.Literal('default'), Type.Literal('saved'), Type.Literal('session'),
  Type.Literal('reset'), Type.Literal('unavailable'), Type.Literal('preview'),
  Type.Literal('invalid'),
])
export type VisitorPreferenceStatus = Static<typeof VisitorPreferenceStatusSchema>

export const PreferenceHtmlAttributesSchema = Type.Record(Type.String(), Type.String(), { default: {} })

/** Plugin module packs do not receive host-normalized props metadata from QuickJS. */
export function parseModuleProps<T extends TSchema>(schema: T, props: unknown): Static<T> {
  const defaulted = Value.Default(schema, props)
  if (!Value.Check(schema, defaulted)) throw Error('Invalid preference module properties')
  return Value.Parse(schema, defaulted)
}
