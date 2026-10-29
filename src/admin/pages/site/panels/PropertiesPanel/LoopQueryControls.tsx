import { useId, useState } from 'react'
import { LoopSearchConfigurationSchema, type LoopQueryBinding, type LoopSearchConfiguration } from '@core/loops-schema'
import { parseValue } from '@core/utils/typeboxHelpers'
import { Button } from '@ui/components/Button'
import { ControlRow } from '@ui/components/ControlRow'
import { Input } from '@ui/components/Input'
import { Switch } from '@ui/components/Switch'
import { PropertyControlRenderer } from '@site/property-controls/PropertyControlRenderer'
import type { LoopFormOption } from './loopQueryModel'
import styles from './LoopQueryControls.module.css'

type Option = { value: string; label: string }
interface Props {
  search: LoopSearchConfiguration | undefined
  searchFields: Option[]
  bindings: LoopQueryBinding[]
  filterOptions: Option[]
  forms: LoopFormOption[]
  onSearchChange: (value: LoopSearchConfiguration | undefined) => void
  onBindingsChange: (value: LoopQueryBinding[]) => void
}

/** Structured, validated configuration; visitor input never chooses a source or column. */
export function LoopQueryControls({ search, searchFields, bindings, filterOptions, forms, onSearchChange, onBindingsChange }: Props) {
  const prefix = useId()
  function searchChange(patch: Partial<LoopSearchConfiguration>) {
    if (search) onSearchChange(parseValue(LoopSearchConfigurationSchema, { ...search, ...patch }))
  }
  function bindingChange(index: number, patch: Partial<LoopQueryBinding>) {
    const next = bindings.map((binding, i) => i === index ? { ...binding, ...patch } : binding)
    onBindingsChange(next.map(binding => !binding.whenFieldEmpty || next.some(other => other.formId === binding.formId && other.fieldName === binding.whenFieldEmpty)
      ? binding : { ...binding, whenFieldEmpty: undefined }))
  }
  function removeBinding(index: number) {
    const removed = bindings[index]
    onBindingsChange(bindings.filter((_, i) => i !== index).map(binding => binding.formId === removed.formId && binding.whenFieldEmpty === removed.fieldName ? { ...binding, whenFieldEmpty: undefined } : binding))
  }
  function addBinding() {
    const filter = filterOptions.find(option => !bindings.some(binding => binding.filterKey === option.value)), form = forms[0]
    if (!filter || !form) return
    const fieldName = form.fields[0]
    let queryParameter = fieldName, suffix = 2
    while (bindings.some(binding => binding.queryParameter === queryParameter)) queryParameter = fieldName + '_' + suffix++
    onBindingsChange([...bindings, { filterKey: filter.value, formId: form.id, fieldName, queryParameter, valueType: filter.value === 'rowIds' ? 'stringArray' : 'text' }])
  }
  const available = filterOptions.some(option => !bindings.some(binding => binding.filterKey === option.value))
  return <div className={styles.group}>
    {searchFields.length > 0 || search ? <>
      <ControlRow propKey={prefix + '-search'} label="Search fields">
        <Switch id={'ctrl-' + prefix + '-search'} aria-label="Configure searchable fields" checked={Boolean(search)} disabled={!search && !searchFields.length} onCheckedChange={enabled => onSearchChange(enabled ? parseValue(LoopSearchConfigurationSchema, {
          fields: [{ field: searchFields[0].value, phraseWeight: 0, termWeight: 1 }],
          match: 'contains', rank: 'source', phraseBoost: 'sum', normalization: { lowercase: true, removeDiacritics: false, punctuationToSpaces: false, stripLeading: '', trim: true },
        }) : undefined)} />
      </ControlRow>
      {search ? <>
        {search.fields.map((field, index) => <fieldset className={styles.item} key={index} aria-label={'Search field ' + (index + 1)}>
          <div className={styles.header}><span>Search field {index + 1}</span><Button variant="ghost" size="micro" disabled={search.fields.length === 1} onClick={() => searchChange({ fields: search.fields.filter((_, i) => i !== index) })}>Remove</Button></div>
          <PropertyControlRenderer propKey={prefix + '-field-' + index} control={{ type: 'select', label: 'Field', options: searchFields }} value={field.field} onChange={(_, value) => { if (typeof value === 'string' && searchFields.some(option => option.value === value)) searchChange({ fields: search.fields.map((entry, i) => i === index ? { ...entry, field: value } : entry) }) }} />
          {(['phraseWeight', 'termWeight'] as const).map(key => <PropertyControlRenderer key={key} propKey={prefix + '-' + key + '-' + index} control={{ type: 'number', label: key === 'phraseWeight' ? 'Phrase weight' : 'Term weight', min: 0, step: 1 }} value={field[key]} onChange={(_, value) => { if (typeof value === 'number' && Number.isFinite(value) && value >= 0) searchChange({ fields: search.fields.map((entry, i) => i === index ? { ...entry, [key]: value } : entry) }) }} />)}
        </fieldset>)}
        <Button variant="secondary" size="xs" disabled={search.fields.length >= 32 || search.fields.length >= searchFields.length} onClick={() => { const next = searchFields.find(option => !search.fields.some(field => field.field === option.value)); if (next) searchChange({ fields: [...search.fields, { field: next.value, phraseWeight: 0, termWeight: 1 }] }) }}>Add search field</Button>
        <PropertyControlRenderer propKey={prefix + '-match'} control={{ type: 'select', label: 'Match', options: [{ label: 'Contains phrase', value: 'contains' }, { label: 'All words', value: 'allTerms' }, { label: 'Any word', value: 'anyTerm' }] }} value={search.match} onChange={(_, value) => searchChange({ match: parseValue(LoopSearchConfigurationSchema.properties.match, value) })} />
        <PropertyControlRenderer propKey={prefix + '-rank'} control={{ type: 'select', label: 'Results order', options: [{ label: 'Source order', value: 'source' }, { label: 'Relevance score', value: 'score' }] }} value={search.rank} onChange={(_, value) => searchChange({ rank: parseValue(LoopSearchConfigurationSchema.properties.rank, value) })} />
        <PropertyControlRenderer propKey={prefix + '-phrase'} control={{ type: 'select', label: 'Phrase boost', options: [{ label: 'Sum field weights', value: 'sum' }, { label: 'First matching field', value: 'first' }] }} value={search.phraseBoost} onChange={(_, value) => searchChange({ phraseBoost: parseValue(LoopSearchConfigurationSchema.properties.phraseBoost, value) })} />
        <PropertyControlRenderer propKey={prefix + '-tie'} control={{ type: 'select', label: 'Equal scores', options: [{ label: 'Keep source order', value: '' }, ...searchFields] }} value={search.tieBreakField ?? ''} onChange={(_, value) => { if (typeof value === 'string' && (!value || searchFields.some(field => field.value === value))) searchChange({ tieBreakField: value || undefined }) }} />
        {(['lowercase', 'removeDiacritics', 'punctuationToSpaces', 'trim'] as const).map(key => <PropertyControlRenderer key={key} propKey={prefix + '-normal-' + key} control={{ type: 'toggle', label: ({ lowercase: 'Ignore case', removeDiacritics: 'Ignore accents', punctuationToSpaces: 'Punctuation as spaces', trim: 'Trim whitespace' })[key] }} value={search.normalization[key]} onChange={(_, value) => { if (typeof value === 'boolean') searchChange({ normalization: { ...search.normalization, [key]: value } }) }} />)}
        <PropertyControlRenderer propKey={prefix + '-strip'} control={{ type: 'text', label: 'Strip query prefix' }} value={search.normalization.stripLeading} onChange={(_, value) => { if (typeof value === 'string') searchChange({ normalization: { ...search.normalization, stripLeading: value } }) }} />
      </> : null}
    </> : null}
    {filterOptions.length ? <>
      <div className={styles.header}><span>Visitor filters</span><Button variant="secondary" size="xs" disabled={!forms.length || !available} onClick={addBinding}>Add binding</Button></div>
      {!forms.length ? <p>Add a named field to a native form on this page to connect visitor filters.</p> : null}
      {bindings.map((binding, index) => {
        const form = forms.find(candidate => candidate.id === binding.formId)
        const dependencies = bindings.filter(other => other.formId === binding.formId && other.fieldName !== binding.fieldName)
        const controls = [
          { key: 'filterKey' as const, label: 'Source filter', value: binding.filterKey, options: filterOptions.filter(option => option.value === binding.filterKey || !bindings.some(other => other.filterKey === option.value)), change: (value: string) => bindingChange(index, { filterKey: value }) },
          { key: 'formId' as const, label: 'Form', value: binding.formId, options: forms.map(candidate => ({ label: candidate.id, value: candidate.id })), change: (value: string) => { const next = forms.find(candidate => candidate.id === value); if (next) bindingChange(index, { formId: value, fieldName: next.fields[0], whenFieldEmpty: undefined }) } },
          { key: 'fieldName' as const, label: 'Form value', value: binding.fieldName, options: (form?.fields ?? []).map(name => ({ label: name, value: name })), change: (value: string) => bindingChange(index, { fieldName: value }) },
        ]
        return <fieldset className={styles.item} key={binding.filterKey} aria-label={'Visitor filter ' + (index + 1)}>
          <div className={styles.header}><span>Visitor filter {index + 1}</span><Button variant="ghost" size="micro" onClick={() => removeBinding(index)}>Remove</Button></div>
          {controls.map(control => <PropertyControlRenderer key={control.key} propKey={prefix + '-' + control.key + '-' + index} control={{ type: 'select', label: control.label, options: control.options }} value={control.value} onChange={(_, value) => { if (typeof value === 'string' && control.options.some(option => option.value === value)) control.change(value) }} />)}
          {!form || !form.fields.includes(binding.fieldName) ? <p role="alert" className={styles.error}>The bound form value is missing. Choose an available form and field.</p> : null}
          <CommittedQueryParameter key={binding.queryParameter} labelId={prefix + '-param-' + index} value={binding.queryParameter} used={bindings.filter((_, i) => i !== index).map(other => other.queryParameter)} onChange={value => bindingChange(index, { queryParameter: value })} />
          <PropertyControlRenderer propKey={prefix + '-type-' + index} control={{ type: 'select', label: 'Value type', options: [{ label: 'Text', value: 'text' }, { label: 'List of row IDs', value: 'stringArray' }] }} value={binding.valueType ?? 'text'} onChange={(_, value) => { if (value === 'text' || value === 'stringArray') bindingChange(index, { valueType: value }) }} />
          <PropertyControlRenderer propKey={prefix + '-when-' + index} control={{ type: 'select', label: 'Only while empty', options: [{ label: 'Always active', value: '' }, ...dependencies.map(other => ({ label: other.fieldName, value: other.fieldName }))] }} value={binding.whenFieldEmpty ?? ''} onChange={(_, value) => { if (typeof value === 'string' && (!value || dependencies.some(other => other.fieldName === value))) bindingChange(index, { whenFieldEmpty: value || undefined }) }} />
        </fieldset>
      })}
    </> : null}
  </div>
}

function CommittedQueryParameter({ labelId, value, used, onChange }: { labelId: string; value: string; used: string[]; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  const error = !draft.trim() ? 'Enter a query parameter.' : used.includes(draft.trim()) ? 'Each binding needs a different query parameter.' : ''
  return <ControlRow propKey={labelId} label="Query parameter" description={error ? <span role="alert" className={styles.error}>{error}</span> : undefined}>
    <Input id={'ctrl-' + labelId} aria-label="Query parameter" value={draft} invalid={Boolean(error)} onChange={event => setDraft(event.target.value)} onBlur={() => { if (!error && draft.trim() !== value) onChange(draft.trim()) }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
  </ControlRow>
}
