import type { ModuleDefinition } from '@core/module-engine'
import { TurnstileConfigurationSchema, TURNSTILE_LANGUAGES } from '@core/forms-schema'
import { Value, type Static } from '@core/utils/typeboxHelpers'
import { escapeHtml, htmlAttributesAttr } from '@core/publisher'
import { MODULE_GENERATED_ATTRIBUTE_NAMES, resolveHtmlTag } from '@core/htmlAttributes'
import { htmlTagControl, customHtmlTagControl } from '@modules/base/utils/htmlTag'
import { htmlAttributesControl } from '@modules/base/shared/htmlAttributes'
import { ConditionalPropsSchema, OutputPropsSchema, FormLinkPropsSchema, FormStepPropsSchema } from './behaviorSchemas'
import { ConditionalEditor, OutputEditor, FormLinkEditor, FormStepEditor, TurnstileEditor } from './FormControls'
import { safeUrl } from '@modules/base/utils/escape'
import { normalizeIdentifierValue } from '@core/utils/identifier'
import { FileTextSolidIcon } from 'pixel-art-icons/icons/file-text-solid'

type ConditionalProps = Static<typeof ConditionalPropsSchema>
type OutputProps = Static<typeof OutputPropsSchema>

export const FormConditionalModule: ModuleDefinition<ConditionalProps> = {
  id: 'base.form-conditional', name: 'Form condition', category: 'Forms', version: '1.0.0',
  description: 'Show a group when control values match a declared condition.',
  icon: FileTextSolidIcon, trusted: true, canHaveChildren: true, htmlTag: 'div',
  schema: { condition: { type: 'condition', label: 'Visible when', category: 'layout' }, disableWhenHidden: { type: 'toggle', label: 'Disable controls while hidden', category: 'layout' } },
  propsSchema: ConditionalPropsSchema, defaults: Value.Create(ConditionalPropsSchema), component: ConditionalEditor,
  assets: { css: '[data-instatic-form-condition][hidden]{display:none}' },
  render: (props, children) => ({
    html: `<div data-instatic-form-condition="${escapeHtml(JSON.stringify(props.condition))}" data-instatic-disable-when-hidden="${props.disableWhenHidden !== false}"${'_formConditionVisible' in props && props._formConditionVisible === false ? ' hidden' : ''}>${children.join('')}</div>`,
  }),
}

export const FormOutputModule: ModuleDefinition<OutputProps> = {
  id: 'base.form-output', name: 'Form value', category: 'Forms', version: '1.0.0',
  description: 'Display a named control value as plain text.',
  icon: FileTextSolidIcon, trusted: true, canHaveChildren: true, htmlTag: (props) => resolveHtmlTag(props.tag, props.customTag),
  schema: { fieldName: { type: 'text', label: 'Value name', category: 'layout' }, text: { type: 'text', label: 'Initial text' }, cssVariable: { type: 'text', label: 'Numeric CSS custom property', category: 'layout' }, tag: htmlTagControl(), customTag: customHtmlTagControl(), htmlAttributes: htmlAttributesControl() },
  propsSchema: OutputPropsSchema, defaults: Value.Create(OutputPropsSchema), component: OutputEditor,
  render: (props, children) => {
    const tag = resolveHtmlTag(props.tag, props.customTag)
    return { html: `<${tag} data-instatic-form-output="${props.fieldName}"${props.cssVariable ? ` data-instatic-form-css-variable="${props.cssVariable}" style="${props.cssVariable}:${Number(props.text)}"` : ''}${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.form-output'])}>${children.length ? children.join('') : props.cssVariable ? '' : props.text}</${tag}>` }
  },
}

export const FormStepModule: ModuleDefinition<Static<typeof FormStepPropsSchema>> = {
  id: 'base.form-step', name: 'Form step', category: 'Forms', version: '1.0.0',
  description: 'Increment or decrement a numeric input within its declared bounds.',
  icon: FileTextSolidIcon, trusted: true, canHaveChildren: true, htmlTag: 'button',
  schema: { fieldName: { type: 'text', label: 'Control name', category: 'layout' }, step: { type: 'number', label: 'Increment', category: 'layout' }, label: { type: 'text', label: 'Button label' }, disabledWhen: { type: 'condition', label: 'Disabled when', category: 'layout' }, htmlAttributes: htmlAttributesControl() },
  propsSchema: FormStepPropsSchema, defaults: Value.Create(FormStepPropsSchema), component: FormStepEditor,
  render: (props, children) => ({ html: `<button type="button" data-instatic-form-step="${props.fieldName}" data-instatic-step-amount="${props.step}"${props.disabledWhen ? ` data-instatic-step-disabled-when="${escapeHtml(JSON.stringify(props.disabledWhen))}"` : ''}${'_formStepDisabled' in props && props._formStepDisabled === true ? ' disabled' : ''}${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.form-step'])}>${children.length ? children.join('') : props.label}</button>` }),
}

export const FormLinkModule: ModuleDefinition<Static<typeof FormLinkPropsSchema>> = {
  id: 'base.form-link', name: 'Form link', category: 'Forms', version: '1.0.0',
  description: 'A semantic link whose URL follows a declared form value.',
  icon: FileTextSolidIcon, trusted: true, canHaveChildren: true, htmlTag: 'a',
  schema: { valueField: { type: 'text', label: 'URL value name', category: 'layout' }, expression: { type: 'expressions', mode: 'single', label: 'URL expression', category: 'layout' }, formId: { type: 'text', label: 'Form ID (outside form)', normalize: 'identifier', category: 'layout' }, href: { type: 'url', label: 'Initial URL' }, text: { type: 'text', label: 'Link text' }, target: { type: 'select', label: 'Open in', options: [{ value: '_self', label: 'Same tab' }, { value: '_blank', label: 'New tab' }] }, htmlAttributes: htmlAttributesControl() },
  propsSchema: FormLinkPropsSchema, defaults: Value.Create(FormLinkPropsSchema), component: FormLinkEditor,
  render: (props, children) => ({ html: `<a href="${safeUrl(props.href)}" data-instatic-form-link="${props.valueField}"${props.formId ? ` data-instatic-form-id="${normalizeIdentifierValue(props.formId, 'form')}"` : ''}${props.expression ? ` data-instatic-form-expression="${escapeHtml(JSON.stringify(props.expression))}"` : ''} target="${props.target}"${props.target === '_blank' ? ' rel="noopener noreferrer"' : ''}${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.form-link'])}>${children.length ? children.join('') : props.text}</a>` }),
}

type TurnstileProps = Static<typeof TurnstileConfigurationSchema>
export const TurnstileModule: ModuleDefinition<TurnstileProps> = {
  id: 'base.turnstile', name: 'Turnstile', category: 'Forms', version: '1.0.0',
  description: 'A verification widget for a form whose recipient verifies the token.',
  icon: FileTextSolidIcon, trusted: true, canHaveChildren: false, htmlTag: 'div',
  schema: {
    siteKey: { type: 'text', label: 'Public site key', category: 'layout' },
    action: { type: 'text', label: 'Action', category: 'layout' },
    language: { type: 'select', label: 'Language', options: TURNSTILE_LANGUAGES.map((value) => ({ value, label: value })) },
    theme: { type: 'select', label: 'Theme', options: ['auto', 'light', 'dark'].map((value) => ({ label: value, value })) },
    responseFieldName: { type: 'text', label: 'Response field name', category: 'layout' },
  },
  propsSchema: TurnstileConfigurationSchema,
  defaults: { siteKey: '', action: '', language: 'auto', theme: 'auto', responseFieldName: 'cf-turnstile-response' },
  component: TurnstileEditor,
  render: (props) => ({
    html: `<div data-instatic-turnstile data-instatic-site-key="${props.siteKey}" data-instatic-captcha-action="${props.action}" data-instatic-captcha-language="${props.language}" data-instatic-captcha-theme="${props.theme}" data-instatic-captcha-field="${props.responseFieldName}"></div>`,
    cspSources: [
      { directive: 'script-src', sources: ['https://challenges.cloudflare.com'] },
      { directive: 'frame-src', sources: ['https://challenges.cloudflare.com'] },
    ],
  }),
}
