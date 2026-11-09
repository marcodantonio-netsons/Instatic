import { Value } from '@sinclair/typebox/value'
import { FormCalculationsSchema, FormValueExpressionSchema, PropertyConditionSchema, evaluateCondition, evaluateFormValues, evaluateFormExpression, formValueUrl } from '../shared/forms'
import type { FormValueConstraint, PropertyCondition } from '../shared/forms'
import type { FormProps } from './primitiveSchemas'
import { escapeHtml, isSafeUrl } from '../shared/htmlSafety'

type Attribute = { readonly name: string; value: string | null }
type Element = {
  readonly name: string
  readonly start: number
  readonly openEnd: number
  endStart: number
  end: number
  contentStart: number
  contentEnd: number
  readonly attributes: Map<string, Attribute>
  readonly children: Element[]
  readonly parent: Element | null
  changed: boolean
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const TAGS = /<!--[\s\S]*?-->|<![^>]*>|<\/?([A-Za-z][A-Za-z0-9:-]*)([^<>]*?)>/g

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function parseAttributes(source: string): Map<string, Attribute> {
  const attributes = new Map<string, Attribute>()
  let index = 0
  while (index < source.length) {
    while (/\s|\//.test(source[index] ?? '') && index < source.length) index += 1
    if (index >= source.length) break
    const start = index
    while (index < source.length && !/[\s=/>]/.test(source[index])) index += 1
    if (start === index) { index += 1; continue }
    const name = source.slice(start, index).toLowerCase()
    while (/\s/.test(source[index] ?? '') && index < source.length) index += 1
    let value: string | null = null
    if (source[index] === '=') {
      index += 1
      while (/\s/.test(source[index] ?? '') && index < source.length) index += 1
      const quote = source[index] === '"' || source[index] === "'" ? source[index++] : ''
      const valueStart = index
      if (quote) {
        while (index < source.length && source[index] !== quote) index += 1
        value = decodeHtml(source.slice(valueStart, index))
        if (source[index] === quote) index += 1
      } else {
        while (index < source.length && !/[\s>]/.test(source[index])) index += 1
        value = decodeHtml(source.slice(valueStart, index))
      }
    }
    attributes.set(name, { name, value })
  }
  return attributes
}

function parseFragment(html: string): Element {
  const root: Element = {
    name: '#root', start: 0, openEnd: 0, endStart: html.length, end: html.length,
    contentStart: 0, contentEnd: html.length, attributes: new Map(), children: [], parent: null, changed: false,
  }
  const stack = [root]
  for (const match of html.matchAll(TAGS)) {
    const token = match[0]
    if (token.startsWith('<!--') || token.startsWith('<!')) continue
    const tag = match[1]?.toLowerCase()
    if (!tag) continue
    const isClosing = token.startsWith('</')
    if (isClosing) {
      const found = stack.findLastIndex((element) => element.name === tag)
      if (found <= 0) continue
      for (const element of stack.slice(found)) {
        element.endStart = match.index ?? html.length
        element.end = element.endStart + token.length
        element.contentEnd = element.endStart
      }
      stack.length = found
      continue
    }

    const start = match.index ?? 0
    const openEnd = start + token.length
    const rawAttrs = token.slice(1 + tag.length, token.length - 1).replace(/\/\s*$/, '')
    const parent = stack.at(-1) ?? root
    const element: Element = {
      name: tag,
      start,
      openEnd,
      endStart: openEnd,
      end: openEnd,
      contentStart: openEnd,
      contentEnd: openEnd,
      attributes: parseAttributes(rawAttrs),
      children: [],
      parent,
      changed: false,
    }
    parent.children.push(element)
    if (VOID_TAGS.has(tag) || /\/\s*>$/.test(token)) continue
    stack.push(element)
  }
  for (const element of stack.slice(1)) {
    element.endStart = html.length
    element.end = html.length
    element.contentEnd = html.length
  }
  return root
}

function visit(element: Element, callback: (element: Element) => void): void {
  for (const child of element.children) {
    callback(child)
    visit(child, callback)
  }
}

function attr(element: Element, name: string): string | null {
  return element.attributes.get(name)?.value ?? null
}

function hasAttr(element: Element, name: string): boolean {
  return element.attributes.has(name)
}

function booleanAttr(element: Element, name: string): boolean {
  return hasAttr(element, name) && attr(element, name) !== 'false'
}

function setAttr(element: Element, name: string, value: string | boolean | null): void {
  const normalized = name.toLowerCase()
  if (value === null || value === false) element.attributes.delete(normalized)
  else element.attributes.set(normalized, { name: normalized, value: value === true ? null : String(value) })
  element.changed = true
}

function serializedStartTag(element: Element): string {
  const attrs = Array.from(element.attributes.values(), ({ name, value }) => value === null ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`).join('')
  return `<${element.name}${attrs}>`
}

function decodeText(html: string): string {
  return decodeHtml(html.replace(/<[^>]*>/g, ''))
}

function parseCondition(element: Element, name: string): PropertyCondition | null {
  const raw = attr(element, name)
  if (!raw || raw === 'null') return null
  try {
    const value: unknown = JSON.parse(raw)
    return Value.Check(PropertyConditionSchema, value) ? value : null
  } catch {
    return null
  }
}

function controlName(element: Element): string {
  return attr(element, 'name') || attr(element, 'data-instatic-field-id') || ''
}

function controlValue(element: Element, html: string): string {
  if (element.name === 'textarea') return decodeText(html.slice(element.contentStart, element.contentEnd))
  return attr(element, 'value') ?? ''
}

function optionsFor(select: Element, html: string): Array<{ value: string; selected: boolean; disabled: boolean }> {
  const options: Array<{ value: string; selected: boolean; disabled: boolean }> = []
  function visitOptions(element: Element, disabled: boolean): void {
    for (const child of element.children) {
      const isDisabled = disabled || booleanAttr(child, 'disabled')
      if (child.name === 'option') options.push({ value: attr(child, 'value') ?? decodeText(html.slice(child.contentStart, child.contentEnd)), selected: booleanAttr(child, 'selected'), disabled: isDisabled })
      else visitOptions(child, isDisabled)
    }
  }
  visitOptions(select, false)
  return options
}

function initialSelectValue(select: Element, html: string): string | string[] {
  const options = optionsFor(select, html)
  if (booleanAttr(select, 'multiple')) return options.filter((option) => option.selected && !option.disabled).map((option) => option.value)
  return options.findLast((option) => option.selected)?.value ?? options.find((option) => !option.disabled)?.value ?? ''
}

function setElementText(element: Element, value: unknown): Array<{ start: number; end: number; replacement: string }> {
  if (element.children.length) return []
  return [{ start: element.contentStart, end: element.contentEnd, replacement: escapeHtml(String(value ?? '')) }]
}

function renderChanged(html: string, root: Element, edits: Array<{ start: number; end: number; replacement: string }>): string {
  visit(root, (element) => {
    if (element.changed) edits.push({ start: element.start, end: element.openEnd, replacement: serializedStartTag(element) })
  })
  edits.sort((a, b) => b.start - a.start)
  let result = html
  for (const edit of edits) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  return result
}

function activeStateForGroups(root: Element, values: Record<string, unknown>, hidden: Map<Element, boolean>): void {
  function descend(parent: Element, parentActive: boolean): void {
    for (const child of parent.children) {
      if (hasAttr(child, 'data-instatic-form-condition')) {
        const condition = parseCondition(child, 'data-instatic-form-condition')
        const visible = parentActive && (!condition || evaluateCondition(condition, values))
        hidden.set(child, !visible)
        setAttr(child, 'hidden', !visible)
        const childActive = attr(child, 'data-instatic-disable-when-hidden') === 'false' ? parentActive : visible
        descend(child, childActive)
      } else descend(child, parentActive)
    }
  }
  descend(root, true)
}

function isDisabledByGroup(element: Element, hidden: Map<Element, boolean>): boolean {
  let parent = element.parent
  while (parent) {
    if (hidden.get(parent) === true && attr(parent, 'data-instatic-disable-when-hidden') !== 'false') return true
    parent = parent.parent
  }
  return false
}

function descendants(root: Element, predicate: (element: Element) => boolean): Element[] {
  const matches: Element[] = []
  visit(root, (element) => { if (predicate(element)) matches.push(element) })
  return matches
}

function initialValues(root: Element, html: string, calculations: FormProps['calculations']): { computed: Record<string, unknown>; successful: Record<string, unknown>; sources: Map<string, Element> } {
  const controls = descendants(root, (element) => hasAttr(element, 'data-instatic-form-control'))
  const checkboxCounts = new Map<string, number>()
  for (const control of controls) if (attr(control, 'data-instatic-form-control') === 'checkbox') {
    const name = controlName(control)
    checkboxCounts.set(name, (checkboxCounts.get(name) ?? 0) + 1)
  }

  const values: Record<string, unknown> = Object.create(null)
  const sources = new Map<string, Element>()
  const constraints: FormValueConstraint[] = []
  for (const control of controls) {
    const name = controlName(control)
    const kind = attr(control, 'data-instatic-form-control')
    if (!name || attr(control, 'data-instatic-disabled') === 'true') continue
    if (kind === 'checkbox' && (checkboxCounts.get(name) ?? 0) > 1) {
      const selected = Array.isArray(values[name]) ? values[name] as unknown[] : []
      if (booleanAttr(control, 'checked')) selected.push(attr(control, 'value') ?? 'on')
      values[name] = selected
      sources.set(name, control)
    } else if (kind === 'checkbox' && !booleanAttr(control, 'checked')) {
      values[name] = ''
      sources.set(name, control)
    } else if (kind === 'radio' && !booleanAttr(control, 'checked')) {
      continue
    } else if (kind === 'select') {
      values[name] = initialSelectValue(control, html)
      sources.set(name, control)
    } else if (kind === 'input' || kind === 'textarea' || kind === 'radio' || kind === 'checkbox') {
      values[name] = kind === 'radio' || kind === 'checkbox' ? (attr(control, 'value') ?? 'on') : controlValue(control, html)
      sources.set(name, control)
    } else continue

    const minValueField = attr(control, 'data-instatic-min-value-field') ?? ''
    const maxValueField = attr(control, 'data-instatic-max-value-field') ?? ''
    if (minValueField || maxValueField) {
      const rawMin = attr(control, 'min'), rawMax = attr(control, 'max')
      constraints.push({ fieldName: name, minValueField, maxValueField, ...(rawMin && Number.isFinite(Number(rawMin)) ? { min: Number(rawMin) } : {}), ...(rawMax && Number.isFinite(Number(rawMax)) ? { max: Number(rawMax) } : {}) })
    }
  }

  if (!Value.Check(FormCalculationsSchema, calculations)) throw new Error('Invalid form calculations')
  const computed = evaluateFormValues(calculations, values, constraints)
  const successful = { ...computed }
  return { computed, successful, sources }
}

/**
 * Reproduce the native renderer's initial form context inside the form
 * component. The plugin API gives a renderer its child HTML, so the form
 * reads the data attributes emitted by its own form primitives and applies
 * initial conditions, calculations, bounds, output text, and links locally.
 */
export function renderInitialFormHtml(props: FormProps, innerHtml: string): string {
  const root = parseFragment(innerHtml)
  const context = initialValues(root, innerHtml, props.calculations)
  const hidden = new Map<Element, boolean>()
  activeStateForGroups(root, context.successful, hidden)

  for (const [name, source] of context.sources) {
    if (isDisabledByGroup(source, hidden)) delete context.successful[name]
  }

  const edits: Array<{ start: number; end: number; replacement: string }> = []
  const controls = descendants(root, (element) => hasAttr(element, 'data-instatic-form-control'))
  for (const control of controls) {
    const name = controlName(control)
    const activeControl = !isDisabledByGroup(control, hidden)
    const requiredWhen = parseCondition(control, 'data-instatic-required-when')
    const disabledWhen = parseCondition(control, 'data-instatic-disabled-when')
    const disabled = attr(control, 'data-instatic-disabled') === 'true'
      || !activeControl
      || Boolean(disabledWhen && evaluateCondition(disabledWhen, context.successful))
    const required = activeControl && !disabled && (requiredWhen ? evaluateCondition(requiredWhen, context.successful) : attr(control, 'data-instatic-required') === 'true')
    setAttr(control, 'disabled', disabled)
    setAttr(control, 'required', required)

    const minValueField = attr(control, 'data-instatic-min-value-field')
    const maxValueField = attr(control, 'data-instatic-max-value-field')
    if (minValueField) setAttr(control, 'min', String(context.successful[minValueField]))
    if (maxValueField) setAttr(control, 'max', String(context.successful[maxValueField]))
    if ((minValueField || maxValueField) && Object.hasOwn(context.successful, name)) setAttr(control, 'value', String(context.successful[name]))
    const valueSource = attr(control, 'data-instatic-value-source')
    if (valueSource) setControlValue(control, context.successful[valueSource] ?? '', edits)
  }

  for (const output of descendants(root, (element) => hasAttr(element, 'data-instatic-form-output'))) {
    const name = attr(output, 'data-instatic-form-output') ?? ''
    const value = context.successful[name] ?? ''
    const variable = attr(output, 'data-instatic-form-css-variable')
    if (variable) setAttr(output, 'style', `${variable}:${Number(value)}`)
    else edits.push(...setElementText(output, value))
  }

  for (const link of descendants(root, (element) => hasAttr(element, 'data-instatic-form-link'))) {
    if (attr(link, 'data-instatic-form-id')) continue
    const rawExpression = attr(link, 'data-instatic-form-expression')
    let value: unknown
    if (rawExpression) {
      const expression: unknown = JSON.parse(rawExpression)
      if (!Value.Check(FormValueExpressionSchema, expression)) throw new Error('Invalid form link expression')
      value = evaluateFormExpression(expression, context.successful)
    } else value = context.successful[attr(link, 'data-instatic-form-link') ?? ''] ?? ''
    if (typeof value === 'string') {
      formValueUrl(value)
      setAttr(link, 'href', isSafeUrl(value) ? value : '#')
    }
  }

  for (const button of descendants(root, (element) => hasAttr(element, 'data-instatic-form-step'))) {
    const condition = parseCondition(button, 'data-instatic-step-disabled-when')
    setAttr(button, 'disabled', Boolean(condition && evaluateCondition(condition, context.successful)))
  }

  return renderChanged(innerHtml, root, edits)
}

function setControlValue(control: Element, value: unknown, edits: Array<{ start: number; end: number; replacement: string }>): void {
  if (control.name === 'textarea') {
    edits.push(...setElementText(control, value))
  } else if (control.name === 'select') {
    const valueSet = new Set(Array.isArray(value) ? value.map(String) : [String(value ?? '')])
    for (const option of descendants(control, (element) => element.name === 'option')) setAttr(option, 'selected', valueSet.has(attr(option, 'value') ?? '') && !booleanAttr(option, 'disabled'))
  } else setAttr(control, 'value', String(value ?? ''))
}
