import type { PropertySchema } from '@core/module-engine'
import { escapeHtml } from '@core/publisher'
import type { FormControlBehavior } from '@core/forms-schema'

export const formBehaviorControls: PropertySchema = {
  requiredWhen: { type: 'condition', label: 'Required when', category: 'layout' },
  disabledWhen: { type: 'condition', label: 'Disabled when', category: 'layout' },
  minValueField: { type: 'text', label: 'Minimum from value', category: 'layout' },
  maxValueField: { type: 'text', label: 'Maximum from value', category: 'layout' },
  clearFieldsOnChange: { type: 'text', label: 'Clear text controls on change (comma separated)', category: 'layout' },
  queryParameter: { type: 'text', label: 'Initial query parameter', category: 'layout' },
  queryOverflow: { type: 'select', label: 'Long query values', category: 'layout', options: [{ label: 'Reject', value: 'reject' }, { label: 'Truncate to field limit', value: 'truncate' }] },
  trimOnSubmit: { type: 'toggle', label: 'Trim text before submission', category: 'layout' },
  submitOnChange: { type: 'toggle', label: 'Run local form action after change', category: 'layout' },
  lockQueryValue: { type: 'toggle', label: 'Lock a valid query value', category: 'layout' },
  resetBehavior: { type: 'select', label: 'After reset', category: 'layout', options: [{ label: 'Initial value', value: 'initial' }, { label: 'Clear value', value: 'clear' }, { label: 'Keep current value', value: 'preserve' }] },
  valueSourceField: { type: 'text', label: 'Value from control', category: 'layout' },
  valueTargetField: { type: 'text', label: 'Write edits to control', category: 'layout' },
  syncGroup: { type: 'text', label: 'Shared value group', category: 'layout' },
  requiredMessage: { type: 'text', label: 'Required value message' },
  invalidMessage: { type: 'text', label: 'Invalid value message' },
}

/** String props already passed publisher escaping; structured conditions have not. */
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
