import type { FormCalculations, FormValueConstraint, FormValueExpression, FormValue } from '@core/forms-schema'

export class FormValueError extends Error {
  readonly path: string
  constructor(message: string, path: string) { super(message); this.name = 'FormValueError'; this.path = path }
}
const RESERVED = new Set(['__proto__', 'prototype', 'constructor'])
function fail(message: string, path: string): never { throw new FormValueError(message, path) }
/** Computed navigation has one URL authority in SSR, preflight and browser. */
export function formValueUrl(value: string, base = 'https://instatic.invalid'): URL {
  let url: URL
  try { url = new URL(value, base) } catch { fail('Invalid computed URL', 'url') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || value.startsWith('//') || Array.from(value).some((character) => character.charCodeAt(0) < 32 || character === '\\')) fail('Computed URLs require a relative or HTTP(S) base without credentials', 'url')
  return url
}
function numeric(value: unknown, path: string): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) fail('A calculation requires a finite number', path)
  const number = Number(value)
  if (!Number.isFinite(number)) fail('A calculation requires a finite number', path)
  return number
}
function scalar(value: unknown, path: string): string {
  if (value === null) return ''
  if (!['string','number','boolean'].includes(typeof value)) fail('A calculation requires a scalar value', path)
  return String(value)
}
export function formExpressionFields(expression: FormValueExpression, depth = 0): string[] {
  if (depth > 64) fail('Expression nesting exceeds 64 levels', 'calculations')
  if ('literal' in expression) return []
  if ('field' in expression) return [expression.field]
  if ('args' in expression) return expression.args.flatMap((child) => formExpressionFields(child, depth + 1))
  if (expression.op === 'concat') return expression.values.flatMap((child) => formExpressionFields(child, depth + 1))
  if (expression.op === 'lookup') return [expression.value, ...Object.values(expression.cases), expression.otherwise].flatMap((child) => formExpressionFields(child, depth + 1))
  if (expression.op === 'url') return [expression.base, ...Object.values(expression.query)].flatMap((child) => formExpressionFields(child, depth + 1))
  if (expression.op === 'contains') return [expression.value, expression.item].flatMap((child) => formExpressionFields(child, depth + 1))
  if (expression.op === 'replace') return [expression.value, expression.search, expression.replacement].flatMap((child) => formExpressionFields(child, depth + 1))
  return formExpressionFields(expression.value, depth + 1)
}
function evaluate(expression: FormValueExpression, values: Record<string, unknown>, path: string): FormValue {
  if ('literal' in expression) return expression.literal
  if ('field' in expression) {
    if (!Object.hasOwn(values, expression.field)) fail(`Unknown calculation value: ${expression.field}`, path)
    const value = values[expression.field]
    if (Array.isArray(value)) {
      if (value.some((entry) => entry !== null && !['string','number','boolean'].includes(typeof entry))) fail('Calculation collections require scalar items', path)
      return value as FormValue
    }
    if (value !== null && !['string','number','boolean'].includes(typeof value)) fail('Calculation fields must be scalar or scalar collections', path)
    return value as FormValue
  }
  if ('args' in expression) {
    const args = expression.args.map((child, index) => numeric(evaluate(child, values, `${path}.args.${index}`), path))
    let value: number
    switch (expression.op) {
      case 'add': value = args.reduce((sum, argument) => sum + argument, 0); break
      case 'multiply': value = args.reduce((product, argument) => product * argument, 1); break
      case 'subtract': value = args.slice(1).reduce((difference, argument) => difference - argument, args[0]); break
      case 'divide': value = args.slice(1).reduce((quotient, argument) => quotient / argument, args[0]); break
      case 'min': value = Math.min(...args); break
      case 'max': value = Math.max(...args); break
      case 'round': value = Math.round(args[0]); break
      case 'floor': value = Math.floor(args[0]); break
      case 'trunc': value = Math.trunc(args[0]); break
    }
    if (['round','floor','trunc'].includes(expression.op) && args.length !== 1) fail('Rounding operations require one operand', path)
    if (['subtract','divide'].includes(expression.op) && args.length < 2) fail('This operation requires at least two operands', path)
    if (!Number.isFinite(value)) fail('Calculation produced a non-finite number', path)
    return value
  }
  if (expression.op === 'concat') return expression.values.map((child, index) => scalar(evaluate(child, values, `${path}.values.${index}`), path)).join('')
  if (expression.op === 'trim') {
    const value = evaluate(expression.value, values, `${path}.value`)
    if (typeof value !== 'string') fail('Trim requires text', path)
    return value.trim()
  }
  if (expression.op === 'replace') {
    const value = scalar(evaluate(expression.value, values, `${path}.value`), path)
    const search = scalar(evaluate(expression.search, values, `${path}.search`), path)
    const replacement = scalar(evaluate(expression.replacement, values, `${path}.replacement`), path)
    return value.replace(search, () => replacement)
  }
  if (expression.op === 'length') {
    const value = evaluate(expression.value, values, `${path}.value`)
    if (!Array.isArray(value) && typeof value !== 'string') fail('Length requires text or a collection', path)
    return value.length
  }
  if (expression.op === 'contains') {
    const value = evaluate(expression.value, values, `${path}.value`), item = evaluate(expression.item, values, `${path}.item`)
    if (!Array.isArray(value) || Array.isArray(item)) fail('Contains requires a collection and a scalar item', path)
    return value.includes(item)
  }
  if (expression.op === 'lookup') {
    const key = scalar(evaluate(expression.value, values, `${path}.value`), path)
    return evaluate(Object.hasOwn(expression.cases, key) ? expression.cases[key] : expression.otherwise, values, `${path}.cases.${key}`)
  }
  if (expression.op === 'number-format') {
    if (expression.minimumFractionDigits > expression.maximumFractionDigits) fail('Minimum fraction digits exceed the maximum', path)
    try { return new Intl.NumberFormat(expression.locale, { minimumFractionDigits: expression.minimumFractionDigits, maximumFractionDigits: expression.maximumFractionDigits, style: expression.style, currency: expression.currency }).format(numeric(evaluate(expression.value, values, `${path}.value`), path)) }
    catch (error) { if (error instanceof FormValueError) throw error; throw new FormValueError('Invalid number format configuration', path) }
  }
  const base = scalar(evaluate(expression.base, values, `${path}.base`), path)
  const url = formValueUrl(base)
  for (const [name, value] of Object.entries(expression.query)) url.searchParams.set(name, scalar(evaluate(value, values, `${path}.query.${name}`), path))
  return /^https?:/i.test(base) ? url.href : url.pathname + url.search + url.hash
}

/** Evaluate a node-local expression against an already normalized form snapshot. */
export function evaluateFormExpression(expression: FormValueExpression, values: Record<string, unknown>): FormValue {
  formExpressionFields(expression)
  return evaluate(expression, values, 'expression')
}

/** One dependency graph includes derived values and resource bounds, so a
 * resource is clamped before calculations which consume that resource run. */
export function evaluateFormValues(calculations: FormCalculations, input: Record<string, unknown>, constraints: readonly FormValueConstraint[] = []): Record<string, unknown> {
  const values: Record<string, unknown> = Object.assign(Object.create(null), input)
  const rules = new Map(constraints.map((constraint) => [constraint.fieldName, constraint]))
  const active = new Set<string>(), complete = new Set<string>()
  function visit(name: string) {
    if (RESERVED.has(name)) fail('Reserved calculation value name', name)
    if (complete.has(name)) return
    if (active.has(name)) fail('Calculation or bound dependency cycle', name)
    active.add(name)
    const expression = Object.hasOwn(calculations, name) ? calculations[name] : undefined
    const constraint = rules.get(name)
    if (expression && Object.hasOwn(input, name)) fail('Derived values cannot shadow controls', name)
    const dependencies = expression ? formExpressionFields(expression) : constraint ? [constraint.minValueField, constraint.maxValueField].filter((value): value is string => Boolean(value)) : []
    for (const dependency of dependencies) {
      if (!Object.hasOwn(input, dependency) && !Object.hasOwn(calculations, dependency)) fail(`Unknown calculation value: ${dependency}`, name)
      visit(dependency)
    }
    if (expression) values[name] = evaluate(expression, values, `calculations.${name}`)
    if (constraint && Object.hasOwn(values, name)) {
      const min = constraint.minValueField ? numeric(values[constraint.minValueField], name) : constraint.min
      const max = constraint.maxValueField ? numeric(values[constraint.maxValueField], name) : constraint.max
      if (min !== undefined && max !== undefined && min > max) fail('Dynamic minimum exceeds maximum', name)
      values[name] = String(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, numeric(values[name], name))))
    }
    active.delete(name); complete.add(name)
  }
  for (const name of [...Object.keys(calculations), ...rules.keys()]) visit(name)
  return values
}
