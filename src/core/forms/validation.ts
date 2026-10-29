import type {
  DataField,
  DataSelectOption,
  DataTable,
} from '@core/data/schemas'
import { isValidEmail } from '../utils/email'
import { evaluateCondition } from '@core/module-engine-schema'
import { evaluateFormValues } from '@core/form-values'
import type { FormCalculations, FormValueConstraint } from '@core/forms-schema'
import type {
  FormControlBinding,
  FormSubmissionLimits,
  FormValidationError,
} from './schemas'

const DEFAULT_MAX_FIELDS = 100
const DEFAULT_MAX_STRING_LENGTH = 10_000

type FormValidationResult =
  | { ok: true; cells: Record<string, unknown> }
  | { ok: false; errors: FormValidationError[] }

export function validateFormSubmission(input: {
  table: DataTable
  controls: FormControlBinding[]
  values: Record<string, unknown>
  limits?: FormSubmissionLimits
  calculations?: FormCalculations
}): FormValidationResult {
  const limits = input.limits ?? {}
  const errors: FormValidationError[] = []
  const cells: Record<string, unknown> = {}
  const maxFields = limits.maxFields ?? DEFAULT_MAX_FIELDS
  const maxStringLength = limits.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH
  const submitted = { ...input.values }
  for (const control of input.controls) {
    const name = control.name ?? control.fieldId, value = submitted[name]
    if (control.trimOnSubmit && typeof value === 'string') submitted[name] = value.trim()
  }
  const defaults = Object.fromEntries(input.controls.filter((control) => control.initialValue !== undefined).map((control) => [control.name ?? control.fieldId, control.initialValue]))
  const constraints: FormValueConstraint[] = input.controls.filter((control) => control.minValueField || control.maxValueField).map((control) => ({ fieldName: control.name ?? control.fieldId, minValueField: control.minValueField, maxValueField: control.maxValueField, min: control.min, max: control.max }))
  let resolved: Record<string, unknown>
  try { resolved = Object.keys(input.calculations ?? {}).length || constraints.length ? evaluateFormValues(input.calculations ?? {}, { ...defaults, ...submitted }, constraints) : submitted }
  catch { return { ok: false, errors: [{ fieldId: '*', code: 'invalid_value', message: 'Invalid calculated form values.' }] } }

  const controlByName = new Map<string, FormControlBinding>()
  const activeControls = input.controls.filter((control) => !control.disabled && (!control.disabledWhen || !evaluateCondition(control.disabledWhen, resolved)) && (control.conditions ?? []).every((condition) => evaluateCondition(condition, resolved)))
  const fieldById = new Map(input.table.fields.map((field) => [field.id, field]))
  for (const original of activeControls) {
    const control = { ...original, ...(original.requiredWhen ? { required: evaluateCondition(original.requiredWhen, resolved) } : {}), ...(original.minValueField ? { min: Number(resolved[original.minValueField]) } : {}), ...(original.maxValueField ? { max: Number(resolved[original.maxValueField]) } : {}) }
    const name = control.name ?? control.fieldId
    const previous = controlByName.get(name)
    controlByName.set(name, previous && ['radio','checkbox-group'].includes(control.inputType ?? '') && previous.inputType === control.inputType
      ? { ...control, required: previous.required || control.required, options: [...(previous.options ?? []), ...(control.options ?? [])] }
      : control)
  }

  const entries = Object.entries(submitted)
  if (entries.length > maxFields) {
    errors.push({
      fieldId: '*',
      code: 'too_many_fields',
      message: 'Too many fields submitted.',
    })
  }

  for (const [name, rawValue] of entries) {
    const control = controlByName.get(name)
    if (!control) {
      errors.push({
        fieldId: name,
        code: 'unknown_field',
        message: 'Unknown field.',
      })
      continue
    }

    const field = fieldById.get(control.fieldId)
    if (!field) {
      errors.push({
        fieldId: control.fieldId,
        code: 'unknown_field',
        message: 'Unknown field.',
      })
      continue
    }

    if ((control.inputType === 'radio' && typeof rawValue !== 'string') || (control.options && (Array.isArray(rawValue) ? rawValue : [rawValue]).some((value) => typeof value !== 'string' || !control.options!.includes(value)))) {
      errors.push({ fieldId: control.fieldId, code: 'invalid_option', message: 'Select an offered option.' })
      continue
    }
    if (control.inputType === 'checkbox-group') {
      const selected = Array.isArray(rawValue) ? rawValue : [rawValue]
      if (new Set(selected).size !== selected.length || selected.length < (control.minSelected ?? 0) || Boolean(control.maxSelected && selected.length > control.maxSelected)) {
        errors.push({ fieldId: control.fieldId, code: 'invalid_value', message: 'Invalid selection count.' }); continue
      }
    }
    if (control.valueSourceField && rawValue !== (control.valueTargetField ? String(resolved[control.valueSourceField] ?? '') : submitted[control.valueSourceField])) {
      errors.push({ fieldId: control.fieldId, code: 'invalid_value', message: 'Invalid synchronized value.' })
      continue
    }
    if (control.syncGroup && [...controlByName.values()].some((peer) => peer.syncGroup === control.syncGroup && submitted[peer.name ?? peer.fieldId] !== rawValue)) {
      errors.push({ fieldId: control.fieldId, code: 'invalid_value', message: 'Invalid shared group value.' })
      continue
    }
    const coerced = coerceFieldValue(field, rawValue)
    if (!coerced.ok) {
      errors.push({ fieldId: field.id, code: coerced.code, message: coerced.message })
      continue
    }

    const validationError = validateCoercedValue(field, control, coerced.value, maxStringLength)
    if (validationError) {
      errors.push(validationError)
      continue
    }

    cells[field.id] = coerced.value
  }

  for (const control of controlByName.values()) {
    const field = fieldById.get(control.fieldId)
    if (!field) continue
    const name = control.name ?? control.fieldId
    const required = control.required ?? Boolean(field.required)
    if (Object.hasOwn(submitted, name)) continue
    if (control.inputType === 'checkbox-group' && control.minSelected) { errors.push({ fieldId: field.id, code: 'required', message: 'Choose the required number of options.' }); continue }
    if (!required && field.type === 'boolean') {
      cells[field.id] = false
      continue
    }
    if (!required) continue
    errors.push({
      fieldId: field.id,
      code: 'required',
      message: 'This field is required.',
    })
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, cells }
}

type CoerceResult =
  | { ok: true; value: unknown }
  | { ok: false; code: string; message: string }

function coerceFieldValue(field: DataField, value: unknown): CoerceResult {
  if (value === '' || value === null || value === undefined) return { ok: true, value: null }

  switch (field.type) {
    case 'text':
    case 'longText':
    case 'richText':
    case 'url':
    case 'email':
    case 'date':
    case 'dateTime':
      return { ok: true, value: String(value) }
    case 'select': {
      const optionId = resolveOptionId(field.options, String(value))
      return optionId === null ? invalidOption() : { ok: true, value: optionId }
    }
    case 'number': {
      const numberValue = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(numberValue)
        ? { ok: true, value: numberValue }
        : { ok: false, code: 'invalid_number', message: 'Enter a valid number.' }
    }
    case 'boolean':
      return { ok: true, value: coerceBoolean(value) }
    case 'multiSelect': {
      const optionIds: string[] = []
      for (const item of Array.isArray(value) ? value : [value]) {
        const optionId = resolveOptionId(field.options, String(item))
        if (optionId === null) return invalidOption()
        optionIds.push(optionId)
      }
      return { ok: true, value: optionIds }
    }
    case 'media':
      if (field.allowMultiple) {
        return Array.isArray(value)
          ? { ok: true, value: value.map(String) }
          : { ok: true, value: [String(value)] }
      }
      return { ok: true, value: String(value) }
    case 'relation':
      if (field.allowMultiple) {
        return Array.isArray(value)
          ? { ok: true, value: value.map(String) }
          : { ok: true, value: [String(value)] }
      }
      return { ok: true, value: String(value) }
    case 'pageTree':
    case 'fieldSchema':
    case 'repeater':
    case 'localizedText':
      return { ok: false, code: 'unsupported_field', message: 'This field cannot be submitted by a form.' }
  }
}

function invalidOption(): CoerceResult {
  return { ok: false, code: 'invalid_option', message: 'Choose one of the allowed options.' }
}

// Form controls submit the option `value` authors see in the Data tab, while
// the stored cell is the option `id` (see src/core/data/schemas.ts). Accept
// either and store the id.
function resolveOptionId(options: DataSelectOption[], raw: string): string | null {
  const option = options.find((candidate) => candidate.id === raw || candidate.value === raw)
  return option ? option.id : null
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const normalized = String(value).toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes'
}

function validateCoercedValue(
  field: DataField,
  control: FormControlBinding,
  value: unknown,
  maxStringLength: number,
): FormValidationError | null {
  const required = control.required ?? Boolean(field.required)
  if (required && (value === null || value === '')) {
    return { fieldId: field.id, code: 'required', message: 'This field is required.' }
  }
  if (value === null) return null

  if (typeof value === 'string') {
    const maxLength = control.maxLength ?? ('maxLength' in field ? field.maxLength : undefined) ?? maxStringLength
    if (value.length > maxLength) {
      return {
        fieldId: field.id,
        code: 'too_long',
        message: `Must be ${maxLength} characters or fewer.`,
      }
    }
    if (control.minLength !== undefined && value.length < control.minLength) {
      return {
        fieldId: field.id,
        code: 'too_short',
        message: `Must be at least ${control.minLength} characters.`,
      }
    }
    if (field.type === 'email' && !isValidEmail(value)) {
      return { fieldId: field.id, code: 'invalid_email', message: 'Enter a valid email address.' }
    }
    if (field.type === 'url' && !isValidUrl(value)) {
      return { fieldId: field.id, code: 'invalid_url', message: 'Enter a valid URL.' }
    }
    if (control.pattern) {
      let regex: RegExp
      try {
        regex = new RegExp(control.pattern)
      } catch {
        return {
          fieldId: field.id,
          code: 'invalid_pattern',
          message: 'This field has an invalid validation pattern.',
        }
      }
      if (!regex.test(value)) {
        return { fieldId: field.id, code: 'pattern_mismatch', message: 'Use the requested format.' }
      }
    }
  }

  if (typeof value === 'number') {
    const min = control.min ?? ('min' in field ? field.min : undefined)
    const max = control.max ?? ('max' in field ? field.max : undefined)
    if (min !== undefined && value < min) {
      return { fieldId: field.id, code: 'too_small', message: `Must be at least ${min}.` }
    }
    if (max !== undefined && value > max) {
      return { fieldId: field.id, code: 'too_large', message: `Must be ${max} or less.` }
    }
  }

  return null
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
