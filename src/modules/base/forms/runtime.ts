import type { Static } from '@sinclair/typebox'
import type { PropertyCondition } from '@core/module-engine-schema'
import { evaluateCondition } from '@core/value-conditions'
import type { FormTransport, FormChallengeResponse, FormValidationResponseSchema, TurnstileApi, FormCalculations, FormValueConstraint } from '@core/forms-schema'
import { evaluateFormValues, evaluateFormExpression, formValueUrl } from '@core/form-values'
import { checkCondition, checkTransport, checkControl, checkCalculations, checkExpression, checkCheckboxGroup, checkValuesRequest, checkChallenge, checkJsonResponse, checkTurnstileConfiguration, checkTurnstileApi, checkValidationResponse, checkSuccessResponse, checkResponseContract } from './runtimeValidators.js'

const FORM_SELECTOR = 'form[data-instatic-form-id][data-instatic-form-mode="cms"], form[data-instatic-form-id][data-instatic-form-mode="request"], form[data-instatic-form-id][data-instatic-form-mode="local"], form[data-instatic-form-id][data-instatic-form-mode="custom"][data-instatic-form-enhanced="true"]'
const CONTROL_SELECTOR = '[data-instatic-form-control]'
type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
type ControlValue = { value: string; checked?: boolean; options?: boolean[]; queryError: boolean; min?: string; max?: string }
type State = 'idle' | 'pending' | 'success' | 'error' | 'invalid' | 'captcha' | 'unavailable'
class SubmissionError extends Error {
  readonly state: State
  readonly errors?: Static<typeof FormValidationResponseSchema>['errors']
  constructor(state: State, errors?: Static<typeof FormValidationResponseSchema>['errors']) { super('Native form submission failed'); this.state = state; this.errors = errors }
}
type FormState = {
  transport: FormTransport; challenge?: FormChallengeResponse; challengeRequest?: Promise<FormChallengeResponse>
  busy: boolean; buttons: Map<HTMLButtonElement | HTMLInputElement, { disabled: boolean; children?: ChildNode[]; value?: string }>; widgets: Map<HTMLElement, string>
  widgetRequest?: Promise<void>
  queryErrors: Set<Control>
  initialValues: Map<Control, ControlValue>
  calculations: FormCalculations
  choiceOrder: Map<string, HTMLInputElement[]>
  values: Record<string, unknown>
}

/** The only browser behavior for native forms. All user-visible copy is authored HTML. */
export function installFormRuntime(browser: Window & typeof globalThis) {
  const document = browser.document
  if (document.documentElement.hasAttribute('data-instatic-form-runtime')) return
  document.documentElement.setAttribute('data-instatic-form-runtime', '')
  const attached = new WeakMap<HTMLFormElement, FormState>()
  const htmlSubmitReady = new WeakSet<HTMLFormElement>()
  const managedResets = new WeakSet<HTMLFormElement>()
  const widgetThemes = new WeakMap<HTMLElement, string>()
  let providerRequest: Promise<TurnstileApi> | undefined

  function controls(form: HTMLFormElement): Control[] {
    return Array.from(form.querySelectorAll(CONTROL_SELECTOR)).filter((element): element is Control =>
      element instanceof browser.HTMLInputElement || element instanceof browser.HTMLTextAreaElement || element instanceof browser.HTMLSelectElement)
  }
  function offeredOption(control: HTMLSelectElement, value: string) {
    return Array.from(control.options).find(option => option.value === value && !option.disabled && !(option.parentElement instanceof browser.HTMLOptGroupElement && option.parentElement.disabled))
  }
  function synchronize(form: HTMLFormElement, source: Control, clearQueryErrors = false) {
    const group = data(source, 'sync-group')
    if (!group || (source instanceof browser.HTMLInputElement && source.type === 'radio' && !source.checked)) return
    for (const control of controls(form)) {
      if (data(control, 'sync-group') !== group) continue
      if (control instanceof browser.HTMLInputElement && control.type === 'radio') control.checked = control.value === source.value
      else control.value = source.value
      if (clearQueryErrors) attached.get(form)?.queryErrors.delete(control)
    }
  }
  function synchronizeChoices(form: HTMLFormElement, source: Control) {
    if (!(source instanceof browser.HTMLInputElement) || source.type !== 'checkbox') return
    const current = attached.get(form)
    if (!current) return
    const members = controls(form).filter((control): control is HTMLInputElement => control instanceof browser.HTMLInputElement && control.type === 'checkbox' && control.name === source.name)
    if (members.length < 2) return
    const min = Number(data(source, 'choice-min-selected') || 0), max = Number(data(source, 'choice-max-selected') || 0)
    let order = current.choiceOrder.get(source.name) ?? members.filter((control) => control.checked && control !== source)
    if (!source.checked) {
      if (members.filter((control) => control.checked).length < min) source.checked = true
      else order = order.filter((control) => control !== source)
    } else if (!order.includes(source)) {
      if (max && order.length >= max) {
        if (data(source, 'choice-overflow') === 'drop-oldest') { const oldest = order.shift(); if (oldest) oldest.checked = false }
        else source.checked = false
      }
      if (source.checked) order.push(source)
    }
    current.choiceOrder.set(source.name, order.filter((control) => control.checked))
  }
  function captureChoiceOrder(form: HTMLFormElement, current: FormState) {
    current.choiceOrder.clear()
    for (const control of controls(form)) if (control instanceof browser.HTMLInputElement && control.type === 'checkbox' && control.checked) {
      const order = current.choiceOrder.get(control.name) ?? []
      order.push(control); current.choiceOrder.set(control.name, order)
    }
  }
  function clearDependentFields(form: HTMLFormElement, source: Control) {
    const names = data(source, 'clear-fields-on-change').split(',').map((name) => name.trim()).filter(Boolean)
    for (const control of controls(form)) if (names.includes(control.name)) { control.value = ''; attached.get(form)?.queryErrors.delete(control); synchronize(form, control, true) }
  }
  function clearQueryError(form: HTMLFormElement, source: Control) {
    const errors = attached.get(form)?.queryErrors
    errors?.delete(source)
    if (source instanceof browser.HTMLInputElement && source.type === 'radio' && source.checked) {
      for (const control of controls(form)) if (control instanceof browser.HTMLInputElement && control.type === 'radio' && control.name === source.name) errors?.delete(control)
    }
  }
  function writeTarget(form: HTMLFormElement, source: Control) {
    const name = data(source, 'value-target')
    if (!name || source.disabled) return
    const target = controls(form).find(control => control.name === name)
    if (!target || target.disabled || data(target, 'value-source') || data(target, 'value-target')) throw new Error('Invalid projected edit target')
    let value = source.value
    if (target instanceof browser.HTMLInputElement && ['number','range'].includes(target.type) && value.trim() && Number.isFinite(Number(value))) value = String(Math.min(target.max !== '' ? Number(target.max) : Infinity, Math.max(target.min !== '' ? Number(target.min) : -Infinity, Number(value))))
    target.value = value
    clearQueryError(form, target); synchronize(form, target, true)
  }
  function isForm(element: EventTarget | null): element is HTMLFormElement {
    return element instanceof browser.HTMLFormElement && element.matches(FORM_SELECTOR)
  }
  function data(element: HTMLElement, key: string) { return element.getAttribute(`data-instatic-${key}`) ?? '' }
  function emitValues(form: HTMLFormElement, currentValues: Record<string, unknown>) {
    const snapshot = Object.fromEntries(Object.entries(currentValues).map(([name, value]) => [name, Array.isArray(value) ? [...value] : value]))
    form.dispatchEvent(new browser.CustomEvent('instatic:form-values', { bubbles: true, detail: { formId: data(form, 'form-id'), values: snapshot } }))
  }
  function messages(form: HTMLFormElement) {
    const id = data(form, 'form-id')
    return Array.from(document.querySelectorAll<HTMLElement>('[data-instatic-form-message]'))
      .filter((message) => form.contains(message) || data(message, 'form-id') === id)
  }
  function state(form: HTMLFormElement, next: State, response = '') {
    form.setAttribute('data-instatic-form-state', next)
    const kind = next === 'success' ? 'success' : next === 'pending' || next === 'idle' ? 'status' : 'error'
    const copy = next === 'idle' ? '' : data(form, `${next === 'success' ? 'success' : next}-message`)
    for (const message of messages(form)) {
      const visible = next !== 'idle' && data(message, 'form-message') === kind
      const source = data(message, 'message-source')
      if (source === 'response') message.textContent = response
      else if (source === 'responseOrState') message.textContent = response || copy
      else if (source !== 'authored') message.textContent = copy
      message.hidden = !visible || !message.textContent
    }
    if (next !== 'idle' && next !== 'pending') messages(form).find(message => !message.hidden && message.getAttribute('tabindex') === '-1')?.focus()
  }
  function busy(form: HTMLFormElement, value: boolean) {
    const current = attached.get(form)
    if (!current) return
    current.busy = value
    form.setAttribute('aria-busy', String(value))
    if (value) {
      for (const button of form.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input[type="submit"], input[type="button"]')) {
        const pending = data(button, 'pending-label')
        current.buttons.set(button, { disabled: button.disabled, ...(pending ? button instanceof browser.HTMLInputElement ? { value: button.value } : { children: [...button.childNodes] } : {}) })
        if (pending) { if (button instanceof browser.HTMLInputElement) button.value = pending; else button.textContent = pending }
        button.disabled = true
      }
    } else {
      for (const [button, previous] of current.buttons) {
        button.disabled = previous.disabled
        if (previous.children) button.replaceChildren(...previous.children)
        if (previous.value !== undefined && button instanceof browser.HTMLInputElement) button.value = previous.value
      }
      current.buttons.clear()
    }
  }
  function values(form: HTMLFormElement, includeDisabled = false): Record<string, unknown> {
    const result: Record<string, unknown> = Object.create(null)
    const all = controls(form)
    const checkboxNames = new Map<string, number>()
    for (const control of all) if (control instanceof browser.HTMLInputElement && control.type === 'checkbox') checkboxNames.set(control.name, (checkboxNames.get(control.name) ?? 0) + 1)
    for (const control of all) {
      if (!control.name || (!includeDisabled && control.disabled)) continue
      if (control instanceof browser.HTMLInputElement && control.type === 'checkbox' && (checkboxNames.get(control.name) ?? 0) > 1) {
        const selected = result[control.name] ?? []
        if (!Array.isArray(selected)) throw new Error('Invalid native checkbox collection')
        if (control.checked) selected.push(control.value)
        result[control.name] = selected
        continue
      }
      if (control instanceof browser.HTMLInputElement && control.type === 'checkbox' && !control.checked) { result[control.name] = ''; continue }
      if (control instanceof browser.HTMLInputElement && control.type === 'radio' && !control.checked) continue
      const value = control instanceof browser.HTMLSelectElement && control.multiple
        ? Array.from(control.selectedOptions, (option) => option.value) : control.value
      result[control.name] = value
    }
    return result
  }
  function condition(element: HTMLElement, name: string): PropertyCondition | null {
    const raw = data(element, name)
    if (!raw || raw === 'null') return null
    const parsed: unknown = JSON.parse(raw)
    if (!checkCondition(parsed)) throw new Error('Invalid native form condition')
    return parsed
  }
  function update(form: HTMLFormElement) {
    // Selectors must be unconditional: the authoring preflight rejects cycles.
    const calculations = attached.get(form)?.calculations ?? {}
    const constraints: FormValueConstraint[] = controls(form).filter((control) => data(control, 'min-value-field') || data(control, 'max-value-field')).map((control) => ({ fieldName: control.name, minValueField: data(control, 'min-value-field'), maxValueField: data(control, 'max-value-field'), ...(control instanceof browser.HTMLInputElement && control.min !== '' ? { min: Number(control.min) } : {}), ...(control instanceof browser.HTMLInputElement && control.max !== '' ? { max: Number(control.max) } : {}) }))
    const currentValues = evaluateFormValues(calculations, values(form, true), constraints)
    for (const control of controls(form)) {
      if (control instanceof browser.HTMLInputElement && (data(control, 'min-value-field') || data(control, 'max-value-field'))) {
        const minimum = data(control, 'min-value-field'), maximum = data(control, 'max-value-field')
        if (minimum) control.min = String(currentValues[minimum])
        if (maximum) control.max = String(currentValues[maximum])
        control.value = String(currentValues[control.name])
      }
    }
    for (const group of form.querySelectorAll<HTMLElement>('[data-instatic-form-condition]')) {
      const rule = condition(group, 'form-condition')
      group.hidden = rule !== null && !evaluateCondition(rule, currentValues)
    }
    for (const control of controls(form)) {
      const rule = condition(control, 'required-when')
      let active = true
      for (let parent = control.parentElement; parent && parent !== form; parent = parent.parentElement) {
        if (parent.hasAttribute('data-instatic-form-condition') && parent.hidden && data(parent, 'disable-when-hidden') !== 'false') active = false
      }
      const disabledWhen = condition(control, 'disabled-when')
      control.disabled = data(control, 'disabled') === 'true' || !active || (disabledWhen !== null && evaluateCondition(disabledWhen, currentValues))
      control.required = active && (rule ? evaluateCondition(rule, currentValues) : data(control, 'required') === 'true')
      const source = data(control, 'value-source')
      if (source && Object.hasOwn(currentValues, source)) control.value = String(currentValues[source] ?? '')
      control.setCustomValidity('')
      if (!control.disabled && !control.validity.valid) {
        const message = data(control, control.validity.valueMissing ? 'required-message' : 'invalid-message')
        if (message) control.setCustomValidity(message)
      }
    }
    const updated = { ...values(form), ...Object.fromEntries(Object.keys(calculations).map((name) => [name, currentValues[name]])) }
    applyValueBindings(form, updated)
    const current = attached.get(form)
    if (current) current.values = updated
    for (const control of attached.get(form)?.queryErrors ?? []) control.setCustomValidity(data(control, 'invalid-message') || data(form, 'invalid-message'))
    emitValues(form, updated)
  }
  function applyValueBindings(form: HTMLFormElement, updated: Record<string, unknown>) {
    for (const output of form.querySelectorAll<HTMLOutputElement>('[data-instatic-form-output]')) {
      const value = updated[data(output, 'form-output')], variable = data(output, 'form-css-variable')
      if (variable) {
        if (!/^--[A-Za-z][A-Za-z0-9_-]*$/.test(variable) || typeof value !== 'number' || !Number.isFinite(value)) throw new Error('A form CSS variable requires a declared finite number')
        output.style.setProperty(variable, String(value))
      } else output.textContent = String(value ?? '')
    }
    for (const button of form.querySelectorAll<HTMLButtonElement>('[data-instatic-form-step]')) {
      const target = controls(form).find((control) => control.name === data(button, 'form-step'))
      if (!(target instanceof browser.HTMLInputElement)) throw new Error('A step control requires a numeric input')
      const rule = condition(button, 'step-disabled-when'), step = Number(data(button, 'step-amount'))
      button.disabled = target.disabled || (rule !== null && evaluateCondition(rule, updated)) || (step < 0 && target.min !== '' && Number(target.value) <= Number(target.min)) || (step > 0 && target.max !== '' && Number(target.value) >= Number(target.max))
    }
    for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-instatic-form-link]')) {
      const identity = data(link, 'form-id')
      if (identity ? identity !== data(form, 'form-id') : !form.contains(link)) continue
      const raw = data(link, 'form-expression')
      const expression: unknown = raw ? JSON.parse(raw) : null
      if (expression !== null && !checkExpression(expression)) throw new Error('Invalid form link expression')
      const value = expression && checkExpression(expression) ? evaluateFormExpression(expression, updated) : updated[data(link, 'form-link')]
      if (typeof value !== 'string') throw new Error('A form link requires a URL string')
      formValueUrl(value, browser.location.href)
      link.setAttribute('href', value)
    }
  }
  function initialize(form: HTMLFormElement) {
    const current = attached.get(form)
    if (!current) return false
    current.queryErrors.clear()
    const query = new URL(browser.location.href).searchParams
    const initialized = new Set<Control>()
    const initializedRadios = new Set<string>()
    for (const control of controls(form)) {
      const parameter = data(control, 'query-parameter')
      let initial = parameter ? query.get(parameter) : null
      if (initial === null) continue
      const limit = control instanceof browser.HTMLSelectElement ? 10000 : control.maxLength > 0 ? control.maxLength : 10000
      if (initial.length > limit) {
        if (data(control, 'query-overflow') === 'truncate') initial = initial.slice(0, limit)
        else { current.queryErrors.add(control); continue }
      }
      if (control instanceof browser.HTMLInputElement && control.type === 'radio') {
        if (initializedRadios.has(control.name)) continue
        initializedRadios.add(control.name)
        const group = controls(form).filter((member): member is HTMLInputElement => member instanceof browser.HTMLInputElement && member.type === 'radio' && member.name === control.name)
        const selected = group.find(member => member.value === initial && !member.disabled)
        if (!selected) { current.queryErrors.add(control); continue }
        for (const member of group) member.checked = member === selected
        initialized.add(selected)
        synchronize(form, selected)
        continue
      } else if (control instanceof browser.HTMLSelectElement) {
        const option = offeredOption(control, initial)
        if (!option) { current.queryErrors.add(control); continue }
        control.value = option.value
      } else if (!(control instanceof browser.HTMLInputElement) || !['file', 'radio', 'checkbox'].includes(control.type)) {
        const previous = control.value
        control.setCustomValidity('')
        control.value = initial
        if (control.value !== initial || (!control.validity.valid && !control.validity.valueMissing)) { control.value = previous; current.queryErrors.add(control); continue }
      }
      initialized.add(control)
      synchronize(form, control)
    }
    const fragment = initializeFragment(form)
    update(form)
    if (fragment !== null) queueMicrotask(() => scrollFragment(fragment))
    for (const control of initialized) {
      if (control.disabled) continue
      if (!control.validity.valid) { current.queryErrors.add(control); continue }
      if (data(control, 'query-lock') === 'true') {
        if (control instanceof browser.HTMLSelectElement) {
          for (const option of control.options) option.disabled = option.value !== control.value || option.disabled
        } else {
          control.readOnly = true
        }
      }
    }
    if (current.queryErrors.size) update(form)
    return current.queryErrors.size === 0
  }
  function initializeFragment(form: HTMLFormElement): string | null {
    const name = data(form, 'fragment-field')
    if (!name || data(form, 'form-mode') !== 'local' || !browser.location.hash) return null
    let value: string
    try { value = decodeURIComponent(browser.location.hash.slice(1)) }
    catch (_error) { return null } // A malformed visitor fragment leaves the authored selection intact.
    const members = controls(form).filter(control => control.name === name && !control.disabled)
    const choices = members.filter((control): control is HTMLInputElement => control instanceof browser.HTMLInputElement && control.type === 'radio')
    if (choices.length) {
      const selected = choices.find(control => control.value === value)
      if (!selected) return null
      for (const choice of choices) choice.checked = choice === selected
      synchronize(form, selected, true)
    } else {
      const control = members.length === 1 ? members[0] : undefined
      if (!(control instanceof browser.HTMLSelectElement) || control.multiple) return null
      const option = offeredOption(control, value)
      if (!option) return null
      control.value = option.value
      synchronize(form, control, true)
    }
    return value
  }
  function scrollFragment(value: string | null) {
    if (!value) return
    const target = document.getElementById(value)
    if (!target) return
    scrollTarget(target)
  }
  function scrollTarget(target: HTMLElement) {
    const reduced = document.documentElement.getAttribute('data-instatic-motion') === 'reduced' || browser.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
  }
  function refresh(form: HTMLFormElement) {
    try { update(form); return true }
    catch { state(form, 'unavailable'); return false }
  }
  function captureValue(control: Control, current: FormState): ControlValue {
    return { value: control.value, queryError: current.queryErrors.has(control),
      ...(control instanceof browser.HTMLInputElement && (data(control, 'min-value-field') || data(control, 'max-value-field')) ? { min: control.min, max: control.max } : {}),
      ...(control instanceof browser.HTMLInputElement && ['checkbox', 'radio'].includes(control.type) ? { checked: control.checked } : {}),
      ...(control instanceof browser.HTMLSelectElement ? { options: Array.from(control.options, (option) => option.selected) } : {}),
    }
  }
  function restoreValue(control: Control, value: ControlValue) {
    // Restore initial bounds before assigning a range value: browsers clamp
    // setters immediately against the current bounds, even during a reset.
    if (control instanceof browser.HTMLInputElement) { if (value.min !== undefined) control.min = value.min; if (value.max !== undefined) control.max = value.max }
    if (control instanceof browser.HTMLSelectElement && value.options) {
      for (const [index, option] of Array.from(control.options).entries()) option.selected = value.options[index] ?? false
      if (!value.options.some(Boolean)) control.selectedIndex = -1
    } else if (control instanceof browser.HTMLInputElement && ['checkbox', 'radio'].includes(control.type) && value.checked !== undefined) control.checked = value.checked
    else if (!(control instanceof browser.HTMLInputElement && control.type === 'file')) control.value = value.value
  }
  function resetValues(form: HTMLFormElement, current: FormState, preserved: Map<Control, ControlValue>) {
    current.queryErrors.clear()
    for (const control of controls(form)) {
      const behavior = data(control, 'reset-behavior')
      const value = behavior === 'preserve' ? preserved.get(control) : behavior === 'clear' ? { value: '', checked: false, options: [], queryError: false } : current.initialValues.get(control)
      if (value) { restoreValue(control, value); if (value.queryError) current.queryErrors.add(control) }
      control.setCustomValidity('')
    }
    captureChoiceOrder(form, current)
    // Initial values and locks are captured once; a changed URL never changes reset semantics.
    update(form)
  }
  function labels(form: HTMLFormElement) {
    const ordered = Array.from(form.querySelectorAll<HTMLElement>('label[data-instatic-label-target="auto"], input:not([type="hidden"]):not([data-instatic-honeypot]), textarea, select'))
    let counter = 0
    for (const [index, label] of ordered.entries()) {
      if (label.tagName !== 'LABEL') continue
      const control = ordered.slice(index + 1).find((element) => element.tagName !== 'LABEL')
      if (!control) continue
      if (!control.id) control.id = `instatic-form-${data(form, 'form-id')}-${++counter}`
      label.setAttribute('for', control.id)
    }
  }
  async function readJson(response: Response) {
    const text = await response.text()
    if (text.length > 65536) throw new Error('Native form response is too large')
    const parsed: unknown = JSON.parse(text)
    if (!checkJsonResponse(parsed)) throw new Error('Invalid native form response')
    return parsed
  }
  async function cmsPost(path: string, payload: Record<string, unknown>) {
    const response = await browser.fetch(path, {
      method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(payload),
      signal: browser.AbortSignal.timeout(20000),
    })
    const body = await readJson(response)
    if (!response.ok) {
      if (checkValidationResponse(body)) throw new SubmissionError('invalid', body.errors)
      throw new SubmissionError('error')
    }
    return body
  }
  function challenge(form: HTMLFormElement): Promise<FormChallengeResponse> {
    const current = attached.get(form)
    if (!current) return Promise.reject(new Error('Native form is not attached'))
    if (current.challenge && Date.now() < Date.parse(current.challenge.expiresAt) - 10000) {
      const result = current.challenge
      current.challenge = undefined
      return Promise.resolve(result)
    }
    if (current.challengeRequest) return current.challengeRequest
    const formId = data(form, 'form-id'), pageId = data(form, 'page-id'), pageToken = data(form, 'page-token')
    if (!formId || !pageId || !pageToken) return Promise.reject(new Error('Missing published form link'))
    const request = cmsPost('/_instatic/form/challenge', { formId, pageId, pageToken }).then((body) => {
      if (!checkChallenge(body) || !Number.isFinite(Date.parse(body.expiresAt))) throw new Error('Invalid form challenge')
      return body
    }).finally(() => { current.challengeRequest = undefined })
    current.challengeRequest = request
    return request
  }
  function prefetch(form: HTMLFormElement) {
    const current = attached.get(form)
    if (!current || current.transport.mode !== 'cms' || current.challenge || current.challengeRequest) return
    void challenge(form).then((result) => { current.challenge = result }, () => { state(form, 'unavailable') })
  }
  function provider(): Promise<TurnstileApi> {
    if ('turnstile' in browser && checkTurnstileApi(browser.turnstile)) return Promise.resolve(browser.turnstile)
    if (providerRequest) return providerRequest
    const script = document.createElement('script')
    providerRequest = new Promise<TurnstileApi>((resolve, reject) => {
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      const timer = browser.setTimeout(() => reject(new Error('Turnstile load timed out')), 20000)
      script.addEventListener('load', () => {
        browser.clearTimeout(timer)
        if ('turnstile' in browser && checkTurnstileApi(browser.turnstile)) resolve(browser.turnstile)
        else reject(new Error('Invalid Turnstile API'))
      }, { once: true })
      script.addEventListener('error', () => { browser.clearTimeout(timer); reject(new Error('Turnstile could not load')) }, { once: true })
      document.head.append(script)
    }).catch((error: unknown) => {
      providerRequest = undefined
      script.remove()
      throw error
    })
    return providerRequest
  }
  function widgets(form: HTMLFormElement): Promise<void> {
    const current = attached.get(form)
    if (!current) return Promise.reject(new Error('Native form is not attached'))
    if (current.widgetRequest) return current.widgetRequest
    const elements = form.querySelectorAll<HTMLElement>('[data-instatic-turnstile]')
    if (!elements.length) return Promise.resolve()
    const request = (async () => {
      const api = await provider()
      for (const element of elements) {
        if (current.widgets.has(element)) continue
        const config = { siteKey: data(element, 'site-key'), action: data(element, 'captcha-action'), language: data(element, 'captcha-language'), theme: data(element, 'captcha-theme'), responseFieldName: data(element, 'captcha-field') }
        if (!checkTurnstileConfiguration(config) || !config.siteKey.trim()) throw new Error('Invalid Turnstile configuration')
        const theme = config.theme === 'auto' ? effectiveTheme() : config.theme
        const id = api.render(element, {
          sitekey: config.siteKey, action: config.action, language: config.language, theme,
          size: 'flexible', 'response-field': true, 'response-field-name': config.responseFieldName,
          callback: () => { if (!current.busy && data(form, 'form-state') === 'captcha') state(form, 'idle') },
          'expired-callback': () => { state(form, 'captcha'); api.reset(id) },
          'error-callback': () => { state(form, 'captcha') },
          'timeout-callback': () => { state(form, 'captcha') },
        })
        current.widgets.set(element, id)
        widgetThemes.set(element, theme)
      }
    })().finally(() => { current.widgetRequest = undefined })
    current.widgetRequest = request
    return request
  }
  function effectiveTheme() {
    return browser.getComputedStyle(document.documentElement).colorScheme === 'dark' ? 'dark' : 'light'
  }
  async function refreshWidgetThemes(form: HTMLFormElement) {
    const current = attached.get(form)
    if (!current || current.busy || ![...current.widgets.keys()].some(element => data(element, 'captcha-theme') === 'auto')) return
    if (current.widgetRequest) await current.widgetRequest
    const api = await provider(), theme = effectiveTheme()
    for (const [element, id] of current.widgets) if (data(element, 'captcha-theme') === 'auto' && widgetThemes.get(element) !== theme) {
      api.remove(id)
      current.widgets.delete(element)
      widgetThemes.delete(element)
    }
    await widgets(form)
  }
  function attach(form: HTMLFormElement) {
    if (attached.has(form)) return
    const transport = { mode: data(form, 'form-mode'), action: form.getAttribute('action') ?? '', encoding: data(form, 'encoding'), responseSuccessField: data(form, 'response-success-field'), responseMessageField: data(form, 'response-message-field'), resetOnSuccess: data(form, 'reset-on-success') === 'true' }
    if (!checkTransport(transport)) { state(form, 'unavailable'); return }
    try {
      for (const control of controls(form)) {
        const configuration = { required: data(control, 'required') === 'true', disabled: data(control, 'disabled') === 'true', requiredWhen: condition(control, 'required-when'), disabledWhen: condition(control, 'disabled-when'), minValueField: data(control, 'min-value-field'), maxValueField: data(control, 'max-value-field'), clearFieldsOnChange: data(control, 'clear-fields-on-change'), queryParameter: data(control, 'query-parameter'), queryOverflow: data(control, 'query-overflow') || 'reject', trimOnSubmit: data(control, 'trim-on-submit') === 'true', submitOnChange: data(control, 'submit-on-change') === 'true', lockQueryValue: data(control, 'query-lock') === 'true', resetBehavior: data(control, 'reset-behavior'), valueSourceField: data(control, 'value-source'), valueTargetField: data(control, 'value-target'), syncGroup: data(control, 'sync-group'), requiredMessage: data(control, 'required-message'), invalidMessage: data(control, 'invalid-message') }
        if (!checkControl(configuration)) throw new Error('Invalid native control configuration')
        if (control instanceof browser.HTMLInputElement && control.type === 'checkbox' && !checkCheckboxGroup({ minSelected: Number(data(control, 'choice-min-selected') || 0), maxSelected: Number(data(control, 'choice-max-selected') || 0), selectionOverflow: data(control, 'choice-overflow') || 'reject' })) throw new Error('Invalid checkbox group configuration')
      }
      const calculations: unknown = JSON.parse(data(form, 'form-calculations') || '{}')
      if (!checkCalculations(calculations)) throw new Error('Invalid form calculations')
      attached.set(form, { transport, calculations, values: {}, choiceOrder: new Map(), busy: false, buttons: new Map(), widgets: new Map(), queryErrors: new Set(), initialValues: new Map() })
      // Delegated submission owns validation so state copy is shown even when
      // native requestSubmit would otherwise stop before the submit event.
      form.noValidate = true
      labels(form)
      const valid = initialize(form), stateParameter = data(form, 'state-query-parameter')
      const queryState = stateParameter ? new URL(browser.location.href).searchParams.get(stateParameter) : null
      const initialState = valid ? queryState === 'success' || queryState === 'error' ? queryState : 'idle' : 'invalid'
      const initialMessage = stateParameter && ['success', 'error'].includes(initialState)
        ? messages(form).find(message => data(message, 'form-message') === initialState && data(message, 'message-source') === 'responseOrState')?.textContent ?? '' : ''
      state(form, initialState, initialMessage)
      prefetch(form)
      const current = attached.get(form)!
      captureChoiceOrder(form, current)
      for (const control of controls(form)) current.initialValues.set(control, captureValue(control, current))
      void widgets(form).catch(() => { state(form, 'captcha') })
    } catch {
      attached.delete(form)
      state(form, 'unavailable')
    }
  }
  function collectValues(formData: FormData) {
    const result: Record<string, unknown> = Object.create(null)
    for (const [name, value] of formData) {
      const normalized = typeof value === 'string' ? value : value.name
      const previous = result[name]
      result[name] = previous === undefined ? normalized : Array.isArray(previous) ? [...previous, normalized] : [previous, normalized]
    }
    return result
  }
  async function submit(form: HTMLFormElement, submitter: HTMLButtonElement | HTMLInputElement | undefined) {
    const current = attached.get(form)
    if (!current || current.busy) return
    for (const control of controls(form)) if (data(control, 'trim-on-submit') === 'true' && !(control instanceof browser.HTMLSelectElement) && !(control instanceof browser.HTMLInputElement && ['file','radio','checkbox'].includes(control.type))) control.value = control.value.trim()
    if (!refresh(form)) return
    if (!form.checkValidity()) { state(form, 'invalid'); form.reportValidity(); return }
    if (current.transport.mode === 'local') {
      const targetId = data(form, 'submit-target-id')
      if (targetId) {
        const target = document.getElementById(targetId)
        if (!target) { state(form, 'unavailable'); return }
        scrollTarget(target)
        const tabindex = target.getAttribute('tabindex')
        if (tabindex === null) { target.setAttribute('tabindex', '-1'); target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true }) }
        target.focus({ preventScroll: true })
      }
      state(form, 'idle'); return
    }
    // Lock the entire asynchronous preparation, including provider loading.
    current.busy = true
    let sent = false
    try {
      if (form.querySelector('[data-instatic-turnstile]')) {
        try {
          await widgets(form)
          const api = await provider()
          if (!current.widgets.size || [...current.widgets.values()].some((id) => !api.getResponse(id))) { state(form, 'captcha'); return }
        } catch { state(form, 'captcha'); return }
      }
      if (current.transport.mode === 'custom') { htmlSubmitReady.add(form); form.requestSubmit(submitter); return }
      const formData = new browser.FormData(form, submitter)
      busy(form, true); state(form, 'pending')
      sent = true
      let responseMessage = ''
      if (current.transport.mode === 'cms') {
        const link = await challenge(form)
        current.challenge = undefined
        const result = await cmsPost('/_instatic/form/submit', { formId: data(form, 'form-id'), pageId: data(form, 'page-id'), token: link.token, challenge: link.challenge, values: collectValues(formData) })
        if (!checkSuccessResponse(result)) throw new SubmissionError('error')
      } else {
        const isJson = current.transport.encoding === 'json'
        const response = await browser.fetch(current.transport.action, {
          method: 'POST', credentials: 'omit', headers: isJson ? { accept: 'application/json', 'content-type': 'application/json' } : { accept: 'application/json' },
          body: isJson ? JSON.stringify(collectValues(formData)) : formData,
          signal: browser.AbortSignal.timeout(20000),
        })
        const body = await readJson(response)
        if (!checkResponseContract({ success: body[current.transport.responseSuccessField], message: body[current.transport.responseMessageField] })) throw new Error('Invalid declared form response')
        const message = body[current.transport.responseMessageField]
        if (typeof message === 'string') responseMessage = message
        if (!response.ok || body[current.transport.responseSuccessField] !== true) { state(form, 'error', responseMessage); return }
      }
      const redirect = data(form, 'success-redirect')
      if (redirect) { browser.location.assign(redirect); return }
      if (current.transport.resetOnSuccess) {
        const preserved = new Map(controls(form).map((control) => [control, captureValue(control, current)]))
        let resetEvent: Event | undefined
        const capture = (event: Event) => { resetEvent = event }
        form.addEventListener('reset', capture, { once: true })
        managedResets.add(form)
        try { form.reset() } finally { managedResets.delete(form); form.removeEventListener('reset', capture) }
        if (!resetEvent?.defaultPrevented) resetValues(form, current, preserved)
      }
      state(form, 'success', responseMessage)
    } catch (error) {
      if (error instanceof SubmissionError && error.errors) {
        for (const entry of error.errors) {
          const control = controls(form).find((element) => data(element, 'field-id') === entry.fieldId)
          if (control) control.setCustomValidity(data(control, entry.code === 'required' ? 'required-message' : 'invalid-message'))
        }
        form.reportValidity()
      }
      state(form, error instanceof SubmissionError ? error.state : 'error')
    }
    finally {
      busy(form, false)
      if (sent && form.isConnected) {
        prefetch(form)
        if ('turnstile' in browser && checkTurnstileApi(browser.turnstile)) for (const id of current.widgets.values()) browser.turnstile.reset(id)
        void refreshWidgetThemes(form).catch(() => { state(form, 'captcha') })
      }
    }
  }
  for (const form of document.querySelectorAll<HTMLFormElement>(FORM_SELECTOR)) attach(form)
  browser.addEventListener('hashchange', () => {
    for (const form of document.querySelectorAll<HTMLFormElement>(FORM_SELECTOR)) {
      const value = initializeFragment(form)
      if (value !== null && refresh(form)) { state(form, 'idle'); scrollFragment(value) }
    }
  })
  document.addEventListener('instatic:visitor-preferences-change', () => {
    for (const form of document.querySelectorAll<HTMLFormElement>(FORM_SELECTOR)) void refreshWidgetThemes(form).catch(() => { state(form, 'captcha') })
  })
  document.addEventListener('instatic:form-values-request', (event) => {
    if (!(event instanceof browser.CustomEvent)) return
    const detail: unknown = event.detail
    if (!checkValuesRequest(detail)) return
    for (const form of document.querySelectorAll<HTMLFormElement>(FORM_SELECTOR)) if (data(form, 'form-id') === detail.formId) {
      const current = attached.get(form)
      if (current) emitValues(form, current.values)
      else attach(form)
    }
  })
  document.addEventListener('instatic:content', () => {
    for (const form of document.querySelectorAll<HTMLFormElement>(FORM_SELECTOR)) {
      const current = attached.get(form)
      if (!current) attach(form)
      else try { applyValueBindings(form, current.values) } catch { state(form, 'unavailable') }
    }
  })
  document.addEventListener('focusin', (event) => {
    const form = event.target instanceof browser.Element ? event.target.closest(FORM_SELECTOR) : null
    if (isForm(form)) attach(form)
  })
  function controlChanged(event: Event) {
    const form = event.target instanceof browser.Element ? event.target.closest(FORM_SELECTOR) : null
    if (isForm(form)) { attach(form); try { if (event.target instanceof browser.HTMLInputElement || event.target instanceof browser.HTMLSelectElement || event.target instanceof browser.HTMLTextAreaElement) { writeTarget(form, event.target); clearDependentFields(form, event.target); synchronizeChoices(form, event.target); synchronize(form, event.target, true); clearQueryError(form, event.target) } if (attached.has(form) && refresh(form)) {
        state(form, 'idle')
        const control = event.target
        if (event.type === 'change' && control instanceof browser.HTMLElement && data(control, 'submit-on-change') === 'true' && attached.get(form)?.transport.mode === 'local'
          && (!(control instanceof browser.HTMLInputElement) || control.type !== 'radio' || control.checked)) form.requestSubmit()
      } } catch { state(form, 'unavailable') } }
  }
  document.addEventListener('input', controlChanged)
  document.addEventListener('change', controlChanged)
  document.addEventListener('click', (event) => {
    const button = event.target instanceof browser.Element ? event.target.closest<HTMLButtonElement>('button[data-instatic-form-step]') : null
    const form = button?.closest(FORM_SELECTOR)
    if (!button || button.disabled || !form || !isForm(form)) return
    const target = controls(form).find((control) => control.name === data(button, 'form-step'))
    if (!(target instanceof browser.HTMLInputElement)) return
    const next = Number(target.value) + Number(data(button, 'step-amount'))
    target.value = String(Math.min(target.max !== '' ? Number(target.max) : Infinity, Math.max(target.min !== '' ? Number(target.min) : -Infinity, next)))
    target.dispatchEvent(new browser.Event('input', { bubbles: true }))
  })
  document.addEventListener('reset', (event) => {
    if (!isForm(event.target) || managedResets.has(event.target)) return
    const form = event.target, current = attached.get(form)
    if (!current) return
    const preserved = new Map(controls(form).map((control) => [control, captureValue(control, current)]))
    queueMicrotask(() => {
      if (event.defaultPrevented) return
      try { resetValues(form, current, preserved); state(form, current.queryErrors.size ? 'invalid' : 'idle') }
      catch { state(form, 'unavailable') }
    })
  })
  document.addEventListener('submit', (event) => {
    if (!isForm(event.target)) return
    if (htmlSubmitReady.delete(event.target)) return
    const submitter = 'submitter' in event && (event.submitter instanceof browser.HTMLButtonElement || event.submitter instanceof browser.HTMLInputElement) ? event.submitter : undefined
    event.preventDefault(); attach(event.target); void submit(event.target, submitter)
  })
}
