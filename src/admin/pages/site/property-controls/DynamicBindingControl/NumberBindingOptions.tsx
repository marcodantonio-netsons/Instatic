import { useState } from 'react'
import type { DynamicPropBinding } from '@core/page-tree'
import { Input } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import styles from './NumberBindingOptions.module.css'

interface NumberBindingOptionsProps {
  propKey: string
  binding: DynamicPropBinding
  pageLanguage?: string
  onUpdateNumberFormat: (patch: Partial<NonNullable<DynamicPropBinding['numberFormat']>>) => void
}

export function NumberBindingOptions({
  propKey,
  binding,
  pageLanguage,
  onUpdateNumberFormat,
}: NumberBindingOptionsProps) {
  const boundLocale = binding.numberFormat?.locale ?? ''
  const [localeDraft, setLocaleDraft] = useState(boundLocale)
  const [templateKeyDraft, setTemplateKeyDraft] = useState(binding.numberFormat?.templateKey ?? '')
  const [localeInvalid, setLocaleInvalid] = useState(false)

  function updateFractionDigits(
    option: 'minimumFractionDigits' | 'maximumFractionDigits',
    rawValue: string,
  ) {
    const value = rawValue === '' ? undefined : Number(rawValue)
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 20)) return
    const otherOption = option === 'minimumFractionDigits' ? 'maximumFractionDigits' : 'minimumFractionDigits'
    const otherValue = binding.numberFormat?.[otherOption]
    const patch = value !== undefined && otherValue !== undefined && (
      option === 'minimumFractionDigits' ? value > otherValue : value < otherValue
    )
      ? { [option]: value, [otherOption]: value }
      : { [option]: value }
    onUpdateNumberFormat(patch)
  }

  function commitLocale() {
    const locale = localeDraft.trim()
    if (!locale) {
      setLocaleInvalid(false)
      onUpdateNumberFormat({ locale: undefined })
      return
    }
    try {
      const canonicalLocale = Intl.getCanonicalLocales(locale)[0]
      if (!canonicalLocale) throw new RangeError('A locale tag is required')
      setLocaleDraft(canonicalLocale)
      setLocaleInvalid(false)
      onUpdateNumberFormat({ locale: canonicalLocale })
    } catch {
      setLocaleInvalid(true)
    }
  }

  function commitTemplateKey(rawValue: string) {
    const templateKey = rawValue.trim()
    setTemplateKeyDraft(templateKey)
    onUpdateNumberFormat({ templateKey: templateKey || undefined })
  }

  return (
    <div className={styles.numberSettings}>
      <p className={styles.numberSettingsHint}>
        Uses the page language and Intl decimal defaults unless overridden below. A language template must contain exactly one {'{value}'} placeholder.
      </p>
      <div className={styles.numberOption}>
        <label htmlFor={`binding-min-fraction-${propKey}`}>Minimum fraction digits</label>
        <Input
          id={`binding-min-fraction-${propKey}`}
          type="number"
          fieldSize="sm"
          min={0}
          max={20}
          step={1}
          value={binding.numberFormat?.minimumFractionDigits ?? ''}
          aria-label="Minimum fraction digits"
          onChange={(event) => updateFractionDigits('minimumFractionDigits', event.currentTarget.value)}
        />
      </div>
      <div className={styles.numberOption}>
        <label htmlFor={`binding-max-fraction-${propKey}`}>Maximum fraction digits</label>
        <Input
          id={`binding-max-fraction-${propKey}`}
          type="number"
          fieldSize="sm"
          min={0}
          max={20}
          step={1}
          value={binding.numberFormat?.maximumFractionDigits ?? ''}
          aria-label="Maximum fraction digits"
          onChange={(event) => updateFractionDigits('maximumFractionDigits', event.currentTarget.value)}
        />
      </div>
      <div className={styles.numberOption}>
        <label htmlFor={`binding-number-locale-${propKey}`}>Locale override</label>
        <Input
          id={`binding-number-locale-${propKey}`}
          fieldSize="sm"
          value={localeDraft}
          placeholder={pageLanguage ?? 'Page language'}
          aria-label="Number format locale override"
          invalid={localeInvalid}
          aria-describedby={localeInvalid ? `binding-locale-error-${propKey}` : undefined}
          onChange={(event) => setLocaleDraft(event.currentTarget.value)}
          onBlur={commitLocale}
        />
        {localeInvalid && (
          <span id={`binding-locale-error-${propKey}`} className={styles.numberSettingsError} role="alert">
            Enter a valid BCP 47 locale.
          </span>
        )}
      </div>
      <div className={styles.numberOption}>
        <label htmlFor={`binding-number-template-${propKey}`}>Language template key</label>
        <Input
          id={`binding-number-template-${propKey}`}
          fieldSize="sm"
          value={templateKeyDraft}
          placeholder="pricing.monthly"
          aria-label="Number format language template key"
          onChange={(event) => setTemplateKeyDraft(event.currentTarget.value)}
          onBlur={(event) => commitTemplateKey(event.currentTarget.value)}
        />
      </div>
      <div className={styles.numberOption}>
        <label htmlFor={`binding-grouping-${propKey}`}>Grouping</label>
        <Select
          id={`binding-grouping-${propKey}`}
          fieldSize="sm"
          value={binding.numberFormat?.useGrouping === undefined
            ? 'default'
            : binding.numberFormat.useGrouping ? 'group' : 'none'}
          options={[
            { value: 'default', label: 'Locale default' },
            { value: 'group', label: 'Group digits' },
            { value: 'none', label: 'No grouping' },
          ]}
          onChange={(event) => onUpdateNumberFormat({
            useGrouping: event.currentTarget.value === 'default'
              ? undefined
              : event.currentTarget.value === 'group',
          })}
        />
      </div>
    </div>
  )
}
