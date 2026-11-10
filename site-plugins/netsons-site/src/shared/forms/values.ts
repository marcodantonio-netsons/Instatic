import type { FormCalculations, FormValueConstraint, FormValueExpression, FormValue } from './calculations'

export class FormValueError extends Error {
  readonly path: string
  constructor(message: string, path: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'FormValueError'
    this.path = path
  }
}

const RESERVED = new Set(['__proto__', 'prototype', 'constructor'])
function fail(message: string, path: string): never { throw new FormValueError(message, path) }

export interface FormValueUrl {
  readonly protocol: string
  readonly host: string
  readonly hostname: string
  readonly username: string
  readonly password: string
  readonly pathname: string
  readonly hash: string
  readonly search: string
  readonly href: string
  readonly searchParams: { set(name: string, value: string): void }
}

function splitUrl(value: string): { protocol: string; authority: string; pathname: string; search: string; hash: string } {
  const match = /^([a-zA-Z][a-zA-Z0-9.+-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(value)
  if (!match || !match[2]) fail('Invalid computed URL', 'url')
  return { protocol: `${match[1].toLowerCase()}:`, authority: match[2], pathname: match[3] || '/', search: match[4] || '', hash: match[5] || '' }
}

function pathWithQuery(value: string): { pathname: string; search: string; hash: string } {
  const hashStart = value.indexOf('#')
  const hash = hashStart < 0 ? '' : value.slice(hashStart)
  const withoutHash = hashStart < 0 ? value : value.slice(0, hashStart)
  const queryStart = withoutHash.indexOf('?')
  const search = queryStart < 0 ? '' : withoutHash.slice(queryStart)
  const pathname = queryStart < 0 ? withoutHash : withoutHash.slice(0, queryStart)
  return { pathname, search, hash }
}

function normalizePath(pathname: string): string {
  const trailingSlash = pathname.endsWith('/')
  const segments: string[] = []
  for (const segment of pathname.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  const result = `/${segments.join('/')}`
  return (trailingSlash && result !== '/' ? `${result}/` : result).replace(/ /g, '%20')
}

function encodeQueryPart(value: string): string {
  return encodeURIComponent(value).replace(/[!'()~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, '+')
}

function decodeQueryPart(value: string): string {
  try { return decodeURIComponent(value.replace(/\+/g, ' ')) } catch { return value }
}

/**
 * Resolve the closed URL expression without relying on `URL` in the module
 * pack sandbox. QuickJS's URL shim accepts only absolute URLs; this subset
 * keeps SSR, browser updates, and sandbox renders on the same authority.
 */
export function formValueUrl(value: string, base = 'https://instatic.invalid'): FormValueUrl {
  if (value.trimStart().startsWith('//') || Array.from(value).some((character) => character.charCodeAt(0) < 32 || character === '\\')) {
    fail('Computed URLs require a relative or HTTP(S) base without credentials', 'url')
  }

  // Use the platform URL parser in the browser and on hosts with a complete
  // URL implementation. The QuickJS module-pack shim accepts absolute URLs
  // but does not resolve relative paths or update href after searchParams.set;
  // detect both gaps before falling through to the small local resolver.
  try {
    const url = new URL(value, base)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      fail('Computed URLs require a relative or HTTP(S) base without credentials', 'url')
    }
    const probe = new URL(url.href)
    const marker = `__instatic_url_probe_${value.length}_${base.length}__`
    probe.searchParams.set(marker, '1')
    if (!probe.searchParams.has(marker) || !probe.href.includes(`${encodeURIComponent(marker)}=1`)) return resolveUrlWithoutPlatform(url.href, base)
    return url
  } catch (error) {
    if (error instanceof FormValueError) throw error
  }

  return resolveUrlWithoutPlatform(value, base)
}

function resolveUrlWithoutPlatform(value: string, base: string): FormValueUrl {
  const input = value.trim()

  const scheme = /^([a-zA-Z][a-zA-Z0-9.+-]*):/.exec(input)
  let parts: ReturnType<typeof splitUrl>
  if (scheme) {
    if (!/^https?:\/\//i.test(input)) fail('Computed URLs require a relative or HTTP(S) base without credentials', 'url')
    parts = splitUrl(input)
  } else {
    const parent = splitUrl(base)
    const authority = parent.authority
    const relative = pathWithQuery(input)
    let pathname: string
    let search: string
    let hash: string
    if (input.startsWith('#')) {
      pathname = parent.pathname
      search = parent.search
      hash = input
    } else if (input.startsWith('?')) {
      pathname = parent.pathname
      search = relative.search
      hash = relative.hash
    } else {
      pathname = input.startsWith('/')
        ? relative.pathname
        : `${parent.pathname.slice(0, parent.pathname.lastIndexOf('/') + 1)}${relative.pathname}`
      pathname = normalizePath(pathname)
      search = relative.search
      hash = relative.hash
    }
    parts = { protocol: parent.protocol, authority, pathname, search, hash }
  }

  if (!['http:', 'https:'].includes(parts.protocol) || parts.authority.includes('@')) {
    fail('Computed URLs require a relative or HTTP(S) base without credentials', 'url')
  }
  const authority = parts.authority.toLowerCase()
  const hostMatch = /^(\[[0-9a-f:.]+\])(?::(\d+))?$|^([^:]+)(?::(\d+))?$/.exec(authority)
  if (!hostMatch) fail('Invalid computed URL', 'url')
  const hostname = hostMatch[1] || hostMatch[3]
  const port = hostMatch[2] || hostMatch[4] || ''
  const host = port ? `${hostname}:${port}` : hostname

  let search = parts.search
  const params = search ? search.slice(1).split('&').filter(Boolean).map((pair) => {
    const separator = pair.indexOf('=')
    return [decodeQueryPart(separator < 0 ? pair : pair.slice(0, separator)), decodeQueryPart(separator < 0 ? '' : pair.slice(separator + 1))]
  }) : [] as Array<[string, string]>
  const result: FormValueUrl = {
    protocol: parts.protocol,
    host,
    hostname,
    username: '',
    password: '',
    pathname: parts.pathname || '/',
    hash: parts.hash,
    get search() { return search },
    get href() { return `${parts.protocol}//${host}${parts.pathname || '/'}${search}${parts.hash}` },
    searchParams: {
      set(name: string, nextValue: string) {
        const key = String(name), next = String(nextValue)
        const existing = params.findIndex(([candidate]) => candidate === key)
        if (existing < 0) params.push([key, next])
        else {
          params[existing] = [key, next]
          for (let index = params.length - 1; index > existing; index -= 1) if (params[index][0] === key) params.splice(index, 1)
        }
        search = params.length ? `?${params.map(([param, paramValue]) => `${encodeQueryPart(param)}=${encodeQueryPart(paramValue)}`).join('&')}` : ''
      },
    },
  }
  return result
}

function numeric(value: unknown, path: string): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) fail('A calculation requires a finite number', path)
  const number = Number(value)
  if (!Number.isFinite(number)) fail('A calculation requires a finite number', path)
  return number
}

function scalar(value: unknown, path: string): string {
  if (value === null) return ''
  if (!['string', 'number', 'boolean'].includes(typeof value)) fail('A calculation requires a scalar value', path)
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

/** Bind formatting to the current runtime without changing its global Intl object. */
export function createFormValueEvaluator(NumberFormat: typeof Intl.NumberFormat) {
  function evaluate(expression: FormValueExpression, values: Record<string, unknown>, path: string): FormValue {
    if ('literal' in expression) return expression.literal
    if ('field' in expression) {
      if (!Object.hasOwn(values, expression.field)) fail(`Unknown calculation value: ${expression.field}`, path)
      const value = values[expression.field]
      if (Array.isArray(value)) {
        if (value.some((entry) => entry !== null && !['string', 'number', 'boolean'].includes(typeof entry))) fail('Calculation collections require scalar items', path)
        return value as FormValue
      }
      if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) fail('Calculation fields must be scalar or scalar collections', path)
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
      if (['round', 'floor', 'trunc'].includes(expression.op) && args.length !== 1) fail('Rounding operations require one operand', path)
      if (['subtract', 'divide'].includes(expression.op) && args.length < 2) fail('This operation requires at least two operands', path)
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
      try {
        return new NumberFormat(expression.locale, {
          minimumFractionDigits: expression.minimumFractionDigits,
          maximumFractionDigits: expression.maximumFractionDigits,
          style: expression.style,
          currency: expression.currency,
        }).format(numeric(evaluate(expression.value, values, `${path}.value`), path))
      } catch (error) {
        if (error instanceof FormValueError) throw error
        throw new FormValueError('Invalid number format configuration', path, { cause: error })
      }
    }
    const base = scalar(evaluate(expression.base, values, `${path}.base`), path)
    const url = formValueUrl(base)
    for (const [name, value] of Object.entries(expression.query)) url.searchParams.set(name, scalar(evaluate(value, values, `${path}.query.${name}`), path))
    return /^https?:/i.test(base) ? url.href : url.pathname + url.search + url.hash
  }

  function evaluateFormExpression(expression: FormValueExpression, values: Record<string, unknown>): FormValue {
    formExpressionFields(expression)
    return evaluate(expression, values, 'expression')
  }

  /** Evaluate derived fields and dynamic bounds as one dependency graph. */
  function evaluateFormValues(calculations: FormCalculations, input: Record<string, unknown>, constraints: readonly FormValueConstraint[] = []): Record<string, unknown> {
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
      active.delete(name)
      complete.add(name)
    }
    for (const name of [...Object.keys(calculations), ...rules.keys()]) visit(name)
    return values
  }

  return { evaluateFormExpression, evaluateFormValues }
}
