import type { PageNode, SiteDocument } from '@core/page-tree'
import { resolveSiteLanguage } from '@core/localization'
import { visitJsonStrings } from '@core/utils/jsonStrings'
import {
  bindingToToken,
  buildSiteFrame,
  composeTemplateChain,
  resolveTemplateChain,
  visitExpandedTokenReferences,
} from '@core/templates'
import { walkRenderTree } from '@core/visualComponents'
import { assertPageTranslationBindings } from './pageTranslationPreflight'

/** Validate each effective render's translations before snapshot writes. */
export function assertSiteTranslations(site: SiteDocument): void {
  assertPageTranslationBindings(site)
  resolveSiteLanguage(site)
  const chain = resolveTemplateChain(site, { kind: 'page' })
  for (const page of site.pages) {
    // Dynamic templates can render entries in any configured language.
    const languages = page.template?.enabled && site.settings.localization
      ? site.settings.localization.catalogues.map((catalogue) => catalogue.language)
      : [page.language]
    const effective = page.template?.enabled ? page : composeTemplateChain(chain, { kind: 'page', page })
    for (const language of languages) {
      const context = { entryStack: [], site: buildSiteFrame(site, language) }
      const checkText = (value: unknown) => {
        if (typeof value !== 'string' || !value.includes('{')) return
        visitExpandedTokenReferences(value, context, () => {})
      }
      const checkNode = (node: PageNode) => {
        const props = node.moduleId === 'base.visual-component-ref'
          ? Object.fromEntries(Object.entries(node.props).filter(([key]) => key !== 'propOverrides'))
          : node.props
        visitJsonStrings(props, checkText)
        for (const binding of Object.values(node.dynamicBindings ?? {})) {
          if (binding.source === 'site' && binding.field.startsWith('translations.')) {
            visitExpandedTokenReferences(bindingToToken(binding.source, binding.field), context, () => {})
          }
          if (binding.format === 'number' && binding.numberFormat?.templateKey !== undefined) {
            visitExpandedTokenReferences(
              bindingToToken('site', `translations.${binding.numberFormat.templateKey.trim()}`),
              context,
              () => {},
            )
          }
        }
      }
      checkText(site.settings.metaTitle)
      checkText(site.settings.metaDescription)
      visitJsonStrings(page.seo, checkText)
      walkRenderTree(effective.nodes, effective.rootNodeId, site.visualComponents, checkNode)
    }
  }
}
