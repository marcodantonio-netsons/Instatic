import type { PluginModuleDefinition } from '@instatic/plugin-sdk'
import { escapeHtml } from './htmlSafety'

/** The canvas supplies raw strings; published render inputs are already escaped. */
export function withSafePreview(definition: PluginModuleDefinition): PluginModuleDefinition {
  return {
    ...definition,
    preview(props, children) {
      const escaped = Object.fromEntries(Object.entries(props).map(([key, value]) => [
        key,
        typeof value === 'string' && !['url', 'image'].includes(definition.schema?.[key]?.type) ? escapeHtml(value) : value,
      ]))
      return definition.render(escaped, children)
    },
  }
}
