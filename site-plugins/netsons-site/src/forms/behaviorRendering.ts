import type { PluginPropertySchema } from '@instatic/plugin-sdk'
import { escapeHtml } from '../shared/htmlSafety'
import type { FormControlBehavior } from '../shared/forms'

export const formBehaviorControls: PluginPropertySchema = {
  minValueField: { type: 'text', label: 'Minimum from value' },
  maxValueField: { type: 'text', label: 'Maximum from value' },
  clearFieldsOnChange: { type: 'text', label: 'Clear text controls on change (comma separated)' },
  queryParameter: { type: 'text', label: 'Initial query parameter' },
  queryOverflow: { type: 'select', label: 'Long query values', options: [{ label: 'Reject', value: 'reject' }, { label: 'Truncate to field limit', value: 'truncate' }] },
  trimOnSubmit: { type: 'toggle', label: 'Trim text before submission' },
  submitOnChange: { type: 'toggle', label: 'Run local form action after change' },
  lockQueryValue: { type: 'toggle', label: 'Lock a valid query value' },
  resetBehavior: { type: 'select', label: 'After reset', options: [{ label: 'Initial value', value: 'initial' }, { label: 'Clear value', value: 'clear' }, { label: 'Keep current value', value: 'preserve' }] },
  valueSourceField: { type: 'text', label: 'Value from control' },
  valueTargetField: { type: 'text', label: 'Write edits to control' },
  syncGroup: { type: 'text', label: 'Shared value group' },
  requiredMessage: { type: 'text', label: 'Required value message' },
  invalidMessage: { type: 'text', label: 'Invalid value message' },
}

/** Structured conditions are nested JSON, so escape only when serializing them into HTML. */
export function controlBehaviorAttrs(props: FormControlBehavior & { _formOriginalRequired?: boolean; _formOriginalDisabled?: boolean }): string {
  return ` data-instatic-required="${props._formOriginalRequired ?? props.required}" data-instatic-disabled="${props._formOriginalDisabled ?? props.disabled}"`
    + (props.requiredWhen ? ` data-instatic-required-when="${escapeHtml(JSON.stringify(props.requiredWhen))}"` : '')
    + (props.disabledWhen ? ` data-instatic-disabled-when="${escapeHtml(JSON.stringify(props.disabledWhen))}"` : '')
    + (props.minValueField ? ` data-instatic-min-value-field="${props.minValueField}"` : '')
    + (props.maxValueField ? ` data-instatic-max-value-field="${props.maxValueField}"` : '')
    + (props.clearFieldsOnChange ? ` data-instatic-clear-fields-on-change="${props.clearFieldsOnChange}"` : '')
    + ` data-instatic-query-parameter="${props.queryParameter}" data-instatic-value-source="${props.valueSourceField}"`
    + (props.valueTargetField ? ` data-instatic-value-target="${props.valueTargetField}"` : '')
    + ` data-instatic-query-overflow="${props.queryOverflow}"`
    + (props.trimOnSubmit ? ' data-instatic-trim-on-submit="true"' : '')
    + (props.submitOnChange ? ' data-instatic-submit-on-change="true"' : '')
    + (props.syncGroup ? ` data-instatic-sync-group="${props.syncGroup}"` : '')
    + ` data-instatic-query-lock="${props.lockQueryValue}"`
    + ` data-instatic-reset-behavior="${props.resetBehavior}"`
    + ` data-instatic-required-message="${props.requiredMessage}" data-instatic-invalid-message="${props.invalidMessage}"`
}
