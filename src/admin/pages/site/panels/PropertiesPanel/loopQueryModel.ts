import type { Page, SiteDocument } from '@core/page-tree'
import { walkRenderTree } from '@core/visualComponents'
import { buildTemplateRenderContext, effectiveNodeBindings, resolveDynamicProps } from '@core/templates'
import { normalizeIdentifierValue } from '@core/utils/identifier'
import { FormCalculationsSchema } from '@core/forms-schema'
import { compiledCheck } from '@core/utils/typeboxCompiler'

export interface LoopFormOption { id: string; fields: string[] }
const controls = new Set(['base.input', 'base.textarea', 'base.select', 'base.checkbox', 'base.radio'])

/** Materialized VC params/slots and stable page bindings use the same walker as publishing. */
export function loopFormOptions(page: Page | null, site: SiteDocument | null): LoopFormOption[] {
  if (!page || !site) return []
  const forms = new Map<string, Set<string>>()
  const context = buildTemplateRenderContext(page, site, undefined)
  walkRenderTree(page.nodes, page.rootNodeId, site.visualComponents, (node, frame) => {
    if (node.moduleId === 'base.visual-component-ref') return
    const props = resolveDynamicProps(node.props, effectiveNodeBindings(node), context)
    const formNode = node.moduleId === 'base.form' ? node : [...frame.ancestors].reverse().find(ancestor => ancestor.moduleId === 'base.form')
    if (!formNode) return
    const formProps = resolveDynamicProps(formNode.props, effectiveNodeBindings(formNode), context)
    const id = normalizeIdentifierValue(typeof formProps.formId === 'string' ? formProps.formId : 'form', 'form')
    const fields = forms.get(id) ?? new Set<string>()
    if (controls.has(node.moduleId)) {
      const name = typeof props.name === 'string' && props.name ? props.name : typeof props.fieldId === 'string' ? props.fieldId : ''
      if (name) fields.add(name)
    }
    if (node.moduleId === 'base.form' && compiledCheck(FormCalculationsSchema, props.calculations)) for (const name of Object.keys(props.calculations)) fields.add(name)
    forms.set(id, fields)
  }, context)
  return [...forms].map(([id, fields]) => ({ id, fields: [...fields] })).filter(form => form.fields.length)
}
