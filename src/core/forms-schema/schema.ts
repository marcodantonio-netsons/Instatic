import { Type, type Static } from '@sinclair/typebox'
import { PropertyConditionSchema } from '@core/value-conditions-schema'
import { FormCalculationsSchema } from './calculations'

export const OptionalFormConditionSchema = Type.Union([PropertyConditionSchema, Type.Null()], { default: null })

/** Shared declarative wiring. Copy remains ordinary, publisher-resolved props. */
export const FormControlBehaviorProperties = {
  requiredWhen: OptionalFormConditionSchema,
  disabledWhen: OptionalFormConditionSchema,
  minValueField: Type.String({ default: '' }),
  maxValueField: Type.String({ default: '' }),
  clearFieldsOnChange: Type.String({ default: '' }),
  queryParameter: Type.String({ default: '' }),
  queryOverflow: Type.Union([Type.Literal('reject'), Type.Literal('truncate')], { default: 'reject' }),
  trimOnSubmit: Type.Boolean({ default: false }),
  submitOnChange: Type.Boolean({ default: false }),
  lockQueryValue: Type.Boolean({ default: false }),
  resetBehavior: Type.Union([Type.Literal('initial'), Type.Literal('clear'), Type.Literal('preserve')], { default: 'initial' }),
  valueSourceField: Type.String({ default: '' }),
  valueTargetField: Type.String({ default: '' }),
  syncGroup: Type.String({ default: '' }),
  requiredMessage: Type.String({ default: '' }),
  invalidMessage: Type.String({ default: '' }),
}

export const FormControlBehaviorSchema = Type.Object({
  ...FormControlBehaviorProperties,
  required: Type.Boolean({ default: false }),
  disabled: Type.Boolean({ default: false }),
}, { additionalProperties: false })

export type FormControlBehavior = Static<typeof FormControlBehaviorSchema>

export const CheckboxGroupProperties = {
  minSelected: Type.Integer({ default: 0, minimum: 0 }),
  maxSelected: Type.Integer({ default: 0, minimum: 0 }),
  selectionOverflow: Type.Union([Type.Literal('reject'), Type.Literal('drop-oldest')], { default: 'reject' }),
}
export const CheckboxGroupSchema = Type.Object(CheckboxGroupProperties, { additionalProperties: false })

export const FormTransportSchema = Type.Object({
  mode: Type.Union([Type.Literal('cms'), Type.Literal('custom'), Type.Literal('request'), Type.Literal('local')]),
  action: Type.String(),
  encoding: Type.Union([Type.Literal('multipart'), Type.Literal('json')]),
  responseSuccessField: Type.String({ minLength: 1 }),
  responseMessageField: Type.String({ minLength: 1 }),
  resetOnSuccess: Type.Boolean(),
}, { additionalProperties: false })

export type FormTransport = Static<typeof FormTransportSchema>

/** Codes documented by Cloudflare; reject typos instead of the provider's language fallback. */
export const TURNSTILE_LANGUAGES = ['auto', 'ar-eg', 'ar', 'bg-bg', 'bg', 'zh-cn', 'zh', 'zh-tw', 'hr-hr', 'hr', 'cs-cz', 'cs', 'da-dk', 'da', 'nl-nl', 'nl', 'en-us', 'en', 'fa-ir', 'fa', 'fi-fi', 'fi', 'fr-fr', 'fr', 'de-de', 'de', 'el-gr', 'el', 'he-il', 'he', 'hi-in', 'hi', 'hu-hu', 'hu', 'id-id', 'id', 'it-it', 'it', 'ja-jp', 'ja', 'tlh', 'ko-kr', 'ko', 'lt-lt', 'lt', 'ms-my', 'ms', 'nb-no', 'nb', 'pl-pl', 'pl', 'pt-br', 'pt', 'ro-ro', 'ro', 'ru-ru', 'ru', 'sr-ba', 'sr', 'sk-sk', 'sk', 'sl-si', 'sl', 'es-es', 'es', 'sv-se', 'sv', 'tl-ph', 'tl', 'th-th', 'th', 'tr-tr', 'tr', 'uk-ua', 'uk', 'vi-vn', 'vi'] as const
export const TurnstileConfigurationSchema = Type.Object({
  siteKey: Type.String({ default: '' }),
  action: Type.String(),
  language: Type.Union(TURNSTILE_LANGUAGES.map((language) => Type.Literal(language)), { default: 'auto' }),
  theme: Type.Union([Type.Literal('auto'), Type.Literal('light'), Type.Literal('dark')]),
  responseFieldName: Type.String({ minLength: 1 }),
}, { additionalProperties: false })

export type TurnstileConfiguration = Static<typeof TurnstileConfigurationSchema>

export const FormChallengeResponseSchema = Type.Object({
  token: Type.String({ minLength: 1 }),
  challenge: Type.String({ minLength: 1 }),
  expiresAt: Type.String({ minLength: 1 }),
})

export type FormChallengeResponse = Static<typeof FormChallengeResponseSchema>

export const FormJsonResponseSchema = Type.Record(Type.String(), Type.Unknown())
export const FormValidationResponseSchema = Type.Object({
  errors: Type.Array(Type.Object({ fieldId: Type.String(), code: Type.String(), message: Type.String() })),
})
export type FormValidationResponse = Static<typeof FormValidationResponseSchema>
export const FormSuccessResponseSchema = Type.Object({ ok: Type.Literal(true), rowId: Type.String() })
export const FormResponseContractSchema = Type.Object({ success: Type.Boolean(), message: Type.Optional(Type.String()) })
export const TurnstileApiSchema = Type.Object({
  render: Type.Function([Type.Unknown(), Type.Record(Type.String(), Type.Unknown())], Type.String()),
  remove: Type.Function([Type.String()], Type.Void()),
  reset: Type.Function([Type.String()], Type.Void()),
  getResponse: Type.Function([Type.String()], Type.String()),
})
export type TurnstileApi = Static<typeof TurnstileApiSchema>

export const FormConfigurationProperties = {
  calculations: FormCalculationsSchema,
  mode: Type.Union([Type.Literal('cms'), Type.Literal('custom'), Type.Literal('request'), Type.Literal('local')], { default: 'cms' }),
  submitTargetId: Type.String({ default: '' }),
  fragmentField: Type.String({ default: '' }),
  stateQueryParameter: Type.String({ default: '' }),
  formId: Type.String({ default: 'form' }),
  enhance: Type.Boolean({ default: false }),
  encoding: Type.Union([Type.Literal('multipart'), Type.Literal('json')], { default: 'multipart' }),
  responseSuccessField: Type.String({ default: 'ok', minLength: 1 }),
  responseMessageField: Type.String({ default: 'message', minLength: 1 }),
  resetOnSuccess: Type.Boolean({ default: true }),
  pendingMessage: Type.String({ default: 'Sending...' }),
  errorMessage: Type.String({ default: 'Form submission failed. Please try again.' }),
  invalidMessage: Type.String({ default: 'Please check the form values.' }),
  captchaMessage: Type.String({ default: 'Complete the verification before submitting.' }),
  unavailableMessage: Type.String({ default: 'This form is unavailable. Please try again later.' }),
  targetTableId: Type.String({ default: '' }),
  action: Type.String({ default: '' }),
  method: Type.Union([Type.Literal('get'), Type.Literal('post'), Type.Literal('dialog')], { default: 'post' }),
  successBehavior: Type.Union([Type.Literal('message'), Type.Literal('redirect')], { default: 'message' }),
  successMessage: Type.String({ default: 'Thanks. Your submission was received.' }),
  redirectUrl: Type.String({ default: '' }),
  honeypotName: Type.String({ default: 'company' }),
  minSubmitSeconds: Type.Number({ default: 2 }),
}
export const FormConfigurationSchema = Type.Object(FormConfigurationProperties)
export type FormConfiguration = Static<typeof FormConfigurationSchema>
