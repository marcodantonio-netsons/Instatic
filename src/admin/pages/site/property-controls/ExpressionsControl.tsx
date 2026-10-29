import { useState } from 'react'
import { FormCalculationsSchema, FormValueExpressionSchema } from '@core/forms-schema'
import { parseValue } from '@core/utils/typeboxHelpers'
import { Button } from '@ui/components/Button'
import { Textarea } from '@ui/components/Input'
import { ControlRow } from '@ui/components/ControlRow'
import type { ControlProps } from './shared'
import styles from './ExpressionsControl.module.css'

/** Edits declarative JSON data with a closed schema; executable code is never accepted. */
export function ExpressionsControl({ propKey, value, onChange, label, disabled, single = false }: ControlProps & { single?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  function apply() {
    try {
      const expressions = single ? parseValue(FormValueExpressionSchema, JSON.parse(draft)) : parseValue(FormCalculationsSchema, JSON.parse(draft))
      onChange(propKey, expressions)
      setEditing(false); setError('')
    } catch { setError('Enter a valid map of named expressions. JavaScript and unknown operations are not accepted.') }
  }
  return <ControlRow propKey={propKey} label={label} layout="stacked" disabled={disabled}>
    <div className={styles.control}>
      {editing ? <>
        <Textarea aria-label="Derived value expressions" rows={12} value={draft} disabled={disabled} onChange={(event) => { setDraft(event.target.value); setError('') }} />
        <span>Declare literal values, control fields, arithmetic, lookups, text, number formats and URLs as JSON data. The replace operation takes value, search and replacement; it replaces the first literal match without regular expressions.</span>
        {error && <span role="alert">{error}</span>}
        <div className={styles.actions}><Button size="sm" variant="secondary" disabled={disabled} onClick={apply}>Apply expressions</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
      </> : <Button size="sm" variant="ghost" disabled={disabled} onClick={() => { setDraft(JSON.stringify(value ?? (single ? { literal: '' } : {}), null, 2)); setError(''); setEditing(true) }}>Edit {single ? 'expression' : 'derived values'}</Button>}
    </div>
  </ControlRow>
}
