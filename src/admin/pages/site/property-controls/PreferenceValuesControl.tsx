import { useState } from 'react'
import {
  VisitorPreferencePatchSchema,
  VisitorThemeSchema,
  VisitorMotionSchema,
  VisitorMediaSchema,
  type VisitorPreferenceName,
} from '@core/visitor-preferences-schema'
import { compiledCheck } from '@core/utils/typeboxCompiler'
import { ControlRow } from '@ui/components/ControlRow'
import { Select } from '@ui/components/Select'
import type { ControlProps } from './shared'
import styles from './PreferenceValuesControl.module.css'

const fields = [
  { name: 'theme', label: 'Appearance', options: VisitorThemeSchema.anyOf.map(option => ({ value: option.const, label: { system: 'System', default: 'Default palette', alt: 'Alternate palette' }[option.const] })) },
  { name: 'motion', label: 'Motion', options: VisitorMotionSchema.anyOf.map(option => ({ value: option.const, label: { system: 'System', reduced: 'Reduced' }[option.const] })) },
  { name: 'media', label: 'Decorative media', options: VisitorMediaSchema.anyOf.map(option => ({ value: option.const, label: { full: 'Full', reduced: 'Reduced' }[option.const] })) },
] as const

/** A preference patch remains an object throughout authoring and persistence. */
export function PreferenceValuesControl({ propKey, value, onChange, label, disabled, isOverride }: ControlProps) {
  const [error, setError] = useState('')
  const values = compiledCheck(VisitorPreferencePatchSchema, value) ? value : null
  const groupLabel = label ?? propKey

  function update(name: VisitorPreferenceName, selected: string) {
    if (disabled) return
    const next = { ...values }
    if (selected === '') delete next[name]
    else Object.assign(next, { [name]: selected })
    if (!compiledCheck(VisitorPreferencePatchSchema, next)) {
      setError('Choose at least one preference. Add another preference before excluding the last one.')
      return
    }
    setError('')
    onChange(propKey, next)
  }

  return <ControlRow
    propKey={propKey}
    inputId={`ctrl-${propKey}-theme`}
    label={label}
    layout="stacked"
    isOverride={isOverride}
    disabled={disabled}
    description="Excluded preferences remain unchanged. Include at least one preference."
  >
    <div className={styles.fields} role="group" aria-label={groupLabel}>
      {!values && <span role="alert">This profile is invalid. Choose a preference below to replace its invalid values.</span>}
      {fields.map(field => <ControlRow key={field.name} propKey={`${propKey}-${field.name}`} label={field.label} disabled={disabled}>
        <Select
          id={`ctrl-${propKey}-${field.name}`}
          aria-label={`${groupLabel}: ${field.label}`}
          fieldSize="sm"
          value={values?.[field.name] ?? ''}
          disabled={disabled}
          onChange={event => update(field.name, event.target.value)}
        >
          <option value="">Not included</option>
          {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
      </ControlRow>)}
      {error && <span role="alert">{error}</span>}
    </div>
  </ControlRow>
}
