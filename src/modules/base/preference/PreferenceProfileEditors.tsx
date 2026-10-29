import { createElement } from 'react'
import type { ModuleComponentProps } from '@core/module-engine'
import { htmlAttributesForReact, MODULE_GENERATED_ATTRIBUTE_NAMES } from '@core/htmlAttributes'
import { useEditorStore } from '@site/store/store'
import { CanvasModulePlaceholder } from '@ui/components/CanvasModulePlaceholder'
import { compiledCheck } from '@core/utils/typeboxCompiler'
import { preferenceToggleData, preferenceOutputData, toggleProfilesAreValid } from './profileData'
import { PreferenceTogglePublishSchema, PreferenceOutputPublishSchema, type PreferenceToggleProps, type PreferenceOutputProps } from './profileProps'

export function PreferenceToggleEditor({ props, children, mcClassName, nodeWrapperProps }: ModuleComponentProps<PreferenceToggleProps>) {
  const settings = useEditorStore(state => state.site?.settings)
  if (!compiledCheck(PreferenceTogglePublishSchema, { props, settings }) || !toggleProfilesAreValid(props)) return <CanvasModulePlaceholder {...nodeWrapperProps} className={mcClassName} label="Configure visitor defaults, matching preference names and different authored profiles before publishing." />
  return createElement('button', {
    ...htmlAttributesForReact(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.preference-toggle']),
    ...nodeWrapperProps, ...preferenceToggleData(props), className: mcClassName,
    type: 'button', disabled: true, 'aria-pressed': 'false',
    'aria-label': props.ariaLabelOff || undefined,
    title: props.titleOff || undefined,
  }, props.labelOff, children)
}

export function PreferenceOutputEditor({ props, mcClassName, nodeWrapperProps }: ModuleComponentProps<PreferenceOutputProps>) {
  const settings = useEditorStore(state => state.site?.settings)
  if (!compiledCheck(PreferenceOutputPublishSchema, { props, settings })) return <CanvasModulePlaceholder {...nodeWrapperProps} className={mcClassName} label="Configure visitor defaults and both authored text values before publishing." />
  return createElement(props.tag, {
    ...htmlAttributesForReact(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.preference-output']),
    ...nodeWrapperProps, ...preferenceOutputData(props), className: mcClassName,
  }, props.textOff)
}
