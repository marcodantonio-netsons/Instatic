import type { PageNode, SiteDocument } from '@core/page-tree'
import { visitJsonStrings } from '@core/utils/jsonStrings'
import { walkRenderTree } from '@core/visualComponents'
import {
  assertPageTranslationGroups,
  bindingToToken,
  buildTemplateRenderContext,
  composeTemplateChain,
  readPageTranslationField,
  resolvePageTranslations,
  resolveTemplateChain,
  visitExpandedTokenReferences,
} from '@core/templates'

/** Check effective static pages and reachable components before snapshot writes. */
export function assertPageTranslationBindings(site: SiteDocument): void {
  assertPageTranslationGroups(site)
  const chain = resolveTemplateChain(site, { kind: 'page' })
  for (const page of site.pages) {
    if (page.template?.enabled) continue
    const translations = resolvePageTranslations(page, site)
    const context = buildTemplateRenderContext(page, site, undefined)
    const checkToken = (token: { source: string; field: string }) => {
      if (token.source === 'page' && token.field.startsWith('translations.')) {
        readPageTranslationField(translations, token.field.slice('translations.'.length))
      }
    }
    const checkText = (value: unknown) => {
      if (typeof value !== 'string' || !value.includes('{')) return
      visitExpandedTokenReferences(value, context, checkToken)
    }
    const checkNode = (node: PageNode) => {
      for (const [name, value] of Object.entries(node.props)) {
        checkText(value)
        if (name === 'htmlAttributes' && value && typeof value === 'object' && !Array.isArray(value)) {
          for (const nested of Object.values(value)) checkText(nested)
        }
      }
      for (const binding of Object.values(node.dynamicBindings ?? {})) {
        if (binding.source === 'page' && binding.field.startsWith('translations.')) {
          readPageTranslationField(translations, binding.field.slice('translations.'.length))
        } else if (binding.source === 'site' && binding.field.startsWith('translations.')) {
          visitExpandedTokenReferences(bindingToToken(binding.source, binding.field), context, checkToken)
        }
      }
    }
    checkText(site.settings.metaTitle)
    checkText(site.settings.metaDescription)
    visitJsonStrings(page.seo, checkText)
    const effective = composeTemplateChain(chain, { kind: 'page', page })
    walkRenderTree(effective.nodes, effective.rootNodeId, site.visualComponents, checkNode)
  }
}
