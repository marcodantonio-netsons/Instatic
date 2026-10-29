import { evaluateCondition, PropertyConditionSchema } from '@core/module-engine-schema'
import { compiledCheck } from '@core/utils/typeboxCompiler'
import { FormValueExpressionSchema } from '@core/forms-schema'
import { evaluateFormExpression } from '@core/form-values'

export type FormRenderContext = { readonly values: Record<string, unknown>; readonly active: boolean }

/** Initial HTML follows the same declared conditions as the browser behavior. */
export function resolveFormRenderProps(moduleId: string, props: Record<string, unknown>, context: FormRenderContext | undefined) {
  if (!context) return { props, context }
  if (moduleId === 'base.form-conditional') {
    const active = context.active && (!compiledCheck(PropertyConditionSchema, props.condition) || evaluateCondition(props.condition, context.values))
    return { props: { ...props, _formConditionVisible: active }, context: { ...context, active: props.disableWhenHidden === false ? context.active : active } }
  }
  if (['base.input','base.textarea','base.select','base.checkbox','base.radio'].includes(moduleId)) {
    const required = compiledCheck(PropertyConditionSchema, props.requiredWhen) ? evaluateCondition(props.requiredWhen, context.values) : props.required === true
    const source = typeof props.valueSourceField === 'string' ? props.valueSourceField : ''
    const name = String(props.name || props.fieldId || '')
    const disabled = props.disabled === true || (compiledCheck(PropertyConditionSchema, props.disabledWhen) && evaluateCondition(props.disabledWhen, context.values))
    return { props: {
      ...props, _formOriginalRequired: props.required === true, _formOriginalDisabled: props.disabled === true,
      required: context.active && !disabled && required, disabled: !context.active || disabled,
      ...(props.minValueField ? { min: String(context.values[String(props.minValueField)]) } : {}),
      ...(props.maxValueField ? { max: String(context.values[String(props.maxValueField)]) } : {}),
      ...((props.minValueField || props.maxValueField) && Object.hasOwn(context.values, name) ? { value: String(context.values[name]) } : {}),
      ...(source ? { value: String(context.values[source] ?? '') } : {}),
    }, context }
  }
  if (moduleId === 'base.form-output' && typeof props.fieldName === 'string') return { props: { ...props, text: String(context.values[props.fieldName] ?? '') }, context }
  if (moduleId === 'base.form-link') return { props: { ...props, href: String(compiledCheck(FormValueExpressionSchema, props.expression) ? evaluateFormExpression(props.expression, context.values) : context.values[String(props.valueField)] ?? '') }, context }
  if (moduleId === 'base.form-step') return { props: { ...props, _formStepDisabled: compiledCheck(PropertyConditionSchema, props.disabledWhen) && evaluateCondition(props.disabledWhen, context.values) }, context }
  return { props, context }
}
