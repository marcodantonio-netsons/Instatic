import type { Page, PageNode, SiteDocument } from '@core/page-tree'
import { flattenSubtree, getParent } from '@core/page-tree'
import { PropertyConditionSchema, type PropertyCondition } from '@core/module-engine-schema'
import { normalizeIdentifierValue } from '@core/utils/identifier'
import { Value } from '@sinclair/typebox/value'
import { compiledCheck } from '@core/utils/typeboxCompiler'
import { FormConfigurationSchema, FormControlBehaviorSchema, TurnstileConfigurationSchema, CheckboxGroupSchema, FormValueExpressionSchema, type FormValueConstraint } from '@core/forms-schema'
import { evaluateFormValues, evaluateFormExpression, formExpressionFields, formValueUrl } from '@core/form-values'
import { resolvePublishedFormScope } from './publishedTree'
import { publishedRenderScopes } from '@core/templates'
import { FormConfigurationError } from './errors'
import { MODULE_GENERATED_ATTRIBUTE_NAMES, normalizeHtmlAttributeName, resolveHtmlTag, VOID_HTML_ELEMENTS } from '@core/htmlAttributes'
import { resolveSelectInitialValue } from './selectInitialValue'
const CONTROLS = new Set(['base.input', 'base.select', 'base.textarea', 'base.checkbox', 'base.radio'])

export function assertSiteForms(site: SiteDocument) {
  for (const scope of publishedRenderScopes(site)) assertPageForms(resolvePublishedFormScope(site, scope))
}
function fields(condition: PropertyCondition): string[] {
  if ('and' in condition) return condition.and.flatMap(fields)
  if ('or' in condition) return condition.or.flatMap(fields)
  return [condition.field]
}
function assertPageForms(page: Page) {
  const formIds = new Set<string>()
  const valuesByForm = new Map<string, Record<string, unknown>>()
  function fail(node: PageNode, message: string): never { throw new FormConfigurationError(message, `pages.${page.id}.nodes.${node.id}`) }
  function nearestForm(node: PageNode) {
    let parent = getParent(page, node.id)
    while (parent) { if (parent.moduleId === 'base.form') return parent; parent = getParent(page, parent.id) }
    return null
  }
  function assertLink(link: PageNode, values: Record<string, unknown>) {
    if (link.props.expression !== undefined && link.props.expression !== null && !compiledCheck(FormValueExpressionSchema, link.props.expression)) fail(link, 'Invalid form link expression')
    if (link.props.expression && link.props.valueField) fail(link, 'Choose a named URL value or an inline expression')
    try {
      const value = compiledCheck(FormValueExpressionSchema, link.props.expression) ? evaluateFormExpression(link.props.expression, values) : values[String(link.props.valueField)]
      if (typeof value !== 'string') fail(link, 'Form links require a URL string value')
      formValueUrl(value)
    } catch (error) { fail(link, error instanceof Error ? error.message : 'Invalid form link expression') }
  }
  for (const node of Object.values(page.nodes)) {
    if (['base.turnstile','base.form-conditional','base.form-output','base.form-link','base.form-step'].includes(node.moduleId) && !nearestForm(node) && !(node.moduleId === 'base.form-link' && node.props.formId)) fail(node, 'Native form behavior must belong to a form')
    if (node.moduleId !== 'base.form') continue
    if (nearestForm(node)) fail(node, 'Nested HTML forms are invalid')
    const configuration = Value.Default(FormConfigurationSchema, structuredClone(node.props))
    if (!compiledCheck(FormConfigurationSchema, configuration)) fail(node, 'Invalid form configuration')
    const calculations = configuration.calculations
    const formId = normalizeIdentifierValue(configuration.formId, 'form')
    if (formIds.has(formId)) fail(node, 'Duplicate form ID on the rendered page')
    formIds.add(formId)
    let ancestor = getParent(page, node.id)
    while (ancestor) {
      if (ancestor.moduleId === 'base.loop') fail(node, 'Forms require a stable page instance outside content loops')
      ancestor = getParent(page, ancestor.id)
    }
    if (configuration.submitTargetId) {
      if (configuration.mode !== 'local') fail(node, 'Submit targets belong to local forms')
      const targetId = normalizeIdentifierValue(configuration.submitTargetId, '')
      if (!Object.values(page.nodes).some((target) => {
        const attributes = target.props.htmlAttributes
        return target.props.id === targetId || attributes !== null && typeof attributes === 'object' && 'id' in attributes && attributes.id === targetId
      })) fail(node, 'Local submit target must identify a rendered node on the page')
    }
    if (configuration.mode === 'request') {
      let endpoint: URL
      try { endpoint = new URL(configuration.action, 'https://instatic.invalid') } catch { fail(node, 'Invalid request endpoint') }
      if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || !configuration.action.trim() || configuration.action.startsWith('//')) fail(node, 'Request endpoints require a relative or HTTP(S) URL without credentials')
      if (configuration.responseSuccessField === configuration.responseMessageField) fail(node, 'Success and message response fields must be distinct')
    }
    const descendants = flattenSubtree(page, node.id).map((id) => page.nodes[id]).filter((child) => child && child.id !== node.id)
    const controlByName = new Map<string, PageNode>()
    const checkboxGroups = new Map<string, PageNode[]>()
    for (const control of descendants.filter((entry) => CONTROLS.has(entry.moduleId))) {
      const name = String(control.props.name || control.props.fieldId || '')
      if (!name) continue
      const previous = controlByName.get(name)
      if (previous && !(previous.moduleId === control.moduleId && ['base.radio','base.checkbox'].includes(control.moduleId) && previous.props.fieldId === control.props.fieldId)) fail(control, 'Duplicate control name')
      controlByName.set(name, control)
      if (control.moduleId === 'base.checkbox') { const members = checkboxGroups.get(name) ?? []; members.push(control); checkboxGroups.set(name, members) }
    }
    for (const members of checkboxGroups.values()) {
      const settings = members.map((control) => {
        const setting = Value.Default(CheckboxGroupSchema, Object.fromEntries(Object.keys(CheckboxGroupSchema.properties).filter((key) => Object.hasOwn(control.props, key)).map((key) => [key, control.props[key]])))
        if (!compiledCheck(CheckboxGroupSchema, setting)) fail(control, 'Invalid checkbox selection settings')
        return setting
      })
      if (members.length < 2 && settings.some((setting) => setting.minSelected || setting.maxSelected || setting.selectionOverflow !== 'reject')) fail(members[0], 'Selection limits require a checkbox collection')
      const first = settings[0]
      if (settings.some((setting) => setting.minSelected !== first.minSelected || setting.maxSelected !== first.maxSelected || setting.selectionOverflow !== first.selectionOverflow)) fail(members[0], 'Checkbox collection members require identical selection settings')
      if (first.maxSelected && first.minSelected > first.maxSelected || first.minSelected > members.length) fail(members[0], 'Invalid checkbox selection bounds')
      const selected = members.filter((member) => member.props.checked && !member.props.disabled).length
      if (selected < first.minSelected || first.maxSelected && selected > first.maxSelected) fail(members[0], 'Initial checkbox selection violates its bounds')
      if (new Set(members.map((member) => String(member.props.value ?? 'on'))).size !== members.length) fail(members[0], 'Checkbox collection values must be unique')
    }
    function assertCondition(owner: PageNode, value: unknown) {
      if (value === undefined || value === null) return
      if (!compiledCheck(PropertyConditionSchema, value)) fail(owner, 'Invalid declarative condition')
      for (const name of fields(value)) {
        if (Object.hasOwn(calculations, name)) continue
        const selector = controlByName.get(name)
        if (!selector || selector.props.disabled || selector.props.valueSourceField || selector.props.multiple) fail(owner, `Condition requires an enabled scalar control: ${name}`)
        let parent = getParent(page, selector.id)
        while (parent && parent.id !== node.id) {
          if (parent.moduleId === 'base.form-conditional' && parent.props.disableWhenHidden !== false && parent.props.condition) fail(owner, `Condition selectors must be outside conditional groups: ${name}`)
          parent = getParent(page, parent.id)
        }
      }
    }
    if (configuration.fragmentField) {
      if (configuration.mode !== 'local') fail(node, 'Fragment selection requires a local form')
      assertCondition(node, { field: configuration.fragmentField, notEq: null })
      const selector = controlByName.get(configuration.fragmentField)
      if (!selector || selector.moduleId !== 'base.radio' && selector.moduleId !== 'base.select' || selector.props.multiple) fail(node, 'Fragment selection requires an offered radio or select choice')
    }
    let hasBehavior = Object.keys(calculations).length > 0
    let captchaCount = 0
    const syncGroups = new Map<string, PageNode[]>()
    for (const child of descendants) {
      if (child.moduleId === 'base.form-conditional') { hasBehavior = true; assertCondition(child, child.props.condition) }
      if (child.moduleId === 'base.form-output') {
        hasBehavior = true
        if (VOID_HTML_ELEMENTS.has(resolveHtmlTag(String(child.props.tag || 'custom'), String(child.props.customTag || 'output')))) fail(child, 'Form values require a non-void HTML tag')
        if (child.children.length && !child.props.cssVariable) fail(child, 'Only CSS value outputs can preserve authored child content')
        if (!controlByName.has(String(child.props.fieldName)) && !Object.hasOwn(calculations, String(child.props.fieldName))) fail(child, 'Output requires an existing control or derived value name')
      }
      if (child.moduleId === 'base.form-message') {
        if (VOID_HTML_ELEMENTS.has(resolveHtmlTag(String(child.props.tag || 'div'), String(child.props.customTag || '')))) fail(child, 'Form messages require a non-void HTML tag')
        if (child.children.length && child.props.source !== 'authored') fail(child, 'Only authored form messages can preserve child content')
      }
      if (child.moduleId === 'base.form-link') {
        hasBehavior = true
        if (!child.props.expression && !child.props.formId && !controlByName.has(String(child.props.valueField)) && !Object.hasOwn(calculations, String(child.props.valueField))) fail(child, 'Form links require an existing URL value name')
      }
      if (child.moduleId === 'base.form-step') {
        hasBehavior = true
        const target = controlByName.get(String(child.props.fieldName))
        if (!target || target.moduleId !== 'base.input' || !['range','number'].includes(String(target.props.inputType)) || target.props.disabled || target.props.readOnly || !Number.isFinite(child.props.step) || child.props.step === 0) fail(child, 'Step controls require an enabled editable numeric input and a nonzero step')
        assertCondition(child, child.props.disabledWhen)
      }
      if (CONTROLS.has(child.moduleId)) {
        const generatedNames = MODULE_GENERATED_ATTRIBUTE_NAMES[child.moduleId] ?? []
        for (const name of Object.keys(child.props.htmlAttributes ?? {})) {
          if (generatedNames.includes(normalizeHtmlAttributeName(name))) fail(child, `HTML attribute is managed by native control props: ${name}`)
        }
        const behavior = Value.Default(FormControlBehaviorSchema, Object.fromEntries(Object.keys(FormControlBehaviorSchema.properties).filter((key) => Object.hasOwn(child.props, key)).map((key) => [key, child.props[key]])))
        if (!compiledCheck(FormControlBehaviorSchema, behavior)) fail(child, 'Invalid native control behavior')
        if (behavior.submitOnChange) {
          if (configuration.mode !== 'local' || !configuration.submitTargetId) fail(child, 'Change actions require a local form with a declared submit target')
          hasBehavior = true
        }
        assertCondition(child, child.props.requiredWhen)
        assertCondition(child, child.props.disabledWhen)
        if (child.props.requiredWhen || child.props.disabledWhen || child.props.minValueField || child.props.maxValueField || child.props.clearFieldsOnChange || child.props.queryParameter || child.props.lockQueryValue || child.props.valueSourceField || child.props.syncGroup || child.props.requiredMessage || child.props.invalidMessage) hasBehavior = true
        for (const name of String(child.props.clearFieldsOnChange || '').split(',').map((value) => value.trim()).filter(Boolean)) {
          const target = controlByName.get(name)
          if (!target || target === child || target.props.readOnly || target.props.lockQueryValue || target.props.disabled || target.moduleId !== 'base.textarea' && !(target.moduleId === 'base.input' && ['text','search','tel','email','url','password','hidden'].includes(String(target.props.inputType || 'text')))) fail(child, 'Clear-on-change targets require another editable text control in the same form')
        }
        if (child.props.minValueField || child.props.maxValueField) {
          if (child.moduleId !== 'base.input' || !['number','range'].includes(String(child.props.inputType)) || child.props.syncGroup) fail(child, 'Dynamic bounds require an independent numeric input')
          for (const name of [child.props.minValueField, child.props.maxValueField].filter(Boolean)) if (!Object.hasOwn(calculations, String(name))) fail(child, 'Dynamic bounds require a declared derived numeric value')
        }
        if (behavior.syncGroup) {
          if (!String(child.props.name || child.props.fieldId || '') || child.props.disabled || child.props.readOnly || child.props.multiple || child.moduleId === 'base.checkbox' || child.props.inputType === 'file') fail(child, 'Shared value groups require named, enabled scalar controls')
          if (behavior.valueSourceField || behavior.lockQueryValue) fail(child, 'Shared value groups cannot mirror or lock another control value')
          let parent = getParent(page, child.id)
          while (parent && parent.id !== node.id) {
            if (parent.moduleId === 'base.form-conditional' && parent.props.disableWhenHidden !== false && parent.props.condition) fail(child, 'Shared value controls must be outside conditional groups')
            parent = getParent(page, parent.id)
          }
          const group = syncGroups.get(behavior.syncGroup) ?? []
          group.push(child); syncGroups.set(behavior.syncGroup, group)
        }
        if (child.props.valueTargetField) {
          const target = controlByName.get(String(child.props.valueTargetField))
          if (!target || target.id === child.id || target.props.disabled || target.props.disabledWhen || target.props.readOnly || target.props.multiple || target.props.valueSourceField || target.props.valueTargetField || ['base.radio','base.checkbox'].includes(target.moduleId) || target.props.inputType === 'file') fail(child, 'Projected edits require an independent enabled scalar target')
          if (child.props.syncGroup || child.props.queryParameter || !child.props.valueSourceField || child.props.multiple || ['base.radio','base.checkbox'].includes(child.moduleId) || child.props.inputType === 'file') fail(child, 'Projected controls require a read value and cannot share, query-initialize or collect choices')
          const sourceName = String(child.props.valueSourceField), source = controlByName.get(sourceName)
          if (!Object.hasOwn(calculations, sourceName) && (!source || source.id === child.id || source.props.valueSourceField || source.props.valueTargetField || source.props.disabled || source.props.multiple || ['base.radio','base.checkbox'].includes(source.moduleId) || source.props.inputType === 'file')) fail(child, 'Projected controls require an independent scalar or derived read value')
          if (source) assertCondition(child, { field: sourceName, notEq: null })
          let parent = getParent(page, target.id)
          while (parent && parent.id !== node.id) {
            if (parent.moduleId === 'base.form-conditional' && parent.props.disableWhenHidden !== false && parent.props.condition) fail(child, 'Projected edit targets must be outside conditional groups')
            parent = getParent(page, parent.id)
          }
          hasBehavior = true
        } else if (child.props.valueSourceField) {
          const source = controlByName.get(String(child.props.valueSourceField))
          if (!source || source.props.valueSourceField || child.moduleId !== 'base.input' || child.props.inputType !== 'hidden' || child.props.queryParameter) fail(child, 'Synchronized values require a hidden input and a direct source control')
          if (source.props.disabled || source.props.multiple || ['base.checkbox', 'base.radio'].includes(source.moduleId) || source.props.inputType === 'file') fail(child, 'Synchronized values require an enabled scalar source that is always submitted')
          let parent = getParent(page, source.id)
          while (parent && parent.id !== node.id) {
            if (parent.moduleId === 'base.form-conditional' && parent.props.disableWhenHidden !== false && parent.props.condition) fail(child, 'Synchronized source controls must be outside conditional groups')
            parent = getParent(page, parent.id)
          }
        }
        if (child.props.queryParameter && (child.moduleId === 'base.checkbox' || child.props.multiple || child.props.inputType === 'file')) fail(child, 'Query initialization requires a single text, select or radio value')
        if (child.props.lockQueryValue && (!child.props.queryParameter || child.moduleId === 'base.radio' || child.moduleId === 'base.checkbox' || (child.moduleId === 'base.input' && ['hidden', 'file', 'range'].includes(String(child.props.inputType))))) fail(child, 'Query locking requires a declared query parameter on a text or select control supporting readonly semantics')
        if (child.props.trimOnSubmit) {
          if (child.moduleId !== 'base.textarea' && (child.moduleId !== 'base.input' || ['file','range','number','date','time','datetime-local'].includes(String(child.props.inputType)))) fail(child, 'Trimming requires a text control')
          hasBehavior = true
        }
        if (child.props.lockQueryValue && behavior.resetBehavior === 'clear') fail(child, 'A locked query value cannot be cleared by reset')
        if (child.props.valueSourceField && behavior.resetBehavior !== 'initial') fail(child, 'Synchronized values reset through their source control')
        if (child.props.inputType === 'file' && behavior.resetBehavior === 'preserve') fail(child, 'File inputs cannot preserve selected files after reset')
        if (behavior.resetBehavior !== 'initial') hasBehavior = true
      }
      if (child.moduleId === 'base.turnstile') {
        hasBehavior = true; captchaCount++
        if (configuration.mode === 'cms') fail(child, 'CMS forms use native challenges; Turnstile requires a recipient with server-side verification')
        if (configuration.mode === 'local') fail(child, 'Verification widgets require a recipient transport')
        if (typeof child.props.siteKey !== 'string' || !child.props.siteKey.trim()) fail(child, 'Configure an explicit public Turnstile site key')
        if (!compiledCheck(TurnstileConfigurationSchema, child.props)) fail(child, 'Invalid Turnstile configuration; use a documented language code')
        if (!/^[a-zA-Z0-9_-]{0,32}$/.test(child.props.action)) fail(child, 'Invalid Turnstile action')
        let parent = getParent(page, child.id)
        while (parent && parent.id !== node.id) {
          if (parent.moduleId === 'base.form-conditional' && parent.props.disableWhenHidden !== false && parent.props.condition) fail(child, 'Verification widgets must be outside conditional groups')
          parent = getParent(page, parent.id)
        }
      }
    }
    const initial: Record<string, unknown> = Object.create(null)
    const constraints: FormValueConstraint[] = []
    for (const [name, control] of controlByName) {
      if (control.moduleId === 'base.radio') {
        const selected = descendants.find((entry) => entry.moduleId === 'base.radio' && (entry.props.name || entry.props.fieldId) === name && entry.props.checked)
        if (selected) initial[name] = selected.props.value ?? 'on'
      } else if (control.moduleId === 'base.checkbox') {
        const members = checkboxGroups.get(name)!
        initial[name] = members.length > 1 ? members.filter(entry => entry.props.checked).map(entry => entry.props.value ?? 'on') : control.props.checked ? control.props.value ?? 'on' : ''
      }
      else if (control.moduleId === 'base.select') initial[name] = resolveSelectInitialValue(control, (id) => page.nodes[id])
      else initial[name] = control.props.value ?? ''
      if (control.props.minValueField || control.props.maxValueField) constraints.push({ fieldName: name, minValueField: String(control.props.minValueField || ''), maxValueField: String(control.props.maxValueField || ''), ...(control.props.min !== '' && control.props.min !== undefined ? { min: Number(control.props.min) } : {}), ...(control.props.max !== '' && control.props.max !== undefined ? { max: Number(control.props.max) } : {}) })
    }
    for (const expression of Object.values(calculations)) for (const name of formExpressionFields(expression)) {
      if (Object.hasOwn(calculations, name)) continue
      const source = controlByName.get(name)
      if (!source || source.props.disabled || source.props.multiple || source.props.valueSourceField || source.props.inputType === 'file') fail(node, `Calculations require unconditional scalar controls or checkbox collections: ${name}`)
      let parent = getParent(page, source.id)
      while (parent && parent.id !== node.id) { if (parent.moduleId === 'base.form-conditional' && parent.props.disableWhenHidden !== false && parent.props.condition) fail(node, `Calculation selectors must be outside conditional groups: ${name}`); parent = getParent(page, parent.id) }
    }
    try {
      const computed = evaluateFormValues(calculations, initial, constraints)
      valuesByForm.set(formId, computed)
      for (const child of descendants) {
        if (child.moduleId === 'base.form-output' && child.props.cssVariable && (!/^--[A-Za-z][A-Za-z0-9_-]*$/.test(String(child.props.cssVariable)) || typeof computed[String(child.props.fieldName)] !== 'number' || !Number.isFinite(computed[String(child.props.fieldName)]))) fail(child, 'CSS value outputs require a custom property name and a finite numeric value')
        if (child.moduleId === 'base.form-link' && !child.props.formId) assertLink(child, computed)
      }
    } catch (error) { fail(node, error instanceof Error ? error.message : 'Invalid calculation dependency graph') }
    for (const [name, selector] of controlByName) if (selector.moduleId === 'base.radio') {
      const group = descendants.filter(control => control.moduleId === 'base.radio' && String(control.props.name || control.props.fieldId || '') === name)
      const parameters = new Set(group.map(control => String(control.props.queryParameter || '')).filter(Boolean))
      if (parameters.size > 1) fail(selector, 'A radio group requires one query parameter')
      if (parameters.size) {
        assertCondition(selector, { field: name, notEq: null })
        if (new Set(group.map(control => String(control.props.value ?? 'on'))).size !== group.length) fail(selector, 'Query radio values must be unique')
      }
    }
    for (const group of syncGroups.values()) {
      const initial = new Set<string>()
      const policies = new Set(group.map((control) => control.props.resetBehavior ?? 'initial'))
      if (policies.size !== 1 || policies.has('clear')) fail(group[0], 'Shared value controls require one initial or preserve reset policy')
      if (group.filter((control) => control.props.queryParameter).length > 1) fail(group[0], 'Shared value groups support one query initializer')
      const choices = new Map<string, string[]>()
      const ranges: PageNode[] = []
      let hasText = false
      for (const control of group) {
        const name = String(control.props.name || control.props.fieldId)
        if (control.moduleId === 'base.radio') {
          const offered = choices.get(name) ?? []; offered.push(String(control.props.value ?? 'on')); choices.set(name, offered)
          if (control.props.checked) initial.add(String(control.props.value ?? 'on'))
        } else if (control.moduleId === 'base.select') {
          choices.set(name, flattenSubtree(page, control.id).map((id) => page.nodes[id]).filter((option) => option?.moduleId === 'base.option' && !option.props.disabled && !getParent(page, option.id)?.props.disabled).map((option) => String(option.props.value ?? '')))
          initial.add(String(resolveSelectInitialValue(control, (id) => page.nodes[id])))
        } else {
          if (control.props.inputType === 'range') ranges.push(control)
          else if (control.moduleId === 'base.textarea' || control.moduleId === 'base.input' && ['text', 'search', 'tel', 'password', 'hidden'].includes(String(control.props.inputType ?? 'text'))) hasText = true
          else fail(control, 'Shared value controls require plain text or finite choices')
          initial.add(String(control.props.value ?? ''))
        }
      }
      if (initial.size !== 1) fail(group[0], 'Shared value controls require the same initial value')
      for (const control of group.filter((entry) => entry.moduleId === 'base.radio')) {
        const name = control.props.name || control.props.fieldId
        if (group.filter((entry) => entry.moduleId === 'base.radio' && (entry.props.name || entry.props.fieldId) === name && entry.props.checked).length !== 1) fail(control, 'Shared value radio groups require one checked choice')
      }
      const offered = [...choices.values()]
      if (offered.some((values) => !values.includes([...initial][0]))) fail(group[0], 'Shared initial values must be offered choices')
      if (hasText && (offered.length || ranges.length)) fail(group[0], 'Shared value groups cannot mix unrestricted text and finite choices')
      if (offered.some((values) => values.length !== new Set(values).size || values.length !== offered[0].length || values.some((value) => !offered[0].includes(value)))) fail(group[0], 'Shared value groups require identical offered choices')
      const rangeDomains = ranges.map((range) => ({ min: Number(range.props.min || 0), max: Number(range.props.max || 100), step: Number(range.props.step || 1) }))
      for (const domain of rangeDomains) {
        const count = (domain.max - domain.min) / domain.step
        if (!Number.isFinite(count) || domain.step <= 0 || count < 0 || !Number.isInteger(count)) fail(group[0], 'Shared value ranges require finite, evenly spaced values')
        const initialNumber = Number([...initial][0])
        if (!Number.isFinite(initialNumber) || initialNumber < domain.min || initialNumber > domain.max || !Number.isInteger((initialNumber - domain.min) / domain.step)) fail(group[0], 'Shared initial values must be valid range values')
        if (offered.length && (offered[0].length !== count + 1 || offered[0].some((value) => String(Number(value)) !== value || Number(value) < domain.min || Number(value) > domain.max || !Number.isInteger((Number(value) - domain.min) / domain.step)))) fail(group[0], 'Shared value ranges must match every offered choice')
        if (rangeDomains.some((peer) => peer.min !== domain.min || peer.max !== domain.max || peer.step !== domain.step)) fail(group[0], 'Shared value ranges require identical bounds and step')
      }
    }
    if (captchaCount > 1) fail(node, 'A form supports one Turnstile widget')
    if ((configuration.mode === 'cms' || (configuration.mode === 'request' && configuration.encoding === 'json')) && descendants.some((child) => child.moduleId === 'base.input' && child.props.inputType === 'file')) fail(node, 'File inputs require multipart submission to a declared recipient')
    if (configuration.mode === 'custom' && hasBehavior && !configuration.enhance) fail(node, 'Enable form behavior for an HTML action using native conditions or verification')
  }
  for (const link of Object.values(page.nodes)) if (link.moduleId === 'base.form-link' && link.props.formId) {
    const values = valuesByForm.get(normalizeIdentifierValue(String(link.props.formId), 'form'))
    if (!values) fail(link, 'Unknown associated form')
    assertLink(link, values)
  }
}
