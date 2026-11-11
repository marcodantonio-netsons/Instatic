import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { Value } from '@sinclair/typebox/value'
import { escapeHtml } from '../shared/htmlSafety'
import {
  VISITOR_PREFERENCES_PLUGIN_SETTINGS_DEFAULTS,
  VisitorPreferencesPluginSettingsSchema,
  VISITOR_PREFERENCES_RUNTIME_CONFIG_ATTRIBUTE,
  VisitorPreferencesRuntimeConfigSchema,
} from '../shared/preferences/schema'
import type { PluginPermission, PluginSettingDefinition } from '@instatic/plugin-sdk'

const preferencesSettings: PluginSettingDefinition[] = [
  {
    id: 'defaultTheme',
    type: 'select',
    label: 'Default appearance',
    description: 'Appearance visitors start with before choosing their own preference.',
    options: [
      { label: 'System', value: 'system' },
      { label: 'Light', value: 'default' },
      { label: 'Instatic dark mode', value: 'alt' },
    ],
    default: VISITOR_PREFERENCES_PLUGIN_SETTINGS_DEFAULTS.defaultTheme,
  },
  {
    id: 'defaultMotion',
    type: 'select',
    label: 'Default motion',
    description: 'Motion preference visitors start with before choosing their own preference.',
    options: [
      { label: 'Follow system', value: 'system' },
      { label: 'Reduced motion', value: 'reduced' },
    ],
    default: VISITOR_PREFERENCES_PLUGIN_SETTINGS_DEFAULTS.defaultMotion,
  },
  {
    id: 'defaultMedia',
    type: 'select',
    label: 'Default decorative media',
    description: 'Decorative media preference visitors start with before choosing their own preference.',
    options: [
      { label: 'Full media', value: 'full' },
      { label: 'Reduced media', value: 'reduced' },
    ],
    default: VISITOR_PREFERENCES_PLUGIN_SETTINGS_DEFAULTS.defaultMedia,
  },
]

/** Settings to add to definePlugin({ settings: [...] }). */
export const VISITOR_PREFERENCES_SETTINGS = preferencesSettings

/** Permission required to register the publish filter and declare its browser asset. */
export const VISITOR_PREFERENCES_REQUIRED_PERMISSIONS: PluginPermission[] = [
  'cms.hooks',
  'frontend.assets',
]

export interface PreferencesPublishHookApi {
  cms: {
    settings: {
      getAll(): Record<string, string | number | boolean>
    }
    hooks: {
      filter(name: 'publish.html', handler: (html: string) => string): void
    }
  }
}

type HtmlNode = DefaultTreeAdapterMap['node']
type HtmlElement = DefaultTreeAdapterMap['element']

function isElement(node: HtmlNode): node is HtmlElement {
  return 'tagName' in node
}

function runtimeConfig(rawSettings: Record<string, string | number | boolean>) {
  const defaultedSettings = Value.Default(VisitorPreferencesPluginSettingsSchema, {
    defaultTheme: rawSettings.defaultTheme ?? VISITOR_PREFERENCES_PLUGIN_SETTINGS_DEFAULTS.defaultTheme,
    defaultMotion: rawSettings.defaultMotion ?? VISITOR_PREFERENCES_PLUGIN_SETTINGS_DEFAULTS.defaultMotion,
    defaultMedia: rawSettings.defaultMedia ?? VISITOR_PREFERENCES_PLUGIN_SETTINGS_DEFAULTS.defaultMedia,
  })
  if (!Value.Check(VisitorPreferencesPluginSettingsSchema, defaultedSettings)) {
    throw Error('Invalid visitor preference plugin settings')
  }
  const settings = Value.Parse(VisitorPreferencesPluginSettingsSchema, defaultedSettings)
  const config = Value.Default(VisitorPreferencesRuntimeConfigSchema, {
    defaults: {
      theme: settings.defaultTheme,
      motion: settings.defaultMotion,
      media: settings.defaultMedia,
    },
    storage: 'persistent',
  })
  if (!Value.Check(VisitorPreferencesRuntimeConfigSchema, config)) {
    throw Error('Invalid visitor preference runtime configuration')
  }
  return Value.Parse(VisitorPreferencesRuntimeConfigSchema, config)
}

/** Add or replace the settings-backed config attribute on the source <html> tag. */
export function renderPreferencesPublishHtml(
  html: string,
  rawSettings: Record<string, string | number | boolean>,
): string {
  const document = parse(html, { sourceCodeLocationInfo: true })
  const root = document.childNodes.find((node): node is HtmlElement => isElement(node) && node.tagName === 'html')
  const rootStartTag = root?.sourceCodeLocation?.startTag
  if (!root || !rootStartTag) return html

  const attribute = `${VISITOR_PREFERENCES_RUNTIME_CONFIG_ATTRIBUTE}="${escapeHtml(JSON.stringify(runtimeConfig(rawSettings)))}"`
  const existing = root.sourceCodeLocation?.attrs?.[VISITOR_PREFERENCES_RUNTIME_CONFIG_ATTRIBUTE]
  if (existing) {
    const start = existing.startOffset > 0 && /\s/.test(html[existing.startOffset - 1])
      ? existing.startOffset - 1
      : existing.startOffset
    return html.slice(0, start) + ` ${attribute}` + html.slice(existing.endOffset)
  }

  const insertAt = rootStartTag.endOffset - 1
  if (html[insertAt] !== '>') return html
  return html.slice(0, insertAt) + ` ${attribute}` + html.slice(insertAt)
}

/** Register a settings-backed configuration on the final published HTML. */
export function registerPreferencesPublishHook(api: PreferencesPublishHookApi): void {
  api.cms.hooks.filter('publish.html', html => renderPreferencesPublishHtml(html, api.cms.settings.getAll()))
}
