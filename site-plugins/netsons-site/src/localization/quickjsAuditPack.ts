import type { PluginModuleDefinition } from '@instatic/plugin-sdk'
import { translate } from './index'

function globalFingerprint(): string {
  return JSON.stringify([
    Object.getOwnPropertyNames(globalThis).sort(),
    Object.getOwnPropertyNames(Object.prototype).sort(),
    Object.getOwnPropertyNames(Array.prototype).sort(),
    typeof Intl === 'undefined' ? 'missing' : typeof Intl.NumberFormat,
  ])
}

const auditModule: PluginModuleDefinition = {
  id: 'netsons.site.localization-audit',
  name: 'Localization audit',
  description: 'Test-only translation lookup probe.',
  category: 'Test',
  version: '1.0.0',
  defaults: { language: 'it', keys: [] },
  schema: {},
  canHaveChildren: false,
  htmlTag: 'span',
  render(props) {
    const globalsBefore = globalFingerprint()
    const language = typeof props.language === 'string' ? props.language : ''
    const keys = Array.isArray(props.keys) ? props.keys : []
    const results = keys.map((key) => {
      if (typeof key !== 'string') return { error: 'Test query keys must be strings' }
      try {
        return { value: translate(language, key) }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
    const intlNumberFormat = typeof Intl === 'undefined' ? 'missing' : typeof Intl.NumberFormat
    return { html: JSON.stringify({ results, globalsUnchanged: globalsBefore === globalFingerprint(), intlNumberFormat }) }
  },
}

export default [auditModule]
