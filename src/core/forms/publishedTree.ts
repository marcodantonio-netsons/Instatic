import type { Page, PageNode, SiteDocument } from '@core/page-tree'
import { reindexNodeParents, getParent, flattenSubtree } from '@core/page-tree'
import { normalizeIdentifierValue } from '@core/utils/identifier'
import { evaluateCondition, PropertyConditionSchema } from '@core/module-engine-schema'
import { compiledCheck } from '@core/utils/typeboxCompiler'
import { walkRenderTree } from '@core/visualComponents'
import { publishedRenderScopes, buildTemplateRenderContext, resolveBoundProps, resolveDynamicProps, effectiveNodeBindings, parseTokenString, type PublishedRenderScope } from '@core/templates'
import { derivePageFormSnapshots } from './snapshot'
import type { TemplateRenderDataContext } from '@core/templates'
import { FormConfigurationError } from './errors'
import { resolveSelectInitialValue } from './selectInitialValue'
import { FormCalculationsSchema, type FormValueConstraint } from '@core/forms-schema'
import { evaluateFormValues } from '@core/form-values'

/** Native composition and bindings give the server the same form definition as rendering. */
export function resolvePublishedFormScope(site: SiteDocument, scope: PublishedRenderScope): Page {
  const sourcePage = scope.kind === 'entry' ? scope.page : scope.sourcePage
  const context = buildTemplateRenderContext(sourcePage, site, undefined)
  return resolveFormTree(site, { ...scope.page, id: sourcePage.id }, context, scope.kind === 'entry')
}

function resolveFormTree(site: SiteDocument, page: Page, context: TemplateRenderDataContext, entryScope = false): Page {
  const nodes: Record<string, PageNode> = {}
  walkRenderTree(page.nodes, page.rootNodeId, site.visualComponents, (node, frame) => {
    let parent = frame.parentId ? nodes[frame.parentId] : undefined
    let inForm = node.moduleId === 'base.form'
    let inCmsForm = false
    while (parent) {
      if (parent.moduleId === 'base.form') { inForm = true; inCmsForm ||= (parent.props.mode ?? 'cms') === 'cms' }
      parent = parent.parentId ? nodes[parent.parentId] : undefined
    }
    // Reference params are materialized by the shared walker; only emitted
    // form properties participate in the form recipient's binding authority.
    const emittedFormNode = inForm && node.moduleId !== 'base.visual-component-ref'
    const bindings = effectiveNodeBindings(node)
    const props = emittedFormNode ? resolveDynamicProps(node.props, bindings, context) : node.props
    inCmsForm ||= node.moduleId === 'base.form' && (props.mode ?? 'cms') === 'cms'
    if (emittedFormNode && (inCmsForm || node.moduleId === 'base.form')) {
      const fail = () => { throw new FormConfigurationError('Form transport and CMS definitions require stable page/site bindings; entry or request bindings need an entry-specific submission authority', `pages.${page.id}.nodes.${frame.id}`) }
      const needsEntryAuthority = (source: string, field: string) => ['currentEntry', 'parentEntry', 'route'].includes(source) || (entryScope && source === 'page' && field === 'title')
      function inspect(value: unknown) {
        if (typeof value === 'string' && parseTokenString(value).some((segment) => segment.kind === 'token' && needsEntryAuthority(segment.source, segment.field))) fail()
        else if (Array.isArray(value)) value.forEach(inspect)
        else if (value && typeof value === 'object') Object.values(value).forEach(inspect)
      }
      const checkedProps = inCmsForm ? node.props : { mode: node.props.mode }
      const checkedBindings = inCmsForm ? bindings : bindings?.mode ? { mode: bindings.mode } : undefined
      if (Object.values(checkedBindings ?? {}).some((binding) => needsEntryAuthority(binding.source, binding.field))) fail()
      inspect(resolveBoundProps(checkedProps, checkedBindings, context))
    }
    if (inForm && node.moduleId === 'base.visual-component-ref' && frame.componentIds.has(String(node.props.componentId).trim())) throw new FormConfigurationError('Recursive Visual Component in form definition', `pages.${page.id}.nodes.${frame.id}`)
    if (Object.hasOwn(nodes, frame.id)) {
      let existing: PageNode | undefined = nodes[frame.id]
      while (existing && existing.moduleId !== 'base.form') existing = existing.parentId ? nodes[existing.parentId] : undefined
      if (inForm || existing) throw new FormConfigurationError('Repeated rendered form nodes require distinct instance identities', `pages.${page.id}.nodes.${frame.id}`)
    }
    nodes[frame.id] = { ...node, id: frame.id, parentId: frame.parentId, props, children: [] }
    if (frame.parentId) nodes[frame.parentId].children.push(frame.id)
  })
  reindexNodeParents(nodes)
  return { ...page, nodes }
}

export function derivePublishedPageFormSnapshots(site: SiteDocument, page: Page) {
  const forms = new Map<string, ReturnType<typeof derivePageFormSnapshots>[number]>()
  for (const scope of publishedRenderScopes(site)) {
    if ((scope.kind === 'entry' ? scope.page.id : scope.sourcePage.id) !== page.id) continue
    for (const form of derivePageFormSnapshots(resolvePublishedFormScope(site, scope))) {
      const existing = forms.get(form.formId)
      if (existing && JSON.stringify(existing) !== JSON.stringify(form)) throw new FormConfigurationError('CMS form authority differs across public render scopes', `pages.${page.id}.forms.${form.formId}`)
      forms.set(form.formId, form)
    }
  }
  return [...forms.values()]
}

export function resolveInitialFormValues(site: SiteDocument, page: Page, formNodeId: string, context: TemplateRenderDataContext): Record<string, unknown> {
  const expanded = resolveFormTree(site, { ...page, rootNodeId: formNodeId }, context)
  return resolveExpandedInitialFormValues(expanded, formNodeId)
}

/** Public render scopes share one registry across native component and loop boundaries. */
export function resolveInitialFormValuesById(site: SiteDocument, page: Page, context: TemplateRenderDataContext): ReadonlyMap<string, Record<string, unknown>> {
  const expanded = resolveFormTree(site, page, context), values = new Map<string, Record<string, unknown>>()
  for (const node of Object.values(expanded.nodes)) if (node.moduleId === 'base.form') {
    const id = normalizeIdentifierValue(String(node.props.formId || 'form'), 'form')
    if (values.has(id)) throw new FormConfigurationError('Duplicate form ID on the rendered page', `pages.${page.id}.nodes.${node.id}`)
    values.set(id, resolveExpandedInitialFormValues(expanded, node.id))
  }
  return values
}

function resolveExpandedInitialFormValues(expanded: Page, formNodeId: string): Record<string, unknown> {
  const page = expanded
  const values: Record<string, unknown> = Object.create(null)
  const sources = new Map<string, PageNode>()
  const constraints: FormValueConstraint[] = []
  const nodes = flattenSubtree(expanded, formNodeId).map((id) => expanded.nodes[id]).filter(Boolean), checkboxCounts = new Map<string, number>()
  for (const node of nodes) if (node.moduleId === 'base.checkbox') { const name = String(node.props.name || node.props.fieldId || ''); checkboxCounts.set(name, (checkboxCounts.get(name) ?? 0) + 1) }
  for (const node of nodes) {
    const name = typeof node.props.name === 'string' && node.props.name ? node.props.name : typeof node.props.fieldId === 'string' ? node.props.fieldId : ''
    if (!name || node.props.disabled) continue
    if (node.moduleId === 'base.checkbox' && (checkboxCounts.get(name) ?? 0) > 1) {
      const selected = values[name] ?? []
      if (!Array.isArray(selected)) throw new FormConfigurationError('Invalid checkbox collection', `pages.${page.id}.nodes.${node.id}`)
      if (node.props.checked) selected.push(node.props.value ?? 'on')
      values[name] = selected; sources.set(name, node); continue
    }
    if (node.moduleId === 'base.select') {
      values[name] = resolveSelectInitialValue(node, (id) => expanded.nodes[id])
    } else if (['base.input', 'base.textarea', 'base.radio', 'base.checkbox'].includes(node.moduleId)) {
      if (node.moduleId === 'base.checkbox' && !node.props.checked) { values[name] = ''; sources.set(name, node); continue }
      if (node.moduleId === 'base.radio' && !node.props.checked) continue
      values[name] = node.props.value ?? (['base.radio', 'base.checkbox'].includes(node.moduleId) ? 'on' : '')
    } else continue
    sources.set(name, node)
    if (node.props.minValueField || node.props.maxValueField) constraints.push({ fieldName: name, minValueField: String(node.props.minValueField || ''), maxValueField: String(node.props.maxValueField || ''), ...(node.props.min !== '' && node.props.min !== undefined ? { min: Number(node.props.min) } : {}), ...(node.props.max !== '' && node.props.max !== undefined ? { max: Number(node.props.max) } : {}) })
  }
  const calculations = expanded.nodes[formNodeId]?.props.calculations ?? {}
  if (!compiledCheck(FormCalculationsSchema, calculations)) throw new FormConfigurationError('Invalid form calculations', `pages.${page.id}.nodes.${formNodeId}.calculations`)
  const computed = evaluateFormValues(calculations, values, constraints)
  // Only successful controls contribute to outputs and synchronized values.
  // Condition selectors are unconditional, as enforced by the native preflight.
  const successful = { ...computed }
  for (const [name, node] of sources) {
    let parent = getParent(expanded, node.id)
    while (parent) {
      if (parent.moduleId === 'base.form-conditional' && parent.props.disableWhenHidden !== false && compiledCheck(PropertyConditionSchema, parent.props.condition) && !evaluateCondition(parent.props.condition, computed)) delete successful[name]
      parent = getParent(expanded, parent.id)
    }
  }
  return successful
}
