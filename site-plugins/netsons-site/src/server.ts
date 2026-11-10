import type { ServerPluginApi } from '@instatic/plugin-sdk'
import { registerPreferencesPublishHook } from './preferences/publishedHtml'
import { registerLoopControlsPublishHook } from './loopControls/publishedHtml'
import { augmentFormsCsp } from './forms/csp'
import { registerCatalogueQuery } from './catalogueQuery'
import { registerPageMetadata } from './pageMetadata'
import { augmentSiteToolsCsp } from './siteTools/userway'

export function activate(api: ServerPluginApi): void {
  registerCatalogueQuery(api)
  registerPreferencesPublishHook(api)
  registerLoopControlsPublishHook(api)
  registerPageMetadata(api)
  api.cms.hooks.filter('publish.html', augmentFormsCsp)
  api.cms.hooks.filter('publish.html', augmentSiteToolsCsp)
}
