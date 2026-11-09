import { type Static, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { PluginModuleDefinition, PluginPropertySchema } from '@instatic/plugin-sdk'
import { htmlAttributesAttr } from '../shared/attributeEmitter'
import { escapeHtml, safeUrl } from '../shared/htmlSafety'
import { MODULE_GENERATED_ATTRIBUTE_NAMES } from '../shared/generatedAttributes'
import { resolveHtmlTag } from '../shared/tags'
import { TURNSTILE_LANGUAGES } from '../shared/forms'
import { renderInitialFormHtml } from './initialRender'
import { submitUsesChildren } from './content'
import { formBehaviorControls, controlBehaviorAttrs } from './behaviorRendering'
import { ConditionalPropsSchema, FormLinkPropsSchema, FormStepPropsSchema, OutputPropsSchema, TurnstilePropsSchema } from './behaviorSchemas'
import {
  ChoicePropsSchema,
  FormMessagePropsSchema,
  FormPropsSchema,
  InputPropsSchema,
  LabelPropsSchema,
  OptionGroupPropsSchema,
  OptionPropsSchema,
  SelectPropsSchema,
  SubmitPropsSchema,
  TextareaPropsSchema,
} from './primitiveSchemas'
import { languageFromPath, localizeRenderProps } from '../localization'

type FormProps = Static<typeof FormPropsSchema>
type InputProps = Static<typeof InputPropsSchema>
type TextareaProps = Static<typeof TextareaPropsSchema>
type SelectProps = Static<typeof SelectPropsSchema>
type ChoiceProps = Static<typeof ChoicePropsSchema>
type SubmitProps = Static<typeof SubmitPropsSchema>
type FormMessageProps = Static<typeof FormMessagePropsSchema>
type ConditionalProps = Static<typeof ConditionalPropsSchema>
type OutputProps = Static<typeof OutputPropsSchema>
type FormLinkProps = Static<typeof FormLinkPropsSchema>
type FormStepProps = Static<typeof FormStepPropsSchema>

const NATIVE_ROUTE_PATH = '{route.path}'

function moduleDefaults(schema: TSchema): Record<string, unknown> {
  const created: unknown = Value.Create(schema)
  if (!created || typeof created !== 'object' || Array.isArray(created)) throw new Error('Form module schemas must create object defaults')
  return { ...Object.fromEntries(Object.entries(created)), routePath: NATIVE_ROUTE_PATH }
}


/**
 * Plugin pack metadata in the official archive does not carry `propsSchema`
 * back to the host. Apply the canonical local defaults and validation at the
 * renderer boundary so malformed stored props fail instead of masking errors.
 */
function normalizeProps<T extends Record<string, unknown>>(schema: TSchema, input: Record<string, unknown>, urlKeys: readonly string[] = []): T {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Form module properties must be an object')
  const source = input
  const routePath = typeof source.routePath === 'string' ? source.routePath : '/'
  const localized = localizeRenderProps(source, languageFromPath(routePath), urlKeys)
  const defaulted: unknown = Value.Default(schema, localized)
  if (!Value.Check(schema, defaulted)) throw new Error('Invalid form module properties')
  const parsed: unknown = Value.Parse(schema, defaulted)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Form module properties must resolve to an object')
  return parsed as T
}

function normalizeIdentifierValue(value: string, fallback = ''): string {
  const normalized = value.replace(/\s+/g, '-').replace(/[^A-Za-z0-9_-]/g, '').replace(/-+/g, '-').replace(/^[-_]+/, '').replace(/[-_]+$/, '')
  return normalized || fallback
}

function attrs(values: Array<[string, string | number | null | undefined]>): string {
  return values.filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([name, value]) => ` ${name}="${String(value)}"`).join('')
}

function booleanAttrs(props: Record<string, unknown>, names: string[]): string {
  return names.filter((name) => Boolean(props[name]))
    .map((name) => name === 'readOnly' ? ' readonly' : ` ${name}`).join('')
}

function positiveNumber(value: number): number | undefined { return value > 0 ? value : undefined }

function inputSchema(typeLabel: string): PluginPropertySchema {
  return {
    inputType: { type: 'select', label: typeLabel, options: ['text', 'email', 'password', 'search', 'tel', 'url', 'number', 'range', 'date', 'time', 'datetime-local', 'file', 'hidden'].map((value) => ({ label: value, value })) },
    ...formBehaviorControls,
    fieldId: { type: 'text', label: 'Field ID' },
    name: { type: 'text', label: 'Name' },
    id: { type: 'text', label: 'ID' },
    placeholder: { type: 'text', label: 'Placeholder' },
    value: { type: 'text', label: 'Default value' },
    required: { type: 'toggle', label: 'Required' },
    disabled: { type: 'toggle', label: 'Disabled' },
    readOnly: { type: 'toggle', label: 'Read-only' },
    autocomplete: { type: 'text', label: 'Autocomplete' },
    min: { type: 'text', label: 'Min' },
    max: { type: 'text', label: 'Max' },
    step: { type: 'text', label: 'Step' },
    minLength: { type: 'number', label: 'Minimum length' },
    maxLength: { type: 'number', label: 'Maximum length' },
    pattern: { type: 'text', label: 'Pattern' },
  }
}

const FormModule: PluginModuleDefinition = {
  id: 'netsons.site.form', name: 'Form', description: 'A CMS, request, local, or custom HTML form.',
  category: 'Forms', version: '1.0.0', canHaveChildren: true, htmlTag: 'form',
  propsSchema: FormPropsSchema, defaults: moduleDefaults(FormPropsSchema),
  schema: {
    mode: { type: 'select', label: 'Mode', options: [{ label: 'CMS', value: 'cms' }, { label: 'HTML action', value: 'custom' }, { label: 'HTTP request', value: 'request' }, { label: 'Local interaction', value: 'local' }] },
    formId: { type: 'text', label: 'Form ID' },
    submitTargetId: { type: 'text', label: 'Submit scroll and focus target ID' },
    fragmentField: { type: 'text', label: 'Initial selection from URL fragment' },
    stateQueryParameter: { type: 'text', label: 'Result state query parameter' },
    targetTableId: { type: 'text', label: 'Target data table ID' },
    action: { type: 'url', label: 'Action URL' },
    enhance: { type: 'toggle', label: 'Enable form behavior' },
    encoding: { type: 'select', label: 'Request encoding', options: [{ label: 'Multipart form', value: 'multipart' }, { label: 'JSON', value: 'json' }] },
    responseSuccessField: { type: 'text', label: 'Response success field' },
    responseMessageField: { type: 'text', label: 'Response message field' },
    resetOnSuccess: { type: 'toggle', label: 'Reset after success' },
    pendingMessage: { type: 'text', label: 'Pending message' },
    errorMessage: { type: 'text', label: 'Error message' },
    invalidMessage: { type: 'text', label: 'Invalid values message' },
    captchaMessage: { type: 'text', label: 'Verification message' },
    unavailableMessage: { type: 'text', label: 'Unavailable form message' },
    method: { type: 'select', label: 'Method', options: [{ label: 'GET', value: 'get' }, { label: 'POST', value: 'post' }, { label: 'Dialog', value: 'dialog' }] },
    successBehavior: { type: 'select', label: 'Success behavior', options: [{ label: 'Show message', value: 'message' }, { label: 'Redirect', value: 'redirect' }] },
    successMessage: { type: 'text', label: 'Success message' },
    redirectUrl: { type: 'url', label: 'Redirect URL' },
    honeypotName: { type: 'text', label: 'Honeypot field' },
    minSubmitSeconds: { type: 'number', label: 'Minimum fill seconds' },
  },
  render(rawProps, children) {
    const props = normalizeProps<FormProps>(FormPropsSchema, rawProps, ['action', 'redirectUrl'])
    const formId = normalizeIdentifierValue(props.formId, 'form')
    const method = props.mode === 'request' ? 'post' : props.method
    const attrsText = [
      `data-instatic-form-id="${formId}"`,
      `data-instatic-form-mode="${props.mode}"`,
      props.mode === 'cms' ? `data-instatic-target-table="${props.targetTableId}"` : '',
      ['custom', 'request'].includes(props.mode) ? `action="${safeUrl(props.action)}"` : '',
      ['custom', 'request'].includes(props.mode) ? `method="${method}"` : '',
      props.mode === 'local' && props.submitTargetId ? `data-instatic-submit-target-id="${normalizeIdentifierValue(props.submitTargetId)}"` : '',
      props.mode === 'local' && props.fragmentField ? `data-instatic-fragment-field="${props.fragmentField}"` : '',
      props.stateQueryParameter ? `data-instatic-state-query-parameter="${props.stateQueryParameter}"` : '',
      props.mode === 'request' && props.encoding === 'multipart' ? 'enctype="multipart/form-data"' : '',
      `data-instatic-form-enhanced="${props.enhance}"`,
      Object.keys(props.calculations).length ? `data-instatic-form-calculations="${escapeHtml(JSON.stringify(props.calculations))}"` : '',
      `data-instatic-encoding="${props.encoding}"`,
      `data-instatic-response-success-field="${props.responseSuccessField}"`,
      `data-instatic-response-message-field="${props.responseMessageField}"`,
      `data-instatic-reset-on-success="${props.resetOnSuccess}"`,
      `data-instatic-pending-message="${props.pendingMessage}"`,
      `data-instatic-error-message="${props.errorMessage}"`,
      `data-instatic-invalid-message="${props.invalidMessage}"`,
      `data-instatic-captcha-message="${props.captchaMessage}"`,
      `data-instatic-unavailable-message="${props.unavailableMessage}"`,
      props.successBehavior === 'message' ? `data-instatic-success-message="${props.successMessage}"` : '',
      props.successBehavior === 'redirect' ? `data-instatic-success-redirect="${safeUrl(props.redirectUrl)}"` : '',
    ].filter(Boolean).join(' ')
    const attrsWithAuthored = htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.form'])
    const honeypot = props.mode === 'cms' ? `<input type="text" name="${props.honeypotName}" autocomplete="off" tabindex="-1" data-instatic-honeypot hidden>` : ''
    const rendered = renderInitialFormHtml(props, `${honeypot}${children.join('')}`)
    return { html: `<form ${attrsText}${attrsWithAuthored}>${rendered}</form>` }
  },
}

const LabelModule: PluginModuleDefinition = {
  id: 'netsons.site.label', name: 'Label', description: 'A label for a form control.',
  category: 'Forms', version: '1.0.0', canHaveChildren: false, htmlTag: 'label',
  propsSchema: LabelPropsSchema, defaults: moduleDefaults(LabelPropsSchema),
  schema: { text: { type: 'text', label: 'Text' }, targetMode: { type: 'select', label: 'Target', options: [{ label: 'Auto', value: 'auto' }, { label: 'Explicit', value: 'explicit' }] }, targetId: { type: 'text', label: 'Target ID' } },
  render(rawProps) {
    const props = normalizeProps<Static<typeof LabelPropsSchema>>(LabelPropsSchema, rawProps)
    return { html: props.targetMode === 'explicit' && props.targetId ? `<label for="${props.targetId}">${props.text}</label>` : `<label data-instatic-label-target="auto">${props.text}</label>` }
  },
}

const InputModule: PluginModuleDefinition = {
  id: 'netsons.site.input', name: 'Input', description: 'A single-line form input.', category: 'Forms', version: '1.0.0', canHaveChildren: false, htmlTag: 'input',
  propsSchema: InputPropsSchema, defaults: moduleDefaults(InputPropsSchema), schema: inputSchema('Input type'),
  render(rawProps) {
    const props = normalizeProps<InputProps>(InputPropsSchema, rawProps)
    return { html: `<input${attrs([
      ['data-instatic-form-control', 'input'], ['data-instatic-field-id', props.fieldId], ['type', props.inputType],
      ['name', props.name || props.fieldId], ['id', props.id], ['placeholder', props.placeholder], ['value', props.value],
      ['autocomplete', props.autocomplete], ['min', props.min], ['max', props.max], ['step', props.step],
      ['minlength', positiveNumber(props.minLength)], ['maxlength', positiveNumber(props.maxLength)], ['pattern', props.pattern],
    ])}${booleanAttrs(props, ['required', 'disabled', 'readOnly'])}${controlBehaviorAttrs(props)}${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.input'])}>` }
  },
}

const TextareaModule: PluginModuleDefinition = {
  id: 'netsons.site.textarea', name: 'Textarea', description: 'A multi-line form input.', category: 'Forms', version: '1.0.0', canHaveChildren: false, htmlTag: 'textarea',
  propsSchema: TextareaPropsSchema, defaults: moduleDefaults(TextareaPropsSchema),
  schema: { ...formBehaviorControls, fieldId: { type: 'text', label: 'Field ID' }, name: { type: 'text', label: 'Name' }, id: { type: 'text', label: 'ID' }, placeholder: { type: 'text', label: 'Placeholder' }, value: { type: 'textarea', label: 'Default value' }, required: { type: 'toggle', label: 'Required' }, disabled: { type: 'toggle', label: 'Disabled' }, readOnly: { type: 'toggle', label: 'Read-only' }, rows: { type: 'number', label: 'Rows' }, minLength: { type: 'number', label: 'Minimum length' }, maxLength: { type: 'number', label: 'Maximum length' } },
  render(rawProps) {
    const props = normalizeProps<TextareaProps>(TextareaPropsSchema, rawProps)
    return { html: `<textarea${attrs([['data-instatic-form-control', 'textarea'], ['data-instatic-field-id', props.fieldId], ['name', props.name || props.fieldId], ['id', props.id], ['placeholder', props.placeholder], ['rows', props.rows], ['minlength', positiveNumber(props.minLength)], ['maxlength', positiveNumber(props.maxLength)]])}${booleanAttrs(props, ['required', 'disabled', 'readOnly'])}${controlBehaviorAttrs(props)}${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.textarea'])}>${props.value}</textarea>` }
  },
}

const SelectModule: PluginModuleDefinition = {
  id: 'netsons.site.select', name: 'Select', description: 'A select menu.', category: 'Forms', version: '1.0.0', canHaveChildren: true, htmlTag: 'select',
  propsSchema: SelectPropsSchema, defaults: moduleDefaults(SelectPropsSchema),
  schema: { ...formBehaviorControls, fieldId: { type: 'text', label: 'Field ID' }, name: { type: 'text', label: 'Name' }, id: { type: 'text', label: 'ID' }, required: { type: 'toggle', label: 'Required' }, disabled: { type: 'toggle', label: 'Disabled' }, multiple: { type: 'toggle', label: 'Multiple' } },
  render(rawProps, children) {
    const props = normalizeProps<SelectProps>(SelectPropsSchema, rawProps)
    return { html: `<select${attrs([['data-instatic-form-control', 'select'], ['data-instatic-field-id', props.fieldId], ['name', props.name || props.fieldId], ['id', props.id]])}${booleanAttrs(props, ['required', 'disabled', 'multiple'])}${controlBehaviorAttrs(props)}${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.select'])}>${children.join('')}</select>` }
  },
}

const OptionModule: PluginModuleDefinition = {
  id: 'netsons.site.option', name: 'Option', description: 'An option inside a select.', category: 'Forms', version: '1.0.0', canHaveChildren: false, htmlTag: 'option',
  propsSchema: OptionPropsSchema, defaults: moduleDefaults(OptionPropsSchema),
  schema: { value: { type: 'text', label: 'Value' }, label: { type: 'text', label: 'Label' }, selected: { type: 'toggle', label: 'Selected' }, disabled: { type: 'toggle', label: 'Disabled' } },
  render(rawProps) {
    const props = normalizeProps<Static<typeof OptionPropsSchema>>(OptionPropsSchema, rawProps)
    return { html: `<option value="${props.value}"${booleanAttrs(props, ['selected', 'disabled'])}>${props.label}</option>` }
  },
}

const OptionGroupModule: PluginModuleDefinition = {
  id: 'netsons.site.option-group', name: 'Option group', description: 'A group of select options.', category: 'Forms', version: '1.0.0', canHaveChildren: true, htmlTag: 'optgroup',
  propsSchema: OptionGroupPropsSchema, defaults: moduleDefaults(OptionGroupPropsSchema),
  schema: { label: { type: 'text', label: 'Label' }, disabled: { type: 'toggle', label: 'Disabled' } },
  render(rawProps, children) {
    const props = normalizeProps<Static<typeof OptionGroupPropsSchema>>(OptionGroupPropsSchema, rawProps)
    return { html: `<optgroup${attrs([['label', props.label]])}${booleanAttrs(props, ['disabled'])}>${children.join('')}</optgroup>` }
  },
}

function choiceModule(args: { id: 'netsons.site.checkbox' | 'netsons.site.radio'; name: string; inputType: 'checkbox' | 'radio' }): PluginModuleDefinition {
  const checkbox = args.inputType === 'checkbox'
  return {
    id: args.id, name: args.name, description: `A ${args.inputType} form control.`, category: 'Forms', version: '1.0.0', canHaveChildren: false, htmlTag: 'input',
    propsSchema: ChoicePropsSchema, defaults: moduleDefaults(ChoicePropsSchema),
    schema: { ...formBehaviorControls, fieldId: { type: 'text', label: 'Field ID' }, name: { type: 'text', label: 'Name' }, id: { type: 'text', label: 'ID' }, value: { type: 'text', label: 'Value' }, checked: { type: 'toggle', label: 'Checked' }, required: { type: 'toggle', label: 'Required' }, disabled: { type: 'toggle', label: 'Disabled' }, ...(checkbox ? { minSelected: { type: 'number', label: 'Minimum selected', min: 0 }, maxSelected: { type: 'number', label: 'Maximum selected (0 is unlimited)', min: 0 }, selectionOverflow: { type: 'select', label: 'When selection is full', options: [{ value: 'reject', label: 'Keep current selection' }, { value: 'drop-oldest', label: 'Remove oldest selection' }] } } : {}) },
    render(rawProps) {
      const props = normalizeProps<ChoiceProps>(ChoicePropsSchema, rawProps)
      return { html: `<input${attrs([['type', args.inputType], ['data-instatic-form-control', args.inputType], ['data-instatic-field-id', props.fieldId], ['name', props.name || props.fieldId], ['id', props.id], ['value', props.value]])}${booleanAttrs(props, ['checked', 'required', 'disabled'])}${controlBehaviorAttrs(props)}${checkbox ? ` data-instatic-choice-min-selected="${props.minSelected}" data-instatic-choice-max-selected="${props.maxSelected}" data-instatic-choice-overflow="${props.selectionOverflow}"` : ''}${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES[checkbox ? 'base.checkbox' : 'base.radio'])}>` }
    },
  }
}

const SubmitModule: PluginModuleDefinition = {
  id: 'netsons.site.submit', name: 'Submit', description: 'A submit button.', category: 'Forms', version: '1.0.0', canHaveChildren: true, htmlTag: 'button',
  propsSchema: SubmitPropsSchema, defaults: moduleDefaults(SubmitPropsSchema),
  schema: { label: { type: 'text', label: 'Label', placeholder: 'Displayed when no children' }, pendingLabel: { type: 'text', label: 'Pending label' }, disabled: { type: 'toggle', label: 'Disabled' }, formId: { type: 'text', label: 'Form ID override' } },
  render(rawProps, children) {
    const props = normalizeProps<SubmitProps>(SubmitPropsSchema, rawProps)
    return { html: `<button type="submit"${attrs([['form', normalizeIdentifierValue(props.formId)], ['data-instatic-pending-label', props.pendingLabel]])}${booleanAttrs(props, ['disabled'])}${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.submit'])}>${submitUsesChildren(children.length) ? children.join('') : props.label}</button>` }
  },
}

const FormMessageModule: PluginModuleDefinition = {
  id: 'netsons.site.form-message', name: 'Form message', description: 'A status, success, or error message for a form.', category: 'Forms', version: '1.0.0', canHaveChildren: true, htmlTag: 'div',
  propsSchema: FormMessagePropsSchema, defaults: moduleDefaults(FormMessagePropsSchema),
  schema: { formId: { type: 'text', label: 'Form ID' }, kind: { type: 'select', label: 'Kind', options: [{ label: 'Status', value: 'status' }, { label: 'Success', value: 'success' }, { label: 'Error', value: 'error' }] }, source: { type: 'select', label: 'Text source', options: [{ label: 'Form state message', value: 'state' }, { label: 'Authored copy', value: 'authored' }, { label: 'Server response message', value: 'response' }, { label: 'Server response or form state', value: 'responseOrState' }] }, text: { type: 'text', label: 'Text' }, tag: { type: 'select', label: 'Tag', options: ['div', 'p', 'output', 'span'].map((value) => ({ label: value, value })) }, customTag: { type: 'text', label: 'Custom tag' } },
  render(rawProps, children) {
    const props = normalizeProps<FormMessageProps>(FormMessagePropsSchema, rawProps)
    const tag = resolveHtmlTag(props.tag, props.customTag)
    return { html: `<${tag} data-instatic-form-message="${props.kind}" data-instatic-message-source="${props.source}" data-instatic-form-id="${normalizeIdentifierValue(props.formId)}" role="${props.kind === 'error' ? 'alert' : 'status'}" hidden${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.form-message'])}>${children.length ? children.join('') : props.text}</${tag}>` }
  },
}

const FormConditionalModule: PluginModuleDefinition = {
  id: 'netsons.site.form-conditional', name: 'Form condition', description: 'Show a group when control values match a declared condition.', category: 'Forms', version: '1.0.0', canHaveChildren: true, htmlTag: 'div',
  propsSchema: ConditionalPropsSchema, defaults: moduleDefaults(ConditionalPropsSchema),
  schema: { disableWhenHidden: { type: 'toggle', label: 'Disable controls while hidden' } },
  render(rawProps, children) {
    const props = normalizeProps<ConditionalProps>(ConditionalPropsSchema, rawProps)
    return { html: `<div data-instatic-form-condition="${escapeHtml(JSON.stringify(props.condition))}" data-instatic-disable-when-hidden="${props.disableWhenHidden !== false}">${children.join('')}</div>` }
  },
}

const FormOutputModule: PluginModuleDefinition = {
  id: 'netsons.site.form-output', name: 'Form value', description: 'Display a named control value as plain text.', category: 'Forms', version: '1.0.0', canHaveChildren: true, htmlTag: 'output',
  propsSchema: OutputPropsSchema, defaults: moduleDefaults(OutputPropsSchema),
  schema: { fieldName: { type: 'text', label: 'Value name' }, text: { type: 'text', label: 'Initial text' }, cssVariable: { type: 'text', label: 'Numeric CSS custom property' }, tag: { type: 'select', label: 'Tag', options: ['div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'ul', 'ol', 'custom'].map((value) => ({ label: value, value })) }, customTag: { type: 'text', label: 'Custom tag' } },
  render(rawProps, children) {
    const props = normalizeProps<OutputProps>(OutputPropsSchema, rawProps)
    const tag = resolveHtmlTag(props.tag, props.customTag)
    return { html: `<${tag} data-instatic-form-output="${props.fieldName}"${props.cssVariable ? ` data-instatic-form-css-variable="${props.cssVariable}" style="${props.cssVariable}:${Number(props.text)}"` : ''}${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.form-output'])}>${children.length ? children.join('') : props.cssVariable ? '' : props.text}</${tag}>` }
  },
}

const FormLinkModule: PluginModuleDefinition = {
  id: 'netsons.site.form-link', name: 'Form link', description: 'A semantic anchor reading a form value or expression.', category: 'Forms', version: '1.0.0', canHaveChildren: true, htmlTag: 'a',
  propsSchema: FormLinkPropsSchema, defaults: moduleDefaults(FormLinkPropsSchema),
  schema: { valueField: { type: 'text', label: 'URL value name' }, formId: { type: 'text', label: 'Form ID (outside form)' }, href: { type: 'url', label: 'Initial URL' }, text: { type: 'text', label: 'Link text' }, target: { type: 'select', label: 'Open in', options: [{ label: 'Same tab', value: '_self' }, { label: 'New tab', value: '_blank' }] } },
  render(rawProps, children) {
    const props = normalizeProps<FormLinkProps>(FormLinkPropsSchema, rawProps, ['href'])
    const rel = props.target === '_blank' ? ' rel="noopener noreferrer"' : ''
    return { html: `<a href="${safeUrl(props.href)}" data-instatic-form-link="${props.valueField}"${props.formId ? ` data-instatic-form-id="${normalizeIdentifierValue(props.formId, 'form')}"` : ''}${props.expression ? ` data-instatic-form-expression="${escapeHtml(JSON.stringify(props.expression))}"` : ''} target="${props.target}"${rel}${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.form-link'])}>${children.length ? children.join('') : props.text}</a>` }
  },
}

const FormStepModule: PluginModuleDefinition = {
  id: 'netsons.site.form-step', name: 'Form step', description: 'Increment a numeric input within its declared bounds.', category: 'Forms', version: '1.0.0', canHaveChildren: true, htmlTag: 'button',
  propsSchema: FormStepPropsSchema, defaults: moduleDefaults(FormStepPropsSchema),
  schema: { fieldName: { type: 'text', label: 'Control name' }, step: { type: 'number', label: 'Increment' }, label: { type: 'text', label: 'Button label' } },
  render(rawProps, children) {
    const props = normalizeProps<FormStepProps>(FormStepPropsSchema, rawProps)
    return { html: `<button type="button" data-instatic-form-step="${props.fieldName}" data-instatic-step-amount="${props.step}"${props.disabledWhen ? ` data-instatic-step-disabled-when="${escapeHtml(JSON.stringify(props.disabledWhen))}"` : ''}${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.form-step'])}>${children.length ? children.join('') : props.label}</button>` }
  },
}

type TurnstileProps = Static<typeof TurnstilePropsSchema>
const TurnstileModule: PluginModuleDefinition = {
  id: 'netsons.site.turnstile', name: 'Turnstile', description: 'A verification widget for a form whose recipient verifies the token.', category: 'Forms', version: '1.0.0', canHaveChildren: false, htmlTag: 'div',
  propsSchema: TurnstilePropsSchema, defaults: moduleDefaults(TurnstilePropsSchema),
  schema: { siteKey: { type: 'text', label: 'Public site key' }, action: { type: 'text', label: 'Action' }, language: { type: 'select', label: 'Language', options: TURNSTILE_LANGUAGES.map((value) => ({ value, label: value })) }, theme: { type: 'select', label: 'Theme', options: ['auto', 'light', 'dark'].map((value) => ({ value, label: value })) }, responseFieldName: { type: 'text', label: 'Response field name' } },
  render(rawProps) {
    const props = normalizeProps<TurnstileProps>(TurnstilePropsSchema, rawProps)
    return { html: `<div data-instatic-turnstile data-instatic-site-key="${props.siteKey}" data-instatic-captcha-action="${props.action}" data-instatic-captcha-language="${props.language}" data-instatic-captcha-theme="${props.theme}" data-instatic-captcha-field="${props.responseFieldName}"></div>` }
  },
}

export const formsModules: PluginModuleDefinition[] = [
  FormModule,
  LabelModule,
  InputModule,
  TextareaModule,
  SelectModule,
  OptionModule,
  OptionGroupModule,
  choiceModule({ id: 'netsons.site.checkbox', name: 'Checkbox', inputType: 'checkbox' }),
  choiceModule({ id: 'netsons.site.radio', name: 'Radio', inputType: 'radio' }),
  SubmitModule,
  FormMessageModule,
  FormConditionalModule,
  FormOutputModule,
  FormLinkModule,
  FormStepModule,
  TurnstileModule,
]

export const FORMS_CSS = '[data-instatic-form-condition][hidden], [data-instatic-form-message][hidden]{display:none}'
export const FORMS_RUNTIME_ENTRY = 'src/forms/runtimeEntry.ts'
export default formsModules
