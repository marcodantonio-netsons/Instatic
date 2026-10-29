import type { SiteDocument } from '@core/page-tree'
import { buildTemplateRenderContext, publishedRenderScopes, readFrame } from '@core/templates'
import { inspectVCRequiredParameters, VisualComponentParameterError, walkRenderTree } from '@core/visualComponents'

/**
 * Reject concrete required-argument failures before snapshot writes, including
 * references that will be emitted as request-dependent holes. Entry scopes
 * have no row or request; their dynamic values are validated by real renders.
 */
export function assertSiteComponentParameters(site: SiteDocument): void {
  for (const scope of publishedRenderScopes(site)) {
    const context = scope.kind === 'entry' ? undefined : {
      ...buildTemplateRenderContext(scope.sourcePage, site, undefined),
      // A publication has no visitor request. Keep request-bound arguments
      // unresolved rather than proving them with an invented query string.
      route: undefined,
    }
    const unresolvedMaterializations = new Map<string, 'arguments' | 'component'>()
    walkRenderTree(scope.page.nodes, scope.page.rootNodeId, site.visualComponents, (node, frame) => {
      if (!frame.component || !frame.instance) return
      // A dynamic component selection changes the whole definition. A dynamic
      // argument bag changes only child props actually bound to its parameters;
      // independent nested references still have concrete contracts to check.
      const inherited = [...unresolvedMaterializations].filter(([prefix]) => frame.id.startsWith(prefix))
      if (inherited.some(([, kind]) => kind === 'component')) return
      if (inherited.length && (node.propBindings?.componentId || node.propBindings?.propOverrides)) {
        unresolvedMaterializations.set(`${frame.id}:`, node.propBindings?.componentId ? 'component' : 'arguments')
        return
      }
      const componentBinding = node.dynamicBindings?.componentId
      if (componentBinding && (!context || !readFrame(componentBinding.source, context))) {
        unresolvedMaterializations.set(`${frame.id}:`, 'component')
        return
      }
      const issues = inspectVCRequiredParameters(frame.component, frame.instance, frame.id, context, node.dynamicBindings?.propOverrides)
      const error = issues.find((issue) => issue.reason !== 'unresolved')
      if (error) throw new VisualComponentParameterError(error)
      const binding = node.dynamicBindings?.propOverrides
      if (binding && (!context || !readFrame(binding.source, context))) unresolvedMaterializations.set(`${frame.id}:`, 'arguments')
    }, context)
  }
}
