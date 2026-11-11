import { VISITOR_PREFERENCES_RUNTIME_CONFIG_ATTRIBUTE } from '../shared/preferences/schema'
import { installVisitorPreferences } from './runtime'
import { resolveVisitorPreferences } from './resolve'
import { visitorPreferencesValidatorCode } from './validation'

export const VISITOR_PREFERENCES_CONFIG_ATTRIBUTE = VISITOR_PREFERENCES_RUNTIME_CONFIG_ATTRIBUTE
export const VISITOR_PREFERENCES_RUNTIME_ASSET_PATH = 'frontend/visitor-preferences.js'

const validators = Object.entries(visitorPreferencesValidatorCode)
  .map(([name, code]) => name + ': (function () { ' + code + ' })()')
  .join(',\n')

/** Standalone static asset for a synchronous manifest `frontend.assets` head script. */
export const VISITOR_PREFERENCES_RUNTIME_JS = [
  '(() => {',
  'const validators = { ' + validators + ' };',
  "const raw = document.documentElement.getAttribute('" + VISITOR_PREFERENCES_CONFIG_ATTRIBUTE + "');",
  'if (raw === null) return;',
  'const config = JSON.parse(raw);',
  'return (' + installVisitorPreferences.toString() + ')(document, config, validators, ' + resolveVisitorPreferences.toString() + ');',
  '})();',
].join('\n')
