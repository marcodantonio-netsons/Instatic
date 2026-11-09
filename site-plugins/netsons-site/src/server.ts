import type { ServerPluginApi } from '@instatic/plugin-sdk'
import { registerPreferencesPublishHook } from './preferences/publishedHtml'
import { registerLoopControlsPublishHook } from './loopControls/publishedHtml'
import { augmentFormsCsp } from './forms/csp'
import { registerCatalogueQuery } from './catalogueQuery'

export function activate(api: ServerPluginApi): void {
  registerCatalogueQuery(api)
  registerPreferencesPublishHook(api)
  registerLoopControlsPublishHook(api)
  api.cms.hooks.filter('publish.html', augmentFormsCsp)
}
